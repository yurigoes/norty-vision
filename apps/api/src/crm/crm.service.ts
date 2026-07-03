import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeWhatsappBR } from "../common/phone";
import type { RequestContext } from "../auth/session.middleware";

const ADM = { isPlatformAdmin: true as const };
export const CRM_STAGES = ["novo", "em_contato", "qualificado", "proposta", "negociacao", "ganho", "perdido"] as const;
type Stage = (typeof CRM_STAGES)[number];
const OPEN_STAGES = ["novo", "em_contato", "qualificado", "proposta", "negociacao"];

interface CreateInput { name: string; phone?: string | null; email?: string | null; source?: string; tags?: string[]; ownerMembershipId?: string | null; }

@Injectable()
export class CrmService {
  private readonly logger = new Logger("CRM");
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403); }

  // ============================== LEADS ==============================
  async create(ctx: RequestContext, input: CreateInput): Promise<any> {
    this.requireOrg(ctx);
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome", 400);
    const phone = input.phone ? normalizeWhatsappBR(input.phone) : null;
    const lead = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.create({
      data: {
        organizationId: ctx.orgId!, storeId: ctx.storeId ?? null, name: input.name.trim(), phone, email: input.email?.trim() || null,
        source: input.source ?? "manual", stage: "novo", status: "aberto", ownerMembershipId: input.ownerMembershipId ?? null,
        tags: input.tags ?? [], score: this.baseScore(input.source ?? "manual"),
      },
      select: { id: true },
    }));
    await this.addEventRaw(ctx, lead.id, { kind: "system", title: `Lead criado · origem ${input.source ?? "manual"}` });
    return this.getLead(ctx, lead.id);
  }

  /** Fila de contatos novos (sem dono ou stage=novo). */
  async fila(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.findMany({
      where: { status: "aberto", OR: [{ stage: "novo" }, { ownerMembershipId: null }] },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: 200,
      select: this.listSel(),
    }));
  }

  /** "Meus atendimentos": operador vê os dele; admin vê os da empresa. */
  async mine(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    const where: any = { status: "aberto", stage: { in: OPEN_STAGES } };
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) where.ownerMembershipId = ctx.membershipId ?? "00000000-0000-0000-0000-000000000000";
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.findMany({ where, orderBy: { lastEventAt: "desc" }, take: 300, select: this.listSel() }));
  }

  /** Kanban: leads por etapa. */
  async board(ctx: RequestContext): Promise<any> {
    this.requireOrg(ctx);
    const where: any = {};
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) where.ownerMembershipId = ctx.membershipId ?? "00000000-0000-0000-0000-000000000000";
    const leads = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.findMany({ where, orderBy: { lastEventAt: "desc" }, take: 500, select: this.listSel() }));
    const byStage: Record<string, any[]> = {};
    for (const s of CRM_STAGES) byStage[s] = [];
    for (const l of leads) (byStage[l.stage] ?? (byStage[l.stage] = [])).push(l);
    return { stages: CRM_STAGES, byStage };
  }

  async getLead(ctx: RequestContext, id: string): Promise<any> {
    this.requireOrg(ctx);
    const lead = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.findFirst({
      where: { id },
      include: { events: { orderBy: { createdAt: "asc" } }, tasks: { orderBy: { dueAt: "asc" } } },
    }));
    if (!lead) throw new AppError(ErrorCode.NotFound, "Lead não encontrado", 404);
    // operador só vê o dele (a menos que sem dono / admin)
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin && lead.ownerMembershipId && lead.ownerMembershipId !== ctx.membershipId) {
      throw new AppError(ErrorCode.Forbidden, "Sem acesso a este lead", 403);
    }
    return lead;
  }

  /** Operador "pega" o lead. */
  async claim(ctx: RequestContext, id: string): Promise<any> {
    this.requireOrg(ctx);
    if (!ctx.membershipId) throw new AppError(ErrorCode.Forbidden, "Sem operador", 403);
    const lead = await this.getLead(ctx, id);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data: { ownerMembershipId: ctx.membershipId!, stage: lead.stage === "novo" ? "em_contato" : lead.stage } }));
    await this.addEventRaw(ctx, id, { kind: "assigned", title: "Lead atribuído (pego pelo operador)" });
    return this.getLead(ctx, id);
  }

  /** Muda etapa. Ganho/Perdido EXIGEM tabulação. */
  async setStage(ctx: RequestContext, id: string, stage: string, opts?: { tabulation?: string; lostReason?: string }): Promise<any> {
    this.requireOrg(ctx);
    if (!CRM_STAGES.includes(stage as Stage)) throw new AppError(ErrorCode.ValidationFailed, "Etapa inválida", 400);
    await this.getLead(ctx, id);
    const isClose = stage === "ganho" || stage === "perdido";
    if (isClose && !opts?.tabulation?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Tabulação obrigatória para fechar o lead", 400);
    const data: any = { stage };
    if (isClose) { data.status = stage; data.tabulation = opts!.tabulation; if (stage === "perdido") data.lostReason = opts?.lostReason ?? null; }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data }));
    if (isClose && opts?.tabulation) await this.addEventRaw(ctx, id, { kind: "tabulation", title: `Tabulação: ${opts.tabulation}`, tabulation: opts.tabulation });
    const label = stage === "ganho" ? "Fechado: GANHO 🎉" : stage === "perdido" ? `Fechado: PERDIDO${opts?.lostReason ? ` — ${opts.lostReason}` : ""}` : `Mudou para ${stage}`;
    await this.addEventRaw(ctx, id, { kind: "stage_change", title: label });
    return this.getLead(ctx, id);
  }

  /** Registra interação (ligação/nota). Ligação EXIGE tabulação (regra: tudo que fecha é tabulado). */
  async addInteraction(ctx: RequestContext, id: string, input: { kind: "call" | "note" | "whatsapp_out" | "email"; body?: string; tabulation?: string }): Promise<any> {
    this.requireOrg(ctx);
    await this.getLead(ctx, id);
    if (input.kind === "call" && !input.tabulation?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Tabulação obrigatória ao registrar a ligação", 400);
    const titles: Record<string, string> = { call: "Ligação registrada", note: "Nota", whatsapp_out: "WhatsApp enviado", email: "E-mail enviado" };
    await this.addEventRaw(ctx, id, { kind: input.kind, title: titles[input.kind] ?? "Interação", body: input.body ?? null });
    if (input.tabulation?.trim()) {
      await this.addEventRaw(ctx, id, { kind: "tabulation", title: `Tabulação: ${input.tabulation}`, tabulation: input.tabulation });
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data: { tabulation: input.tabulation } }));
    }
    await this.bumpScore(ctx, id);
    return this.getLead(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: { tags?: string[]; ownerMembershipId?: string | null; nextActionAt?: string | null }): Promise<any> {
    this.requireOrg(ctx);
    await this.getLead(ctx, id);
    const data: any = {};
    if (input.tags) data.tags = input.tags;
    if (input.ownerMembershipId !== undefined) data.ownerMembershipId = input.ownerMembershipId;
    if (input.nextActionAt !== undefined) data.nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data }));
    return this.getLead(ctx, id);
  }

  // ============================== TAREFAS (follow-up) ==============================
  async addTask(ctx: RequestContext, id: string, input: { title: string; dueAt?: string | null }): Promise<any> {
    this.requireOrg(ctx);
    await this.getLead(ctx, id);
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmTask.create({ data: { organizationId: ctx.orgId!, leadId: id, title: input.title.trim(), dueAt, ownerMembershipId: ctx.membershipId ?? null } }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data: { nextActionAt: dueAt ?? undefined } }));
    await this.addEventRaw(ctx, id, { kind: "task", title: `Follow-up: ${input.title.trim()}${dueAt ? ` (${dueAt.toLocaleString("pt-BR")})` : ""}` });
    return this.getLead(ctx, id);
  }
  async completeTask(ctx: RequestContext, taskId: string): Promise<any> {
    this.requireOrg(ctx);
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmTask.findFirst({ where: { id: taskId } }));
    if (!t) throw new AppError(ErrorCode.NotFound, "Tarefa não encontrada", 404);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmTask.update({ where: { id: taskId }, data: { doneAt: new Date() } }));
    await this.addEventRaw(ctx, t.leadId, { kind: "task_done", title: `Follow-up concluído: ${t.title}` });
    return this.getLead(ctx, t.leadId);
  }

  // ============================== VÍDEO (Jitsi) ==============================
  /** Cria uma sala Jitsi (vídeo ou áudio) p/ o lead, registra na timeline e devolve a URL.
   *  Default meet.jit.si (grátis, sem infra; sem número). Self-host depois: env JITSI_BASE_URL.
   *  audio=true → sala áudio-only (chamada de voz por link, cliente entra pelo navegador). */
  async startMeeting(ctx: RequestContext, id: string, audio = false): Promise<{ url: string }> {
    this.requireOrg(ctx);
    await this.getLead(ctx, id);
    const base = (process.env.JITSI_BASE_URL || "https://meet.jit.si").replace(/\/$/, "");
    const room = `yugo-${randomBytes(6).toString("hex")}`;
    const url = audio ? `${base}/${room}#config.startAudioOnly=true` : `${base}/${room}`;
    await this.addEventRaw(ctx, id, { kind: audio ? "call" : "video", title: audio ? "Chamada de áudio (link WebRTC)" : "Sala de vídeo criada", body: url });
    return { url };
  }

  // ============================== TABULAÇÕES (reusa inbox) ==============================
  async tabulations(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversationTabulation.findMany({ where: { isActive: true }, orderBy: [{ groupName: "asc" }, { name: "asc" }], select: { id: true, name: true, groupName: true } }));
  }

  // ============================== SUPERVISÃO ==============================
  async supervision(ctx: RequestContext): Promise<any> {
    this.requireOrg(ctx);
    const now = new Date();
    const [porEtapa, novos, ganhosHoje, followupsVencidos] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.groupBy({ by: ["stage"], _count: { _all: true } })).catch(() => [] as any[]),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.count({ where: { status: "aberto", stage: "novo" } })).catch(() => 0),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.count({ where: { stage: "ganho", updatedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } })).catch(() => 0),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmTask.count({ where: { doneAt: null, dueAt: { lt: now } } })).catch(() => 0),
    ]);
    const stageCounts: Record<string, number> = {};
    for (const r of porEtapa as any[]) stageCounts[r.stage] = r._count._all;
    return { stageCounts, novos, ganhosHoje, followupsVencidos };
  }

  // ============================== CAPTURA AUTOMÁTICA (WhatsApp inbound) ==============================
  /** Chamado pelo webhook: cria/atualiza um lead a partir de uma mensagem recebida.
   *  Best-effort — nunca lança (não pode quebrar o webhook). Dedup por telefone. */
  async captureInbound(opts: { organizationId: string; storeId?: string | null; phone?: string | null; name?: string | null; customerId?: string | null; channel?: string; protocol?: string | null }): Promise<void> {
    try {
      const phone = opts.phone ? normalizeWhatsappBR(opts.phone) : null;
      if (!phone && !opts.customerId) return;
      const ctxLike = ADM as any;
      const orgScope = { orgId: opts.organizationId } as any;
      const existing = await this.prisma.runWithContext(orgScope, (tx) => tx.crmLead.findFirst({
        where: { status: "aberto", OR: [phone ? { phone } : undefined, opts.customerId ? { customerId: opts.customerId } : undefined].filter(Boolean) as any },
        orderBy: { createdAt: "desc" }, select: { id: true },
      })).catch(() => null);
      if (existing) {
        await this.prisma.runWithContext(orgScope, (tx) => tx.crmLeadEvent.create({ data: { organizationId: opts.organizationId, leadId: existing.id, kind: "whatsapp_in", title: "WhatsApp recebido", protocol: opts.protocol ?? null } }));
        await this.prisma.runWithContext(orgScope, (tx) => tx.crmLead.update({ where: { id: existing.id }, data: { lastEventAt: new Date() } }));
        return;
      }
      const lead = await this.prisma.runWithContext(orgScope, (tx) => tx.crmLead.create({
        data: { organizationId: opts.organizationId, storeId: opts.storeId ?? null, customerId: opts.customerId ?? null, name: opts.name?.trim() || phone || "Contato", phone, source: opts.channel ?? "whatsapp", stage: "novo", status: "aberto", protocol: opts.protocol ?? null, score: this.baseScore(opts.channel ?? "whatsapp") },
        select: { id: true },
      }));
      await this.prisma.runWithContext(orgScope, (tx) => tx.crmLeadEvent.createMany({ data: [
        { organizationId: opts.organizationId, leadId: lead.id, kind: "system", title: `Lead criado · origem ${opts.channel ?? "whatsapp"}`, protocol: opts.protocol ?? null },
        { organizationId: opts.organizationId, leadId: lead.id, kind: "whatsapp_in", title: "WhatsApp recebido", protocol: opts.protocol ?? null },
      ] }));
      void ctxLike;
    } catch (e: any) {
      this.logger.warn(`captureInbound falhou: ${e?.message}`);
    }
  }

  /** Cria um lead em contexto de sistema (ex.: Prospector). Dedup por telefone. Retorna o id ou null.
   *  scoreBoost: pontos extras de qualidade (ex.: tem site/email/telefone), cap 100. */
  async createSystemLead(orgId: string, input: { name: string; phone?: string | null; email?: string | null; source: string; storeId?: string | null; scoreBoost?: number }): Promise<string | null> {
    try {
      const orgScope = { orgId } as any;
      const phone = input.phone ? normalizeWhatsappBR(input.phone) : null;
      if (phone) {
        const ex = await this.prisma.runWithContext(orgScope, (tx) => tx.crmLead.findFirst({ where: { phone, status: "aberto" }, select: { id: true } })).catch(() => null);
        if (ex) return ex.id;
      }
      const score = Math.min(100, this.baseScore(input.source) + Math.max(0, Math.trunc(input.scoreBoost ?? 0)));
      const lead = await this.prisma.runWithContext(orgScope, (tx) => tx.crmLead.create({ data: { organizationId: orgId, storeId: input.storeId ?? null, name: input.name.trim() || phone || "Lead", phone, email: input.email?.trim() || null, source: input.source, stage: "novo", status: "aberto", score }, select: { id: true } }));
      await this.prisma.runWithContext(orgScope, (tx) => tx.crmLeadEvent.create({ data: { organizationId: orgId, leadId: lead.id, kind: "system", title: `Lead criado · ${input.source}` } }));
      return lead.id;
    } catch (e: any) { this.logger.warn(`createSystemLead falhou: ${e?.message}`); return null; }
  }

  // ============================== helpers ==============================
  private listSel() {
    return { id: true, name: true, phone: true, email: true, source: true, stage: true, status: true, score: true, ownerMembershipId: true, protocol: true, tags: true, nextActionAt: true, lastEventAt: true, createdAt: true } as const;
  }
  private async addEventRaw(ctx: RequestContext, leadId: string, ev: { kind: string; title: string; body?: string | null; tabulation?: string; protocol?: string | null }): Promise<void> {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLeadEvent.create({ data: { organizationId: ctx.orgId!, leadId, kind: ev.kind, title: ev.title, body: ev.body ?? null, tabulation: ev.tabulation ?? null, protocol: ev.protocol ?? null, authorMembershipId: ctx.membershipId ?? null } }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id: leadId }, data: { lastEventAt: new Date() } }));
  }
  /** Score base por origem (determinístico, simples). */
  private baseScore(source: string): number {
    const map: Record<string, number> = { whatsapp: 60, webchat: 55, site: 50, email: 45, prospector: 35, import: 30, manual: 40 };
    return map[source] ?? 40;
  }
  /** Recalcula score: base + interações (cap 100). */
  private async bumpScore(ctx: RequestContext, id: string): Promise<void> {
    const n = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLeadEvent.count({ where: { leadId: id, kind: { in: ["call", "whatsapp_in", "whatsapp_out", "email"] } } })).catch(() => 0);
    const lead = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.findFirst({ where: { id }, select: { source: true } }));
    const score = Math.min(100, this.baseScore(lead?.source ?? "manual") + n * 6);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.update({ where: { id }, data: { score } })).catch(() => undefined);
  }
}
