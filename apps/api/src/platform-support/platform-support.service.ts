import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { OrgAiService } from "../ai/org-ai.service";
import { AuthService } from "../auth/auth.service";
import { ArgonService } from "../auth/argon.service";
import type { RequestContext } from "../auth/session.middleware";

const ADM = { isPlatformAdmin: true as const };
type Action = "password_change" | "email_change" | "phone_change";

function genCode6(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return `SUP-${s}`;
}

@Injectable()
export class PlatformSupportService {
  private readonly logger = new Logger("PlatformSupport");
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly orgAi: OrgAiService,
    private readonly auth: AuthService,
    private readonly argon: ArgonService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireUser(ctx: RequestContext) {
    if (!ctx.orgId || !ctx.userId) throw new AppError(ErrorCode.Forbidden, "Sem usuário/empresa", 403);
  }
  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas suporte do sistema (master)", 403);
  }
  private secret() { return process.env.AUTH_CODE_SECRET ?? "yugo-auth"; }

  // ============================== EMPRESA ==============================
  async create(ctx: RequestContext, input: { category?: string; subject: string; body: string }): Promise<any> {
    this.requireUser(ctx);
    const category = ["duvida", "bug", "solicitacao", "senha", "email", "telefone", "outro"].includes(input.category ?? "") ? input.category! : "duvida";
    const subject = (input.subject ?? "").trim().slice(0, 200) || "Chamado";
    const body = (input.body ?? "").trim();
    if (!body) throw new AppError(ErrorCode.ValidationFailed, "Descreva o chamado", 400);

    const me = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.user.findFirst({ where: { id: ctx.userId! }, select: { name: true } })).catch(() => null);
    let shortCode = genCode6();
    const ticket = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      for (let i = 0; i < 5; i++) { if (!(await tx.platformSupportTicket.findFirst({ where: { shortCode }, select: { id: true } }))) break; shortCode = genCode6(); }
      const t = await tx.platformSupportTicket.create({
        data: {
          organizationId: ctx.orgId!, storeId: ctx.storeId ?? null, requesterUserId: ctx.userId!, requesterMembershipId: ctx.membershipId ?? null,
          requesterName: me?.name ?? null, requesterRole: (ctx.role as any) ?? (ctx.isOrgAdmin ? "admin" : "operador"),
          category, subject, status: "aberto", channel: "portal", shortCode,
        },
        select: { id: true },
      });
      await tx.platformSupportMessage.create({ data: { organizationId: ctx.orgId!, ticketId: t.id, author: "usuario", authorUserId: ctx.userId!, body } });
      return t;
    });

    // IA de primeiro atendimento (dúvidas/bug/solicitação). Senha/e-mail/telefone usam o assistente seguro (wizard).
    if (["duvida", "bug", "solicitacao", "outro"].includes(category)) {
      await this.aiTurn(ctx, ticket.id, body).catch((e) => this.logger.warn(`aiTurn: ${e?.message}`));
    } else {
      await this.postMessage(ctx, ticket.id, "ia", "Posso te ajudar com isso por aqui de forma segura. Use o assistente abaixo para concluir. Se não conseguir, encaminho para o suporte do sistema.");
      await this.setStatus(ctx, ticket.id, "aguardando_usuario");
    }
    await this.notifyMasterNew(ticket.id).catch(() => undefined);
    return this.getTicket(ctx, ticket.id);
  }

  async listMine(ctx: RequestContext): Promise<any[]> {
    this.requireUser(ctx);
    const where: any = ctx.isOrgAdmin ? {} : { requesterUserId: ctx.userId! }; // operador vê só os dele; admin vê os da empresa (RLS já isola a org)
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, shortCode: true, subject: true, category: true, status: true, priority: true, requesterName: true, createdAt: true, updatedAt: true } }));
  }

  async getTicket(ctx: RequestContext, id: string, opts?: { master?: boolean }): Promise<any> {
    const isMaster = !!opts?.master || ctx.isPlatformAdmin;
    if (!isMaster) this.requireUser(ctx);
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.findFirst({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } }));
    if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
    if (!isMaster && !ctx.isOrgAdmin && t.requesterUserId !== ctx.userId) throw new AppError(ErrorCode.Forbidden, "Sem acesso a este chamado", 403);
    // usuário não vê notas internas do master
    const messages = (t.messages ?? []).filter((m: any) => isMaster || !m.internal);
    return { ...t, messages };
  }

  async addUserMessage(ctx: RequestContext, id: string, body: string): Promise<any> {
    this.requireUser(ctx);
    const t = await this.getTicket(ctx, id);
    const text = (body ?? "").trim();
    if (!text) throw new AppError(ErrorCode.ValidationFailed, "Mensagem vazia", 400);
    await this.postMessage(ctx, id, "usuario", text);
    if (["duvida", "bug", "solicitacao", "outro"].includes(t.category)) {
      await this.aiTurn(ctx, id, text).catch(() => undefined);
    } else {
      await this.setStatus(ctx, id, "aguardando_master");
      await this.notifyMasterNew(id).catch(() => undefined);
    }
    return this.getTicket(ctx, id);
  }

  // ============================== IA (1º nível) ==============================
  private async aiTurn(ctx: RequestContext, ticketId: string, userText: string): Promise<void> {
    const orgId = ctx.orgId!;
    const ctxKb = await this.searchKnowledge(ctx, userText).catch(() => "");
    const system = [
      "Você é o SUPORTE DO SISTEMA (yugo) atendendo um usuário interno da empresa.",
      "Responda de forma objetiva e cordial, SOMENTE com base no CONTEXTO abaixo (base de conhecimento + guia do sistema).",
      "Se o CONTEXTO não tiver informação suficiente para responder com segurança, responda EXATAMENTE com a palavra [ESCALAR] (sem mais nada).",
      "Nunca invente funcionalidades, telas ou passos que não estejam no contexto.",
      "",
      "CONTEXTO:",
      ctxKb || "(sem material relacionado encontrado)",
    ].join("\n");
    const ans = (await this.orgAi.complete(orgId, system, userText, 500).catch(() => null))?.trim() ?? "";
    if (!ans || /\[ESCALAR\]/i.test(ans)) {
      await this.postMessage(ctx, ticketId, "ia", "Isso eu não encontrei na base do sistema — vou encaminhar para o suporte (master). Você será avisado por aqui assim que houver resposta. 🙂");
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.update({ where: { id: ticketId }, data: { status: "aguardando_master", aiSummary: userText.slice(0, 500) } }));
      await this.notifyMasterNew(ticketId).catch(() => undefined);
      return;
    }
    await this.postMessage(ctx, ticketId, "ia", ans);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.update({ where: { id: ticketId }, data: { status: "resolvido_ia", aiHandled: true } }));
  }

  /** Busca material relacionado (artigos de ajuda + base Q&A) p/ alimentar a IA. */
  private async searchKnowledge(ctx: RequestContext, q: string): Promise<string> {
    const terms = (q ?? "").toLowerCase().split(/[^a-zà-ú0-9]+/i).filter((w) => w.length >= 4).slice(0, 6);
    if (!terms.length) return "";
    const like = "%" + terms.join("%") + "%";
    const parts: string[] = [];
    const help = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT title, summary, left(body_markdown, 800) AS body FROM help_articles
       WHERE is_published = true AND (organization_id IS NULL OR organization_id = app.current_org_id())
         AND (title ILIKE ${like} OR coalesce(summary,'') ILIKE ${like} OR body_markdown ILIKE ${like})
       ORDER BY display_order LIMIT 4`).catch(() => [] as any[]);
    for (const h of help) parts.push(`# ${h.title}\n${h.summary ?? ""}\n${h.body ?? ""}`);
    const kb = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT question, answer FROM kb_entries
       WHERE (organization_id IS NULL OR organization_id = app.current_org_id())
         AND (question ILIKE ${like} OR answer ILIKE ${like})
       LIMIT 4`).catch(() => [] as any[]);
    for (const k of kb) parts.push(`P: ${k.question}\nR: ${k.answer}`);
    return parts.join("\n\n---\n\n").slice(0, 4000);
  }

  // ============================== MASTER ==============================
  async masterList(ctx: RequestContext, opts?: { status?: string }): Promise<any[]> {
    this.requireMaster(ctx);
    const where: any = {};
    if (opts?.status) where.status = opts.status;
    return this.prisma.runWithContext(ADM, (tx) => tx.platformSupportTicket.findMany({ where, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 300, select: { id: true, shortCode: true, subject: true, category: true, status: true, priority: true, requesterName: true, requesterRole: true, organizationId: true, aiSummary: true, createdAt: true, updatedAt: true } }));
  }

  async masterReply(ctx: RequestContext, id: string, body: string, opts?: { internal?: boolean; resolve?: boolean }): Promise<any> {
    this.requireMaster(ctx);
    const t = await this.prisma.runWithContext(ADM, (tx) => tx.platformSupportTicket.findFirst({ where: { id }, select: { id: true, organizationId: true, category: true, subject: true, requesterUserId: true, aiSummary: true } }));
    if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
    const text = (body ?? "").trim();
    if (!text) throw new AppError(ErrorCode.ValidationFailed, "Resposta vazia", 400);
    await this.prisma.runWithContext(ADM, (tx) => tx.platformSupportMessage.create({ data: { organizationId: t.organizationId, ticketId: id, author: "master", authorUserId: null, body: text, internal: !!opts?.internal } }));
    if (!opts?.internal) {
      const data: any = { status: opts?.resolve ? "resolvido" : "aguardando_usuario", updatedAt: new Date() };
      if (opts?.resolve) { data.resolution = text.slice(0, 2000); data.resolvedByMaster = ctx.platformUserId ?? null; data.resolvedAt = new Date(); }
      await this.prisma.runWithContext(ADM, (tx) => tx.platformSupportTicket.update({ where: { id }, data }));
      // aprende: a resposta do master vira base Q&A (a IA passa a responder sozinha)
      if (opts?.resolve && ["duvida", "bug", "solicitacao", "outro"].includes(t.category)) {
        const question = (t.aiSummary || t.subject || "").slice(0, 500);
        if (question) await this.prisma.runWithContext(ADM, (tx) => tx.$executeRaw`
          INSERT INTO kb_entries (id, organization_id, question, answer, created_at)
          VALUES (app.new_id(), ${t.organizationId}::uuid, ${question}, ${text.slice(0, 4000)}, now())`).catch(() => undefined);
      }
      // avisa o usuário
      await this.notifyUser(t.organizationId, t.requesterUserId, `Seu chamado ${t.subject} teve resposta do suporte. Acesse o sistema para ver.`).catch(() => undefined);
    }
    return this.getTicket(ctx, id, { master: true });
  }

  // ============================== AUTOATENDIMENTO SEGURO ==============================
  /** Estado inicial: é o próprio usuário logado? quais canais (whatsapp/email) existem? */
  async secureInfo(ctx: RequestContext, id: string): Promise<any> {
    this.requireUser(ctx);
    const t = await this.getTicket(ctx, id);
    const isSelf = t.requesterUserId === ctx.userId;
    const u = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.user.findFirst({ where: { id: t.requesterUserId ?? ctx.userId! }, select: { email: true, phone: true } })).catch(() => null);
    return { category: t.category, isSelf, hasEmail: !!u?.email, hasPhone: !!u?.phone, emailMask: mask(u?.email), phoneMask: maskPhone(u?.phone) };
  }

  /** Troca de senha pelo PRÓPRIO usuário logado (com senha atual). Não armazena segredo. */
  async changePasswordSelf(ctx: RequestContext, id: string, currentPassword: string, newPassword: string): Promise<any> {
    this.requireUser(ctx);
    const t = await this.getTicket(ctx, id);
    if (t.requesterUserId !== ctx.userId) throw new AppError(ErrorCode.Forbidden, "Só o próprio dono pode trocar a senha assim", 403);
    await this.auth.changeOwnPassword(ctx.userId!, currentPassword, newPassword);
    await this.postMessage(ctx, id, "sistema", "🔒 Senha alterada com sucesso (não exibida por segurança).");
    await this.audit(ctx, t.requesterUserId, "password_change", "self", id);
    await this.resolveSelf(ctx, id, "Senha alterada pelo próprio usuário.");
    return { ok: true };
  }

  /** Envia código de 5 dígitos no canal do dono da conta (autoriza troca sem senha atual / por terceiro). */
  async requestOtp(ctx: RequestContext, id: string, action: Action, channel: "whatsapp" | "email"): Promise<any> {
    this.requireUser(ctx);
    const t = await this.getTicket(ctx, id);
    const u = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.user.findFirst({ where: { id: t.requesterUserId ?? ctx.userId! }, select: { id: true, email: true, phone: true, name: true } }));
    if (!u) throw new AppError(ErrorCode.NotFound, "Usuário não encontrado", 404);
    const dest = channel === "email" ? u.email : u.phone;
    if (!dest) throw new AppError(ErrorCode.ValidationFailed, `Usuário sem ${channel === "email" ? "e-mail" : "WhatsApp"} cadastrado`, 400);
    const code = String(Math.floor(10000 + Math.random() * 90000));
    const codeHash = createHmac("sha256", this.secret()).update(code).digest("hex");
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.userAuthCode.create({ data: { organizationId: ctx.orgId!, userId: u.id, purpose: action, channel, codeHash, expiresAt: new Date(Date.now() + 15 * 60_000), meta: { ticketId: id } }, select: { id: true } }));
    await this.notifications.notify({ organizationId: ctx.orgId!, storeId: ctx.storeId ?? ctx.orgId!, whatsappPhone: channel === "whatsapp" ? u.phone : null, email: channel === "email" ? u.email : null, subject: "Código de autorização", text: `Seu código de autorização é: ${code}\nUse-o para autorizar a alteração solicitada no sistema. Válido por 15 minutos. Se não foi você, ignore.`, templateCode: "auth_code" }).catch(() => null);
    await this.postMessage(ctx, id, "sistema", `Código enviado por ${channel === "email" ? "e-mail" : "WhatsApp"}.`);
    return { ok: true, requestId: rec.id };
  }

  private async verifyOtp(ctx: RequestContext, requestId: string, action: Action, code: string): Promise<string> {
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.userAuthCode.findFirst({ where: { id: requestId, purpose: action } }));
    if (!rec) throw new AppError(ErrorCode.NotFound, "Autorização não encontrada", 404);
    if (rec.usedAt) throw new AppError(ErrorCode.Conflict, "Código já utilizado", 409);
    if (rec.expiresAt.getTime() < Date.now()) throw new AppError(ErrorCode.ValidationFailed, "Código expirado", 400);
    if ((rec.attempts ?? 0) >= 5) throw new AppError(ErrorCode.ValidationFailed, "Tentativas esgotadas", 400);
    const hash = createHmac("sha256", this.secret()).update(String(code)).digest("hex");
    const ok = hash.length === rec.codeHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(rec.codeHash));
    if (!ok) { await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.userAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } })); throw new AppError(ErrorCode.ValidationFailed, "Código incorreto", 400); }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.userAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }));
    return rec.userId;
  }

  /** Aplica a ação após validar o código (senha nova / e-mail / telefone). */
  async applyWithOtp(ctx: RequestContext, id: string, action: Action, requestId: string, code: string, newValue: string): Promise<any> {
    this.requireUser(ctx);
    const t = await this.getTicket(ctx, id);
    const userId = await this.verifyOtp(ctx, requestId, action, code);
    if (userId !== (t.requesterUserId ?? ctx.userId)) throw new AppError(ErrorCode.Forbidden, "Autorização de outro usuário", 403);
    if (action === "password_change") {
      if ((newValue ?? "").length < 8) throw new AppError(ErrorCode.ValidationFailed, "A nova senha precisa ter ao menos 8 caracteres", 400);
      const passwordHash = await this.argon.hash(newValue);
      await this.prisma.runWithContext(ADM, (tx) => tx.user.update({ where: { id: userId }, data: { passwordHash, mustResetPassword: false } }));
      await this.postMessage(ctx, id, "sistema", "🔒 Senha redefinida com sucesso (não exibida por segurança).");
    } else if (action === "email_change") {
      const email = (newValue ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError(ErrorCode.ValidationFailed, "E-mail inválido", 400);
      await this.prisma.runWithContext(ADM, (tx) => tx.user.update({ where: { id: userId }, data: { email } }));
      await this.postMessage(ctx, id, "sistema", `✉️ E-mail atualizado para ${mask(email)}.`);
    } else {
      const phone = (newValue ?? "").replace(/\D/g, "");
      if (phone.length < 10) throw new AppError(ErrorCode.ValidationFailed, "Telefone inválido", 400);
      await this.prisma.runWithContext(ADM, (tx) => tx.user.update({ where: { id: userId }, data: { phone } }));
      await this.postMessage(ctx, id, "sistema", `📱 Telefone atualizado para ${maskPhone(phone)}.`);
    }
    await this.audit(ctx, userId, action, "code", id);
    await this.resolveSelf(ctx, id, `${action} concluído via código de autorização.`);
    return { ok: true };
  }

  /** Sem acesso ao e-mail/WhatsApp → escala pro master verificar manualmente. */
  async escalateNoAccess(ctx: RequestContext, id: string): Promise<any> {
    this.requireUser(ctx);
    await this.getTicket(ctx, id);
    await this.postMessage(ctx, id, "usuario", "Não tenho acesso ao e-mail/WhatsApp cadastrado. Preciso de ajuda do suporte.");
    await this.setStatus(ctx, id, "aguardando_master");
    await this.notifyMasterNew(id).catch(() => undefined);
    return this.getTicket(ctx, id);
  }

  // ============================== helpers ==============================
  private async postMessage(ctx: RequestContext, ticketId: string, author: string, body: string): Promise<void> {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportMessage.create({ data: { organizationId: ctx.orgId!, ticketId, author, authorUserId: author === "usuario" ? ctx.userId! : null, body } }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } }));
  }
  private async setStatus(ctx: RequestContext, ticketId: string, status: string): Promise<void> {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.update({ where: { id: ticketId }, data: { status } }));
  }
  private async resolveSelf(ctx: RequestContext, ticketId: string, resolution: string): Promise<void> {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformSupportTicket.update({ where: { id: ticketId }, data: { status: "resolvido", resolution, resolvedAt: new Date() } }));
  }
  private async audit(ctx: RequestContext, targetUserId: string | null, action: string, via: string, ticketId: string): Promise<void> {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.credentialAudit.create({ data: { organizationId: ctx.orgId!, userId: targetUserId, action, via, performedByUserId: ctx.userId ?? null, ticketId } })).catch(() => undefined);
  }
  private async notifyMasterNew(ticketId: string): Promise<void> {
    const t = await this.prisma.runWithContext(ADM, (tx) => tx.platformSupportTicket.findFirst({ where: { id: ticketId }, select: { subject: true, requesterName: true, organizationId: true } }));
    if (!t) return;
    const phone = process.env.MASTER_SUPPORT_WHATSAPP || null;
    const email = process.env.MASTER_SUPPORT_EMAIL || null;
    if (!phone && !email) return;
    const org = await this.prisma.runWithContext(ADM, (tx) => tx.organization.findFirst({ where: { id: t.organizationId }, select: { name: true, slug: true } })).catch(() => null);
    await this.notifications.notify({ organizationId: t.organizationId, storeId: t.organizationId, whatsappPhone: phone, email, subject: `Novo chamado de suporte — ${org?.name ?? ""}`, text: `Novo chamado no suporte do sistema:\nEmpresa: ${org?.name ?? t.organizationId}\nDe: ${t.requesterName ?? ""}\nAssunto: ${t.subject}`, templateCode: "support_master" }).catch(() => undefined);
  }
  private async notifyUser(orgId: string, userId: string | null, text: string): Promise<void> {
    if (!userId) return;
    const u = await this.prisma.runWithContext(ADM, (tx) => tx.user.findFirst({ where: { id: userId }, select: { email: true, phone: true } })).catch(() => null);
    if (!u?.email && !u?.phone) return;
    await this.notifications.notify({ organizationId: orgId, storeId: orgId, whatsappPhone: u.phone, email: u.email, subject: "Resposta do suporte", text, templateCode: "support_reply" }).catch(() => undefined);
  }
}

function mask(s?: string | null): string { if (!s) return ""; const [a, b] = s.split("@"); if (!b) return s.slice(0, 2) + "***"; return `${(a ?? "").slice(0, 2)}***@${b}`; }
function maskPhone(s?: string | null): string { if (!s) return ""; const d = s.replace(/\D/g, ""); return d.length >= 4 ? `***${d.slice(-4)}` : "***"; }
