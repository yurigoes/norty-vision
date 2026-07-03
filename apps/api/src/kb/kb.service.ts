import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrgAiService } from "../ai/org-ai.service";
import { InboxService } from "../inbox/inbox.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Base de conhecimento / central de ajuda do call center.
 * Perguntas frequentes + respostas que o operador edita/publica, envia ao
 * cliente na conversa, e o cliente vê no portal.
 */
@Injectable()
export class KbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAi: OrgAiService,
    private readonly inbox: InboxService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private orgId(ctx: RequestContext): string {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId!;
  }

  async list(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.kbEntry.findMany({ where: { status: { not: "archived" } }, orderBy: [{ status: "asc" }, { displayOrder: "asc" }, { createdAt: "desc" }], take: 500 }));
  }

  async upsert(ctx: RequestContext, input: { id?: string; question: string; answer: string; topic?: string; status?: "draft" | "published"; aiGenerated?: boolean }) {
    const orgId = this.orgId(ctx);
    if (!input.question?.trim() || !input.answer?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Pergunta e resposta são obrigatórias", 400);
    const data: any = {
      question: input.question.trim(), answer: input.answer.trim(),
      topic: input.topic ?? null, status: input.status ?? "draft", aiGenerated: !!input.aiGenerated,
    };
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.kbEntry.update({ where: { id: input.id }, data }) : tx.kbEntry.create({ data: { ...data, organizationId: orgId, createdBy: ctx.userId ?? null } }),
    ).then((r) => ({ id: r.id }));
  }

  async setStatus(ctx: RequestContext, id: string, status: "draft" | "published" | "archived") {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.kbEntry.update({ where: { id }, data: { status } })).then(() => ({ ok: true }));
  }

  async remove(ctx: RequestContext, id: string) {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.kbEntry.update({ where: { id }, data: { status: "archived" } }));
    return { ok: true };
  }

  /** Rascunho de resposta por IA (usa as conexões da empresa). */
  async aiDraft(ctx: RequestContext, question: string, samples?: string[]) {
    const orgId = this.orgId(ctx);
    const system = "Você ajuda uma ótica a escrever uma resposta padrão (FAQ) para uma dúvida de cliente. Português do Brasil, cordial, clara e curta (até 4 frases). Não invente dados específicos (preços, prazos exatos) — oriente como descobrir ou a falar com a equipe quando preciso. Responda só com o texto da resposta.";
    const user = `Dúvida: ${question}\n${samples?.length ? `Exemplos reais:\n${samples.slice(0, 5).map((s) => `- ${s}`).join("\n")}` : ""}`;
    const out = await this.orgAi.complete(orgId, system, user, 250).catch(() => null);
    return { suggestion: out?.trim() || null };
  }

  /** Envia a resposta de uma entrada da base ao cliente, na conversa. */
  async sendToConversation(ctx: RequestContext, conversationId: string, kbId: string) {
    const kb = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.kbEntry.findFirst({ where: { id: kbId } }));
    if (!kb) throw new AppError(ErrorCode.NotFound, "Resposta não encontrada", 404);
    await this.inbox.sendMessage(ctx, conversationId, { body: kb.answer });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.kbEntry.update({ where: { id: kbId }, data: { usageCount: { increment: 1 } } })).catch(() => undefined);
    return { ok: true };
  }
}
