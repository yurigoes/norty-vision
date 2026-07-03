import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { VoipService } from "./voip.service";

@Controller("voip")
export class VoipController {
  constructor(private readonly svc: VoipService) {}

  // Conectar: cria/garante ramal, marca presença e devolve ICE (Cloudflare TURN).
  @Post("register")
  @HttpCode(200)
  async register(@CurrentContext() ctx: RequestContext) { return this.svc.register(ctx); }

  @Post("unregister")
  @HttpCode(200)
  async unregister(@CurrentContext() ctx: RequestContext) { return this.svc.unregister(ctx); }

  @Get("directory")
  async directory(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.directory(ctx) }; }

  // Sinalização WebRTC P2P (offer/answer/bye/ringing/busy) entre ramais da mesma org.
  @Post("signal")
  @HttpCode(200)
  async signal(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      toExt: z.string().min(1),
      callId: z.string().min(1),
      type: z.enum(["offer", "answer", "bye", "ringing", "busy"]),
      sdp: z.string().optional(),
      reason: z.string().optional(),
    }).parse(body);
    return this.svc.signal(ctx, input);
  }

  // Drena mensagens endereçadas a mim (também serve de heartbeat de presença).
  @Get("poll")
  async poll(@CurrentContext() ctx: RequestContext) { return this.svc.poll(ctx); }

  @Post("calls")
  @HttpCode(200)
  async logCall(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ direction: z.string().optional(), fromExt: z.string().optional(), toExt: z.string().optional(), toNumber: z.string().optional(), calleeName: z.string().optional(), status: z.string().optional(), durationS: z.number().int().optional(), leadId: z.string().uuid().optional() }).parse(body);
    return this.svc.logCall(ctx, input);
  }

  // ---- Web Push (toca em qualquer tela / app fechado) -------------------------
  // Chave pública VAPID — o cliente consome pra criar a Push Subscription.
  @Get("push/vapid")
  vapid() { return { publicKey: this.svc.vapidPublicKey() }; }

  // Salva a Push Subscription do dispositivo do operador logado.
  @Post("push/subscribe")
  @HttpCode(200)
  async pushSubscribe(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      ua: z.string().optional(),
    }).parse(body);
    return this.svc.savePushSubscription(ctx, { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, ua: input.ua });
  }

  @Post("push/unsubscribe")
  @HttpCode(200)
  async pushUnsubscribe(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ endpoint: z.string().url() }).parse(body);
    return this.svc.removePushSubscription(ctx, input.endpoint);
  }

  // CALLER dispara: envia push pro callee (toca em qualquer tela / app fechado).
  @Post("ring")
  @HttpCode(200)
  async ring(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ toExt: z.string().min(1), callId: z.string().optional() }).parse(body);
    return this.svc.ring(ctx, input);
  }

  // ---- endpoints consultados pelo FreeSWITCH (mod_xml_curl) ----
  //      Públicos, mas validados por VOIP_FS_SECRET; só acessíveis na rede interna.
  //      Aceita o secret tanto no body quanto na querystring (extra-args do FS não
  //      passa em todos os builds; querystring é universal).
  @Public()
  @Post("fs/xml")
  @HttpCode(200)
  async fsXml(@Req() req: FastifyRequest): Promise<string> {
    const b: any = (req as any).body ?? {};
    const q: any = (req as any).query ?? {};
    const secret = String(b.secret ?? q.secret ?? req.headers["x-voip-secret"] ?? "");
    const section = String(b.section ?? q.section ?? "");
    if (section === "directory") return this.svc.fsDirectory(secret, String(b.user ?? q.user ?? ""), String(b.domain ?? q.domain ?? ""));
    if (section === "dialplan") {
      const dest = String(b["Caller-Destination-Number"] ?? b.destination_number ?? b.destination ?? q.destination ?? "");
      const caller = String(b["Caller-Username"] ?? b["variable_user_name"] ?? b["Caller-Caller-ID-Number"] ?? q.caller ?? "");
      return this.svc.fsDialplan(secret, dest, caller || undefined);
    }
    return `<?xml version="1.0"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }

  /** Lista de gateways de TODOS os trunks ativos (multitenant). Consumido pela
   *  VPS externa (cron) pra reescrever os arquivos sip_profiles/external/*.xml
   *  e dar `fs_cli -x 'sofia profile external rescan reloadxml'`. */
  @Public()
  @Get("fs/gateways")
  async fsGateways(@Req() req: FastifyRequest) {
    const secret = String((req.query as any)?.secret ?? req.headers["x-voip-secret"] ?? "");
    // mesma proteção dos demais endpoints fs
    if (secret !== (process.env.VOIP_FS_SECRET || "yugo-voip")) throw new Error("forbidden");
    return { items: await this.svc.listAllGateways() };
  }

  /** Config dinâmica pro Asterisk PABX (ramais + trunks). Consumido pelo
   *  sync-config.sh na VPS externa (cron 30s) pra regerar pjsip_dynamic.conf. */
  @Public()
  @Get("asterisk/config")
  async asteriskConfig(@Req() req: FastifyRequest) {
    const secret = String((req.query as any)?.secret ?? req.headers["x-voip-secret"] ?? "");
    if (secret !== (process.env.VOIP_FS_SECRET || "yugo-voip")) throw new Error("forbidden");
    return this.svc.asteriskConfig();
  }
}
