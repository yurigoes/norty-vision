import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import webpush from "web-push";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

const ADM = { isPlatformAdmin: true as const };

// ---- VAPID (Web Push) — gere uma vez com `npx web-push generate-vapid-keys` --
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:suporte@yugochat.com.br";

// ---- Cloudflare Realtime TURN (relay de mídia grátis, 1TB/mês) -------------
// Crie um "TURN App" no painel Cloudflare → pega Key ID + API Token e põe no
// .env. Sem isso, cai pra STUN-only (só funciona em LAN/IP público direto).
const CF_TURN_KEY_ID = process.env.CLOUDFLARE_TURN_KEY_ID || "";
const CF_TURN_API_TOKEN = process.env.CLOUDFLARE_TURN_API_TOKEN || "";
// fallback opcional: coturn próprio (caminho "abrir portas", hoje desligado)
const TURN_HOST = process.env.VOIP_TURN_HOST || "";
const TURN_USER = process.env.VOIP_TURN_USER || "yugo";
const TURN_PASS = process.env.VOIP_TURN_PASS || "";

const FS_SECRET = process.env.VOIP_FS_SECRET || "yugo-voip"; // endpoints do FreeSWITCH
const SIP_DOMAIN = process.env.VOIP_SIP_DOMAIN || "voip.yugochat.com.br";
// Modo SIP (PABX FreeSWITCH na VPS externa): defina VOIP_SIP_WS_URL = wss://voip.seu-dominio
// (Caddy/FreeSWITCH). Setado → o softphone vira SIP; vazio → modo P2P (Cloudflare TURN).
const SIP_WS_URL = process.env.VOIP_SIP_WS_URL || "";
// Trunk SIP pra PSTN (números reais) — legado (1 trunk único). Mantido pra fallback
// quando uma org ainda não cadastrou trunks. A partir do callcenter multitenant
// (migration 177), os trunks vêm de voip_trunk e cada gateway tem nome único.
const TRUNK_NAME = process.env.VOIP_TRUNK_NAME || "yugo-trunk";

// Chave AES-256-GCM pra cifrar senhas SIP em voip_trunk.sip_pass_enc. 32 bytes em hex.
// Sem env definida, deriva via SHA-256 do VOIP_FS_SECRET (ok pra MVP, pode trocar depois).
function trunkKey(): Buffer {
  const k = process.env.VOIP_TRUNK_KEY || "";
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, "hex");
  return createHash("sha256").update(process.env.VOIP_FS_SECRET || "yugo-voip").digest();
}
export function encryptSipPass(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", trunkKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${ct.toString("base64")}.${tag.toString("base64")}`;
}
export function decryptSipPass(enc: string): string {
  const parts = enc.split(".").map((s) => Buffer.from(s, "base64"));
  if (parts.length !== 3) throw new Error("voip: trunk pass enc malformado");
  const [iv, ct, tag] = parts as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv("aes-256-gcm", trunkKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

const PRESENCE_TTL_MS = 35_000;   // operador "online" se deu heartbeat nos últimos 35s
const MSG_TTL_MS = 60_000;        // mensagem de sinalização expira em 60s se não for lida
const ICE_REFRESH_MS = 12 * 60 * 60 * 1000; // regenera credenciais TURN a cada 12h

type SignalType = "offer" | "answer" | "bye" | "ringing" | "busy";
export interface SignalMsg { id: string; fromExt: string; fromName: string; callId: string; type: SignalType; sdp?: string; reason?: string; ts: number; }

@Injectable()
export class VoipService implements OnModuleInit {
  private readonly logger = new Logger("VoIP");
  // estado efêmero de sinalização (em memória; API roda em 1 processo). Chave = `${orgId}:${ext}`.
  private mailbox = new Map<string, SignalMsg[]>();
  private presence = new Map<string, { name: string; lastSeen: number }>();
  private iceCache: { servers: any[]; expiresAt: number } | null = null;
  private pushEnabled = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (VAPID_PUBLIC && VAPID_PRIVATE) {
      try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
        this.pushEnabled = true;
        this.logger.log("Web Push (VAPID) habilitado — chamada toca em qualquer tela.");
      } catch (e: any) {
        this.logger.warn(`VAPID inválido: ${e?.message}. Web Push desligado.`);
      }
    } else {
      this.logger.log("VAPID_PUBLIC_KEY/PRIVATE_KEY não configurados — Web Push desligado.");
    }
  }

  /** Chave pública VAPID (consumida pelo cliente pra criar a Push Subscription). */
  vapidPublicKey(): string { return VAPID_PUBLIC; }

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin }; }
  private requireUser(ctx: RequestContext) { if (!ctx.orgId || !ctx.membershipId) throw new AppError(ErrorCode.Forbidden, "Sem operador/empresa", 403); }
  private key(orgId: string, ext: string) { return `${orgId}:${ext}`; }

  /** Garante (e cria) o ramal do operador logado. */
  private async getOrCreateExt(ctx: RequestContext) {
    let ext = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findFirst({ where: { membershipId: ctx.membershipId! } }));
    if (!ext) {
      const number = await this.nextExtension(ctx);
      const me = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: ctx.membershipId! }, select: { user: { select: { name: true } } } })).catch(() => null);
      ext = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.create({
        data: { organizationId: ctx.orgId!, membershipId: ctx.membershipId!, extension: number, secret: randomBytes(16).toString("hex"), displayName: me?.user?.name ?? `Ramal ${number}` },
      }));
    }
    return ext;
  }

  private async nextExtension(ctx: RequestContext): Promise<string> {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findMany({ select: { extension: true } }));
    let max = 1000;
    for (const r of rows) { const n = parseInt(r.extension, 10); if (!isNaN(n) && n > max) max = n; }
    return String(max + 1);
  }

  /** Credenciais ICE (STUN+TURN). Cloudflare TURN se configurado; cacheado.
   *  Aumenta a versão pra invalidar o cache quando a fórmula muda. */
  private readonly ICE_VERSION = 3;
  async iceServers(): Promise<any[]> {
    const now = Date.now();
    if (this.iceCache && this.iceCache.expiresAt > now && (this.iceCache as any).v === this.ICE_VERSION) return this.iceCache.servers;
    const servers: any[] = [{ urls: "stun:stun.l.google.com:19302" }];
    if (CF_TURN_KEY_ID && CF_TURN_API_TOKEN) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        });
        if (r.ok) {
          const j: any = await r.json();
          if (j?.iceServers) servers.push(j.iceServers);
        } else {
          this.logger.warn(`Cloudflare TURN ${r.status}: caindo pra STUN`);
        }
      } catch (e: any) {
        this.logger.warn(`Cloudflare TURN falhou (${e?.message}); STUN-only`);
      }
    } else if (TURN_HOST && TURN_PASS && process.env.VOIP_TURN_ENABLE === "1") {
      // TURN UDP só se explicitamente ligado (VOIP_TURN_ENABLE=1). Sem ele,
      // ICE usa só STUN (srflx) + host. Pra PABX com IP público + browser
      // alcançando direto, STUN é suficiente e MUITO mais rápido pra coletar.
      servers.push({ urls: [`turn:${TURN_HOST}:3478?transport=udp`], username: TURN_USER, credential: TURN_PASS });
    }
    this.iceCache = { servers, expiresAt: now + ICE_REFRESH_MS, v: this.ICE_VERSION } as any;
    return servers;
  }

  /** Config do softphone + marca presença (heartbeat). Chame ao conectar e a cada ~20s. */
  async register(ctx: RequestContext): Promise<any> {
    this.requireUser(ctx);
    const ext = await this.getOrCreateExt(ctx);
    this.presence.set(this.key(ctx.orgId!, ext.extension), { name: ext.displayName ?? ext.extension, lastSeen: Date.now() });
    // sala de conferência compartilhada por empresa (Jitsi). Mídia multiponto via SFU grátis.
    const confBase = process.env.JITSI_BASE_URL || "https://meet.jit.si";
    const base: any = {
      mode: SIP_WS_URL ? "sip" : "p2p",
      extension: ext.extension, displayName: ext.displayName,
      iceServers: await this.iceServers(), confUrl: `${confBase}/yugo-conf-${ctx.orgId}`,
    };
    // No modo SIP o softphone (JsSIP) registra no FreeSWITCH: precisa do WSS + credenciais do ramal.
    if (SIP_WS_URL) base.sip = { wsUri: SIP_WS_URL, sipUri: `sip:${ext.extension}@${SIP_DOMAIN}`, domain: SIP_DOMAIN, password: ext.secret };
    return base;
  }

  /** Marca o operador offline (ao desconectar). */
  unregister(ctx: RequestContext): { ok: true } {
    this.requireUser(ctx);
    this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findFirst({ where: { membershipId: ctx.membershipId! }, select: { extension: true } }))
      .then((e) => { if (e) this.presence.delete(this.key(ctx.orgId!, e.extension)); })
      .catch(() => undefined);
    return { ok: true };
  }

  /** Operadores com ramal (p/ discar pelo nome) + status online. Exclui o próprio. */
  async directory(ctx: RequestContext): Promise<any[]> {
    this.requireUser(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findMany({ where: { active: true, membershipId: { not: ctx.membershipId! } }, orderBy: { displayName: "asc" }, select: { extension: true, displayName: true } }));
    const now = Date.now();
    return rows.map((r) => {
      const p = this.presence.get(this.key(ctx.orgId!, r.extension));
      return { extension: r.extension, name: r.displayName ?? r.extension, online: !!p && now - p.lastSeen < PRESENCE_TTL_MS };
    });
  }

  /** Envia uma mensagem de sinalização (offer/answer/bye/ringing/busy) p/ outro ramal da MESMA org. */
  async signal(ctx: RequestContext, dto: { toExt: string; callId: string; type: SignalType; sdp?: string; reason?: string }): Promise<{ ok: true; online: boolean }> {
    this.requireUser(ctx);
    const me = await this.getOrCreateExt(ctx);
    const targetKey = this.key(ctx.orgId!, dto.toExt);
    const p = this.presence.get(targetKey);
    const online = !!p && Date.now() - p.lastSeen < PRESENCE_TTL_MS;
    const box = this.mailbox.get(targetKey) ?? [];
    box.push({ id: randomBytes(8).toString("hex"), fromExt: me.extension, fromName: me.displayName ?? me.extension, callId: dto.callId, type: dto.type, sdp: dto.sdp, reason: dto.reason, ts: Date.now() });
    this.mailbox.set(targetKey, box);
    return { ok: true, online };
  }

  /** Drena as mensagens de sinalização endereçadas a mim. Também serve de heartbeat. */
  async poll(ctx: RequestContext): Promise<{ messages: SignalMsg[] }> {
    this.requireUser(ctx);
    const ext = await this.getOrCreateExt(ctx);
    const key = this.key(ctx.orgId!, ext.extension);
    this.presence.set(key, { name: ext.displayName ?? ext.extension, lastSeen: Date.now() });
    this.pruneExpired();
    const box = this.mailbox.get(key) ?? [];
    this.mailbox.set(key, []);
    const now = Date.now();
    return { messages: box.filter((m) => now - m.ts < MSG_TTL_MS) };
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [k, box] of this.mailbox) {
      const fresh = box.filter((m) => now - m.ts < MSG_TTL_MS);
      if (fresh.length) this.mailbox.set(k, fresh); else this.mailbox.delete(k);
    }
    for (const [k, p] of this.presence) if (now - p.lastSeen > PRESENCE_TTL_MS * 3) this.presence.delete(k);
  }

  /** Registro de chamada (reportado pelo softphone). Liga na timeline do lead se informado. */
  async logCall(ctx: RequestContext, dto: { direction?: string; fromExt?: string; toExt?: string; toNumber?: string; calleeName?: string; status?: string; durationS?: number; leadId?: string }): Promise<any> {
    this.requireUser(ctx);
    const me = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findFirst({ where: { membershipId: ctx.membershipId! }, select: { extension: true, displayName: true } })).catch(() => null);
    const call = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipCall.create({
      data: {
        organizationId: ctx.orgId!, leadId: dto.leadId ?? null, direction: dto.direction ?? "internal",
        fromExt: dto.fromExt ?? me?.extension ?? null, toExt: dto.toExt ?? null, toNumber: dto.toNumber ?? null,
        callerName: me?.displayName ?? null, calleeName: dto.calleeName ?? null,
        status: dto.status ?? "ended", durationS: dto.durationS ?? null,
        answeredAt: dto.status === "answered" || dto.status === "ended" ? new Date() : null,
        endedAt: dto.status === "ended" ? new Date() : null,
      },
      select: { id: true },
    }));
    if (dto.leadId) {
      const dur = dto.durationS ? ` (${Math.round(dto.durationS / 60)}m${dto.durationS % 60}s)` : "";
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLeadEvent.create({ data: { organizationId: ctx.orgId!, leadId: dto.leadId!, kind: "call", title: `Ligação VoIP${dur}`, body: dto.toNumber || dto.toExt || null, authorMembershipId: ctx.membershipId ?? null } })).catch(() => undefined);
    }
    return { id: call.id };
  }

  // ====================== WEB PUSH (toca em qualquer tela / app fechado) ======================
  // Caller-triggered: quem liga dá POST /voip/ring → API envia push pro callee.
  // Funciona sem depender do FreeSWITCH (não precisa de hook no dialplan).

  /** Salva (upsert) a Push Subscription do dispositivo do operador logado. */
  async savePushSubscription(ctx: RequestContext, dto: { endpoint: string; p256dh: string; auth: string; ua?: string }): Promise<{ ok: true }> {
    this.requireUser(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { organizationId: ctx.orgId!, membershipId: ctx.membershipId!, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth, ua: dto.ua ?? null },
      update: { membershipId: ctx.membershipId!, p256dh: dto.p256dh, auth: dto.auth, ua: dto.ua ?? null, lastUsedAt: new Date() },
    }));
    return { ok: true };
  }

  async removePushSubscription(ctx: RequestContext, endpoint: string): Promise<{ ok: true }> {
    this.requireUser(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipPushSubscription.deleteMany({ where: { endpoint } }));
    return { ok: true };
  }

  /** Dispara push pro callee (ramal toExt) — chamado pelo CALLER antes/ao iniciar a ligação. */
  async ring(ctx: RequestContext, dto: { toExt: string; callId?: string }): Promise<{ sent: number; pushEnabled: boolean }> {
    this.requireUser(ctx);
    if (!this.pushEnabled) return { sent: 0, pushEnabled: false };
    // 1) acha o ramal alvo na MESMA org (RLS garante o isolamento)
    const target = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findFirst({ where: { extension: dto.toExt }, select: { membershipId: true, displayName: true } }));
    if (!target?.membershipId) return { sent: 0, pushEnabled: true };
    // 2) pega o nome de quem está ligando (caller = ctx)
    const me = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findFirst({ where: { membershipId: ctx.membershipId! }, select: { extension: true, displayName: true } })).catch(() => null);
    const subs = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipPushSubscription.findMany({ where: { membershipId: target.membershipId! } }));
    if (!subs.length) return { sent: 0, pushEnabled: true };
    const payload = JSON.stringify({
      type: "ring",
      title: "Chamada entrante",
      body: `${me?.displayName ?? "Operador"} está ligando…`,
      callId: dto.callId ?? null,
      fromExt: me?.extension ?? null,
      fromName: me?.displayName ?? null,
      url: "/app/voip",
    });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 30, urgency: "high" } as any,
        );
        sent++;
      } catch (e: any) {
        const code = e?.statusCode ?? 0;
        if (code === 404 || code === 410) {
          // subscription morreu (desinstalou/bloqueou) → remove
          await this.prisma.runWithContext(ADM, (tx) => tx.voipPushSubscription.delete({ where: { endpoint: s.endpoint } })).catch(() => undefined);
        } else {
          this.logger.warn(`push falhou (status ${code}): ${e?.message}`);
        }
      }
    }));
    return { sent, pushEnabled: true };
  }

  // ====================== ENDPOINTS DO FREESWITCH (mod_xml_curl) — DORMENTE ======================
  // Mantidos no código para o caminho "abrir portas" (PABX FreeSWITCH). No modo P2P
  // (Cloudflare TURN) NÃO são usados. Protegidos por VOIP_FS_SECRET.
  private checkSecret(secret?: string) { if ((secret ?? "") !== FS_SECRET) throw new AppError(ErrorCode.Forbidden, "voip secret inválido", 403); }

  async fsDirectory(secret: string, user: string, domain: string): Promise<string> {
    this.checkSecret(secret);
    const ext = await this.prisma.runWithContext(ADM, (tx) => tx.voipExtension.findFirst({ where: { extension: user, active: true }, select: { secret: true, displayName: true, organizationId: true } })).catch(() => null);
    if (!ext) return this.fsNotFound();
    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${this.xml(domain)}">
      <user id="${this.xml(user)}">
        <params>
          <param name="password" value="${this.xml(ext.secret)}"/>
        </params>
        <variables>
          <variable name="user_context" value="default"/>
          <variable name="effective_caller_id_name" value="${this.xml(ext.displayName ?? user)}"/>
          <variable name="effective_caller_id_number" value="${this.xml(user)}"/>
          <variable name="org_id" value="${this.xml(ext.organizationId)}"/>
        </variables>
      </user>
    </domain>
  </section>
</document>`;
  }

  async fsDialplan(secret: string, destination: string, callerExt?: string): Promise<string> {
    this.checkSecret(secret);
    const dest = (destination ?? "").replace(/[^0-9]/g, "");
    if (!dest) return this.fsNotFound();
    // 1) destino é um DID cadastrado? → chamada INBOUND, roteia pelo inbound_kind.
    const inboundXml = await this.tryInboundDialplan(dest);
    if (inboundXml) return inboundXml;
    // 2) conferência
    if (dest === "9000") {
      return this.fsXml(`<extension name="conf"><condition field="destination_number" expression="^9000$"><action application="answer"/><action application="conference" data="sala-9000@default"/></condition></extension>`);
    }
    // 3) ramal interno 1000-9999
    if (/^[1-9][0-9]{3}$/.test(dest)) {
      return this.fsXml(`<extension name="ramal"><condition field="destination_number" expression="^(${dest})$"><action application="bridge" data="user/\$1@${this.xml(SIP_DOMAIN)}"/></condition></extension>`);
    }
    // 4) PSTN outbound: número 8+ dígitos. Usa o 1º trunk da org do CALLER (multitenant).
    if (/^[0-9]{8,}$/.test(dest)) {
      const gw = (callerExt ? await this.gatewayForCaller(callerExt) : null) ?? TRUNK_NAME;
      return this.fsXml(
        `<extension name="pstn">` +
          `<condition field="destination_number" expression="^(${dest})$">` +
            `<action application="set" data="hangup_after_bridge=true"/>` +
            `<action application="set" data="continue_on_fail=true"/>` +
            `<action application="bridge" data="{ignore_early_media=false}sofia/gateway/${this.xml(gw)}/\$1"/>` +
          `</condition>` +
        `</extension>`,
      );
    }
    return this.fsNotFound();
  }

  /** Nome do gateway do 1º trunk ATIVO da org do caller (pra outbound). */
  private async gatewayForCaller(callerExt: string): Promise<string | null> {
    const ext = await this.prisma.runWithContext(ADM, (tx) => tx.voipExtension.findFirst({ where: { extension: callerExt, active: true }, select: { organizationId: true } })).catch(() => null);
    if (!ext) return null;
    const trunk = await this.prisma.runWithContext(ADM, (tx) => tx.voipTrunk.findFirst({ where: { organizationId: ext.organizationId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } })).catch(() => null);
    if (!trunk) return null;
    return this.gatewayName(trunk.id);
  }

  /** Dialplan de chamada INBOUND quando o destino bate com um DID cadastrado. */
  private async tryInboundDialplan(dest: string): Promise<string | null> {
    const did = await this.prisma.runWithContext(ADM, (tx) => tx.voipDid.findFirst({ where: { number: dest, active: true } })).catch(() => null);
    if (!did) return null;
    const inner = await this.inboundActions(did.inboundKind, did.inboundId, did.organizationId, did.fallbackKind, did.fallbackId);
    if (!inner) return this.fsNotFound();
    return this.fsXml(
      `<extension name="did-${this.xml(did.id)}">` +
        `<condition field="destination_number" expression="^(${dest})$">` +
          inner +
        `</condition>` +
      `</extension>`,
    );
  }

  /** Gera as actions do FS pro destino (group | ivr | extension | voicemail). */
  private async inboundActions(kind: string | null, id: string | null, orgId: string, fallbackKind?: string | null, fallbackId?: string | null): Promise<string> {
    if (kind === "group" && id) {
      const dial = await this.groupDialString(id, orgId);
      if (!dial) return this.voicemailFallback();
      return `<action application="set" data="hangup_after_bridge=true"/>` +
        `<action application="set" data="continue_on_fail=true"/>` +
        `<action application="bridge" data="${dial}"/>` +
        this.fallbackAction(fallbackKind, fallbackId, orgId);
    }
    if (kind === "extension" && id) {
      // id aqui guarda o membershipId; busca o ramal
      const ext = await this.prisma.runWithContext(ADM, (tx) => tx.voipExtension.findFirst({ where: { membershipId: id, organizationId: orgId, active: true }, select: { extension: true } })).catch(() => null);
      if (!ext) return this.voicemailFallback();
      return `<action application="bridge" data="user/${ext.extension}@${this.xml(SIP_DOMAIN)}"/>` +
        this.fallbackAction(fallbackKind, fallbackId, orgId);
    }
    if (kind === "ivr" && id) {
      // implementação completa na Fase C (Piper TTS). Por ora, fallback.
      return this.voicemailFallback();
    }
    return this.voicemailFallback();
  }

  /** String do bridge pra um grupo, respeitando a strategy. */
  private async groupDialString(groupId: string, orgId: string): Promise<string | null> {
    const grp = await this.prisma.runWithContext(ADM, (tx) => tx.voipGroup.findFirst({ where: { id: groupId, organizationId: orgId } })).catch(() => null);
    if (!grp) return null;
    const members = await this.prisma.runWithContext(ADM, (tx) => tx.voipGroupMember.findMany({ where: { groupId, organizationId: orgId, active: true }, orderBy: { priority: "asc" } })).catch(() => []);
    if (!members.length) return null;
    const exts = await this.prisma.runWithContext(ADM, (tx) => tx.voipExtension.findMany({ where: { organizationId: orgId, active: true, membershipId: { in: members.map((m) => m.membershipId) } }, select: { extension: true, membershipId: true } })).catch(() => []);
    // mantém a ordem dos members (priority)
    const dialTargets = members
      .map((m) => exts.find((e) => e.membershipId === m.membershipId)?.extension)
      .filter((x): x is string => !!x)
      .map((e) => `[leg_timeout=${grp.ringTimeoutS}]user/${e}@${this.xml(SIP_DOMAIN)}`);
    if (!dialTargets.length) return null;
    // strategy: all (vírgula = simultâneo) | sequential (pipe = tentar um, falha → próximo) | longest_idle (cai pra all no v1)
    const sep = grp.strategy === "sequential" ? "|" : ",";
    return `{call_timeout=${grp.ringTimeoutS}}${dialTargets.join(sep)}`;
  }

  private fallbackAction(kind?: string | null, _id?: string | null, _orgId?: string): string {
    // se a chamada FALHAR (ninguém atendeu), pode mandar pra voicemail/IVR/etc.
    // v1: voicemail genérico. Implementação completa pode chamar inboundActions recursivamente.
    if (kind === "voicemail" || !kind) return this.voicemailFallback();
    return ""; // outros fallbacks por enquanto sem ação extra
  }

  private voicemailFallback(): string {
    // mensagem mínima — em v1 só toca um tom de "ocupado" e desliga. Voicemail real depois.
    return `<action application="answer"/>` +
      `<action application="playback" data="tone_stream://%(500,500,480,620);loops=4"/>` +
      `<action application="hangup" data="NORMAL_CLEARING"/>`;
  }

  /** Nome único do gateway no FS pra um trunk (estável). */
  gatewayName(trunkId: string): string {
    return `tk-${trunkId.replace(/-/g, "").slice(0, 12)}`;
  }

  /** Config completa pro Asterisk PABX (ramais + trunks ativos, todas as orgs).
   *  Consumido pelo sync-config.sh na VPS do PABX (cron 30s).
   *  Ramais são DEDUPLICADOS por extensão (Asterisk single-tenant; ramal 1001
   *  da empresa A colidiria com 1001 da empresa B). O 1º encontrado vence. */
  async asteriskConfig(): Promise<{ ramais: Array<{ ext: string; secret: string; displayName: string | null }>, trunks: Array<{ name: string; host: string; user: string; pass: string }> }> {
    const exts = await this.prisma.runWithContext(ADM, (tx) => tx.voipExtension.findMany({
      where: { active: true },
      select: { extension: true, secret: true, displayName: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }));
    const trunks = await this.prisma.runWithContext(ADM, (tx) => tx.voipTrunk.findMany({ where: { active: true, register: true } }));
    const seen = new Set<string>();
    const ramais: Array<{ ext: string; secret: string; displayName: string | null }> = [];
    for (const e of exts) {
      if (seen.has(e.extension)) continue;
      seen.add(e.extension);
      ramais.push({ ext: e.extension, secret: e.secret, displayName: e.displayName });
    }
    return {
      ramais,
      trunks: trunks.map((t) => {
        let pass = "";
        try { pass = decryptSipPass(t.sipPassEnc); } catch { pass = ""; }
        return { name: this.gatewayName(t.id), host: t.sipHost, user: t.sipUser, pass };
      }),
    };
  }

  /** Lista de gateways pra TODOS os trunks ativos (consumido pela VPS externa, FreeSWITCH legado). */
  async listAllGateways(): Promise<Array<{ name: string; xml: string }>> {
    const trunks = await this.prisma.runWithContext(ADM, (tx) => tx.voipTrunk.findMany({ where: { active: true, register: true } }));
    return trunks.map((t) => ({
      name: this.gatewayName(t.id),
      xml: this.gatewayXml(t),
    }));
  }

  private gatewayXml(t: { id: string; sipUser: string; sipHost: string; sipPassEnc: string; callerIdName: string | null }): string {
    let pass = "";
    try { pass = decryptSipPass(t.sipPassEnc); } catch { pass = ""; }
    const name = this.gatewayName(t.id);
    return `<include>
  <gateway name="${this.xml(name)}">
    <param name="username" value="${this.xml(t.sipUser)}"/>
    <param name="auth-username" value="${this.xml(t.sipUser)}"/>
    <param name="password" value="${this.xml(pass)}"/>
    <param name="realm" value="${this.xml(t.sipHost)}"/>
    <param name="proxy" value="${this.xml(t.sipHost)}"/>
    <param name="register" value="true"/>
    <param name="register-transport" value="udp"/>
    <param name="expire-seconds" value="600"/>
    <param name="ping" value="30"/>
    <param name="retry-seconds" value="30"/>
    <param name="caller-id-in-from" value="true"/>
    <param name="extension-in-contact" value="true"/>
    ${t.callerIdName ? `<param name="from-domain" value="${this.xml(t.sipHost)}"/>` : ""}
    <variables>
      <variable name="domain_name" value="${this.xml(t.sipHost)}"/>
    </variables>
  </gateway>
</include>`;
  }

  private fsXml(extInner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">${extInner}</context>
  </section>
</document>`;
  }
  private fsNotFound(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }
  private xml(s: string): string { return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
}
