import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrgAiService } from "./org-ai.service";
import { EmbeddingService } from "./embedding.service";
import type { RequestContext } from "../auth/session.middleware";

type EventType = "answered" | "uncertain" | "fallback" | "handoff" | "tool" | "human_teach";

export interface RecordInput {
  storeId?: string | null;
  conversationId?: string | null;
  botSessionId?: string | null;
  module?: string;
  eventType: EventType;
  question?: string | null;
  response?: string | null;
  provider?: string | null;
  model?: string | null;
  confidence?: number | null;
}

// eventos que contam como "dúvida" (gargalo) pra intervenção humana
const DOUBT_TYPES = ["uncertain", "fallback", "handoff"];

/**
 * Ecossistema de IA proprietário — FASE 1 (fundação).
 * Registra a telemetria do bot por empresa (multi-tenant isolado) e expõe
 * assertividade, gargalos e as "dúvidas da IA" pra intervenção humana. Quando o
 * humano ensina, vira entrada da base de conhecimento (KB) que o bot já usa.
 *
 * FUTURO (Fase 2+): memória vetorial/embeddings por empresa, score de
 * aprendizado contínuo e migração parcial p/ modelos locais (Llama/DeepSeek/
 * Qwen/Mistral via baseUrl no OrgAiProvider). A estrutura aqui já isola por org.
 */
@Injectable()
export class AiLearningService {
  private readonly logger = new Logger("AiLearning");
  constructor(private readonly prisma: PrismaService, private readonly orgAi: OrgAiService, private readonly embeddings: EmbeddingService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private trunc(s?: string | null, n = 2000): string | null {
    if (!s) return null;
    return s.length > n ? s.slice(0, n) : s;
  }

  /**
   * RECUPERAÇÃO (RAG-lite, Fase 2): retorna as respostas da base de conhecimento
   * MAIS RELEVANTES à pergunta, via full-text nativo do Postgres. Se o índice
   * ainda não existe ou a busca falha, cai pro fallback (ordem de exibição) —
   * nunca quebra o bot. Estrutura pronta pra somar embeddings depois.
   */
  async retrieveKnowledge(orgId: string, query: string, limit = 8): Promise<Array<{ question: string; answer: string }>> {
    const q = (query ?? "").trim();
    const out: Array<{ question: string; answer: string }> = [];
    const seen = new Set<string>();
    const add = (rows: Array<{ question: string; answer: string }>) => {
      for (const r of rows) {
        const key = (r.question ?? "").toLowerCase();
        if (key && !seen.has(key)) { seen.add(key); out.push({ question: r.question, answer: r.answer }); }
        if (out.length >= limit) break;
      }
    };

    // 1) SEMÂNTICO (pgvector) — quando há serviço de embeddings configurado
    if (q.length >= 2 && this.embeddings.enabled()) {
      try {
        const vec = await this.embeddings.embed(q);
        if (vec) {
          const lit = this.embeddings.toLiteral(vec);
          const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.$queryRaw<Array<{ question: string; answer: string }>>`
              SELECT k.question, k.answer FROM kb_embeddings e
              JOIN kb_entries k ON k.id = e.kb_id
              WHERE e.organization_id = ${orgId}::uuid AND k.status = 'published'
              ORDER BY e.embedding <=> ${lit}::vector
              LIMIT ${limit}`,
          );
          add(rows);
        }
      } catch (e: any) {
        this.logger.warn(`retrieveKnowledge vetor indisponível: ${e?.message ?? e}`);
      }
    }
    if (out.length >= limit) return out;

    // 2) FULL-TEXT (nativo) — completa/serve quando não há vetor
    if (q.length >= 2) {
      try {
        const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.$queryRaw<Array<{ question: string; answer: string }>>`
            SELECT question, answer FROM kb_entries
            WHERE organization_id = ${orgId}::uuid AND status = 'published'
              AND search_tsv @@ plainto_tsquery('portuguese', ${q})
            ORDER BY ts_rank(search_tsv, plainto_tsquery('portuguese', ${q})) DESC
            LIMIT ${limit}`,
        );
        add(rows);
      } catch (e: any) {
        this.logger.warn(`retrieveKnowledge FTS indisponível: ${e?.message ?? e}`);
      }
    }
    if (out.length > 0) return out;

    // 3) fallback: base publicada por ordem de exibição (comportamento legado)
    return this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.kbEntry.findMany({ where: { organizationId: orgId, status: "published" }, orderBy: { displayOrder: "asc" }, take: limit, select: { question: true, answer: true } }),
      )
      .catch(() => [] as Array<{ question: string; answer: string }>);
  }

  /** Gera e grava o embedding de uma entrada da KB (best-effort). */
  async indexKb(orgId: string, kbId: string, text: string): Promise<void> {
    if (!this.embeddings.enabled()) return;
    try {
      const vec = await this.embeddings.embed(text);
      if (!vec) return;
      const lit = this.embeddings.toLiteral(vec);
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`
          INSERT INTO kb_embeddings (kb_id, organization_id, model, embedding)
          VALUES (${kbId}::uuid, ${orgId}::uuid, ${process.env.EMBEDDINGS_MODEL ?? "bge-m3"}, ${lit}::vector)
          ON CONFLICT (kb_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, updated_at = now()`,
      );
    } catch (e: any) {
      this.logger.warn(`indexKb falhou (${kbId}): ${e?.message ?? e}`);
    }
  }

  /** Reindexa (embeddings) a base publicada da empresa que ainda não tem vetor. */
  async backfillEmbeddings(ctx: RequestContext): Promise<{ enabled: boolean; indexed: number; pending: number }> {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!this.embeddings.enabled()) return { enabled: false, indexed: 0, pending: 0 };
    const pendings = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.$queryRaw<Array<{ id: string; question: string; answer: string }>>`
        SELECT k.id, k.question, k.answer FROM kb_entries k
        LEFT JOIN kb_embeddings e ON e.kb_id = k.id
        WHERE k.organization_id = ${ctx.orgId}::uuid AND k.status = 'published' AND e.kb_id IS NULL
        LIMIT 200`,
    ).catch(() => [] as Array<{ id: string; question: string; answer: string }>);
    let indexed = 0;
    for (const k of pendings) {
      await this.indexKb(ctx.orgId, k.id, `${k.question}\n${k.answer}`);
      indexed++;
    }
    return { enabled: true, indexed, pending: pendings.length };
  }

  /** Status do RAG semântico (pra UI). */
  embeddingsStatus() {
    return { enabled: this.embeddings.enabled(), model: process.env.EMBEDDINGS_MODEL ?? "bge-m3" };
  }

  /** Registra um evento do bot. Best-effort: NUNCA propaga erro pro chamador. */
  async record(orgId: string, input: RecordInput): Promise<void> {
    try {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.aiLearningEvent.create({
          data: {
            organizationId: orgId,
            storeId: input.storeId ?? null,
            conversationId: input.conversationId ?? null,
            botSessionId: input.botSessionId ?? null,
            module: input.module ?? "atendimento",
            eventType: input.eventType,
            question: this.trunc(input.question),
            response: this.trunc(input.response),
            provider: input.provider ?? null,
            model: input.model ?? null,
            confidence: input.confidence ?? null,
          },
        }),
      );
    } catch (e: any) {
      this.logger.warn(`record falhou: ${e?.message ?? e}`);
    }
  }

  /** Painel de aprendizado da empresa: assertividade, contagens, gargalos. */
  async statsForOrg(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const core = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const where = ctx.orgId ? { organizationId: ctx.orgId } : {};
      const byType = await tx.aiLearningEvent.groupBy({ by: ["eventType"], where, _count: { _all: true } });
      const byModule = await tx.aiLearningEvent.groupBy({ by: ["module"], where, _count: { _all: true } });
      const pendingDoubts = await tx.aiLearningEvent.count({ where: { ...where, eventType: { in: DOUBT_TYPES }, resolved: false } });
      const helpfulYes = await tx.aiLearningEvent.count({ where: { ...where, helpful: true } });
      const helpfulNo = await tx.aiLearningEvent.count({ where: { ...where, helpful: false } });
      const counts: Record<string, number> = {};
      for (const r of byType) counts[r.eventType] = r._count._all;
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      const answered = counts["answered"] ?? 0;
      const doubts = (counts["uncertain"] ?? 0) + (counts["fallback"] ?? 0) + (counts["handoff"] ?? 0);
      const base = answered + doubts;
      const assertiveness = base > 0 ? Math.round((answered / base) * 100) : null;
      const ratedBase = helpfulYes + helpfulNo;
      const helpfulRate = ratedBase > 0 ? Math.round((helpfulYes / ratedBase) * 100) : null;
      return {
        total,
        assertiveness, // % de respostas resolvidas pela IA sem virar dúvida
        helpfulRate, // % de respostas avaliadas como úteis (👍)
        counts,
        byModule: byModule.map((m) => ({ module: m.module, count: m._count._all })),
        pendingDoubts,
      };
    });
    const trend = await this.weeklyTrend(ctx.orgId ?? undefined);
    return { ...core, trend };
  }

  /** Dúvidas/gargalos não resolvidos (pra intervenção humana).
   *  No master (sem orgId) retorna de TODAS as empresas, com o nome da empresa. */
  async doubts(ctx: RequestContext, opts?: { resolved?: boolean }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.aiLearningEvent.findMany({
        where: { ...(ctx.orgId ? { organizationId: ctx.orgId } : {}), eventType: { in: DOUBT_TYPES }, resolved: opts?.resolved ?? false },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
    return this.attachOrgNames(ctx, rows);
  }

  /** Anexa nome+nicho da empresa quando é visão master (cross-tenant). No-op por empresa. */
  private async attachOrgNames<T extends { organizationId?: string | null }>(ctx: RequestContext, rows: T[]): Promise<Array<T & { organizationName?: string | null; organizationNiche?: string | null }>> {
    if (ctx.orgId || !ctx.isPlatformAdmin) return rows as any;
    const ids = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    if (!ids.length) return rows as any;
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, niche: true } }),
    ).catch(() => [] as Array<{ id: string; name: string; niche: string | null }>);
    const nm = new Map(orgs.map((o) => [o.id, o]));
    return rows.map((r) => ({ ...r, organizationName: r.organizationId ? nm.get(r.organizationId)?.name ?? null : null, organizationNiche: r.organizationId ? nm.get(r.organizationId)?.niche ?? null : null }));
  }

  /** O humano ENSINA a IA: cria/atualiza a resposta na base (KB publicada) e
   *  marca a dúvida como resolvida. O bot passa a usar essa resposta. */
  async teach(ctx: RequestContext, eventId: string, input: { question: string; answer: string; topic?: string | null }) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    if (!input.question?.trim() || !input.answer?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Pergunta e resposta são obrigatórias", 400);
    const created = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const ev = await tx.aiLearningEvent.findFirst({ where: { id: eventId } });
      if (!ev) throw new AppError(ErrorCode.NotFound, "Evento não encontrado", 404);
      const kb = await tx.kbEntry.create({
        data: { organizationId: ctx.orgId!, question: input.question.trim(), answer: input.answer.trim(), topic: input.topic ?? null, status: "published", aiGenerated: false, createdBy: ctx.userId ?? null },
        select: { id: true },
      });
      await tx.aiLearningEvent.update({ where: { id: eventId }, data: { resolved: true, reviewedByUserId: ctx.userId ?? null } });
      await tx.aiLearningEvent.create({
        data: { organizationId: ctx.orgId!, module: ev.module, eventType: "human_teach", question: input.question.trim(), response: input.answer.trim(), resolved: true, reviewedByUserId: ctx.userId ?? null },
      });
      return kb;
    });
    // indexa o embedding fora da transação (best-effort; não quebra o ensinar)
    void this.indexKb(ctx.orgId, created.id, `${input.question.trim()}\n${input.answer.trim()}`);
    return { ok: true };
  }

  /** Dispensa uma dúvida sem ensinar (marca resolvida). */
  async dismiss(ctx: RequestContext, eventId: string) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.aiLearningEvent.updateMany({ where: { id: eventId }, data: { resolved: true, reviewedByUserId: ctx.userId ?? null } }));
    return { ok: true };
  }

  /** Auto-rascunho (IA) de resposta pra uma dúvida — acelera o "ensinar". */
  async draftAnswer(ctx: RequestContext, eventId: string): Promise<{ suggestion: string | null }> {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const ev = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.aiLearningEvent.findFirst({ where: { id: eventId }, select: { question: true } }));
    if (!ev?.question) throw new AppError(ErrorCode.NotFound, "Dúvida não encontrada", 404);
    // contexto: respostas relevantes já existentes na base
    const kb = await this.retrieveKnowledge(ctx.orgId, ev.question, 5);
    const kbText = kb.length ? `\nRespostas que já temos (use como base, não repita literalmente):\n${kb.map((k) => `P: ${k.question}\nR: ${k.answer}`).join("\n---\n")}` : "";
    const system = "Você ajuda uma empresa a escrever a resposta padrão (FAQ) para uma dúvida de cliente que a IA não soube responder. Português do Brasil, cordial, clara e curta (até 4 frases). Não invente dados específicos (preços, prazos exatos); oriente como descobrir ou falar com a equipe quando preciso. Responda só com o texto da resposta.";
    const user = `Dúvida do cliente: ${ev.question}${kbText}`;
    const out = await this.orgAi.complete(ctx.orgId, system, user, 280).catch(() => null);
    return { suggestion: out?.trim() || null };
  }

  /** Feedback 👍/👎 numa resposta do bot (alimenta o score). */
  async rate(ctx: RequestContext, eventId: string, helpful: boolean) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.aiLearningEvent.updateMany({ where: { id: eventId }, data: { helpful, reviewedByUserId: ctx.userId ?? null } }));
    return { ok: true };
  }

  /** Respostas recentes do bot (pra avaliar 👍/👎).
   *  No master (sem orgId) retorna de TODAS as empresas, com o nome da empresa. */
  async recentAnswered(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.aiLearningEvent.findMany({
        where: { ...(ctx.orgId ? { organizationId: ctx.orgId } : {}), eventType: "answered" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, organizationId: true, conversationId: true, question: true, response: true, helpful: true, createdAt: true },
      }),
    );
    return this.attachOrgNames(ctx, rows);
  }

  /**
   * TRACE do fluxo da IA numa conversa: a sequência de passos (pergunta do
   * cliente → ferramentas chamadas com entrada→saída → resposta/handoff), em
   * ordem cronológica. É o "log de auditoria" pra entender o que a IA fez e onde
   * travou (ex.: pediu agendar → ver_horarios → agendar → respondeu).
   */
  async trace(ctx: RequestContext, conversationId: string) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.aiLearningEvent.findMany({
        where: { conversationId, ...(ctx.orgId ? { organizationId: ctx.orgId } : {}) },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, eventType: true, module: true, question: true, response: true, provider: true, model: true, confidence: true, helpful: true, createdAt: true },
      }),
    );
    return { conversationId, steps: rows };
  }

  /** Score de aprendizado ao longo do tempo: assertividade por semana (8 sem). */
  private async weeklyTrend(orgId?: string): Promise<Array<{ week: string; assertiveness: number | null; total: number }>> {
    try {
      const rows = orgId
        ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.$queryRaw<Array<{ wk: Date; answered: bigint; doubts: bigint }>>`
            SELECT date_trunc('week', created_at) AS wk,
              count(*) FILTER (WHERE event_type = 'answered') AS answered,
              count(*) FILTER (WHERE event_type IN ('uncertain','fallback','handoff')) AS doubts
            FROM ai_learning_events
            WHERE organization_id = ${orgId}::uuid AND created_at > now() - interval '8 weeks'
            GROUP BY 1 ORDER BY 1`)
        : await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.$queryRaw<Array<{ wk: Date; answered: bigint; doubts: bigint }>>`
            SELECT date_trunc('week', created_at) AS wk,
              count(*) FILTER (WHERE event_type = 'answered') AS answered,
              count(*) FILTER (WHERE event_type IN ('uncertain','fallback','handoff')) AS doubts
            FROM ai_learning_events
            WHERE created_at > now() - interval '8 weeks'
            GROUP BY 1 ORDER BY 1`);
      return rows.map((r) => {
        const a = Number(r.answered), d = Number(r.doubts), base = a + d;
        return { week: new Date(r.wk).toISOString().slice(0, 10), assertiveness: base > 0 ? Math.round((a / base) * 100) : null, total: a + d };
      });
    } catch (e: any) {
      this.logger.warn(`weeklyTrend indisponível: ${e?.message ?? e}`);
      return [];
    }
  }

  // ============================== MASTER ==============================
  /** Painel master: agregado + ranking por empresa + por módulo. */
  async statsAll(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
    const core = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const byType = await tx.aiLearningEvent.groupBy({ by: ["eventType"], _count: { _all: true } });
      const counts: Record<string, number> = {};
      for (const r of byType) counts[r.eventType] = r._count._all;
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      const answered = counts["answered"] ?? 0;
      const doubts = (counts["uncertain"] ?? 0) + (counts["fallback"] ?? 0) + (counts["handoff"] ?? 0);
      const base = answered + doubts;
      const assertiveness = base > 0 ? Math.round((answered / base) * 100) : null;
      const pendingDoubts = await tx.aiLearningEvent.count({ where: { eventType: { in: DOUBT_TYPES }, resolved: false } });

      // ranking por empresa
      const byOrg = await tx.aiLearningEvent.groupBy({ by: ["organizationId", "eventType"], _count: { _all: true } });
      const orgMap = new Map<string, { answered: number; doubts: number; total: number }>();
      for (const r of byOrg) {
        const e = orgMap.get(r.organizationId) ?? { answered: 0, doubts: 0, total: 0 };
        e.total += r._count._all;
        if (r.eventType === "answered") e.answered += r._count._all;
        if (DOUBT_TYPES.includes(r.eventType)) e.doubts += r._count._all;
        orgMap.set(r.organizationId, e);
      }
      const orgIds = [...orgMap.keys()];
      const orgs = orgIds.length ? await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, niche: true } }) : [];
      const nm = new Map(orgs.map((o) => [o.id, o.name]));
      const nicheOf = new Map(orgs.map((o) => [o.id, o.niche ?? "—"]));
      const perOrg = [...orgMap.entries()].map(([orgId, e]) => {
        const b = e.answered + e.doubts;
        return { organizationId: orgId, name: nm.get(orgId) ?? "—", niche: nicheOf.get(orgId) ?? "—", total: e.total, doubts: e.doubts, assertiveness: b > 0 ? Math.round((e.answered / b) * 100) : null };
      }).sort((a, b) => b.total - a.total);

      // agregado POR NICHO: soma as empresas do mesmo segmento
      const nicheMap = new Map<string, { answered: number; doubts: number; total: number; orgs: number }>();
      for (const [orgId, e] of orgMap.entries()) {
        const key = nicheOf.get(orgId) ?? "—";
        const acc = nicheMap.get(key) ?? { answered: 0, doubts: 0, total: 0, orgs: 0 };
        acc.answered += e.answered; acc.doubts += e.doubts; acc.total += e.total; acc.orgs += 1;
        nicheMap.set(key, acc);
      }
      const perNiche = [...nicheMap.entries()].map(([niche, e]) => {
        const b = e.answered + e.doubts;
        return { niche, orgs: e.orgs, total: e.total, doubts: e.doubts, assertiveness: b > 0 ? Math.round((e.answered / b) * 100) : null };
      }).sort((a, b) => b.total - a.total);

      return { total, assertiveness, counts, pendingDoubts, perOrg, perNiche };
    });
    const trend = await this.weeklyTrend(undefined);
    return { ...core, trend };
  }

  /**
   * USO DAS IAs GRÁTIS + APRENDIZADO (RAG). Org vê o seu; master (sem orgId) vê
   * o agregado de todas. Mostra: qual provedor respondeu quantas vezes, a saúde
   * dos provedores configurados (ativo/cooldown/erro) e o tamanho/crescimento da
   * base de conhecimento (KB) + quantos Q&As estão indexados (embeddings).
   */
  async usage(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const evWhere = ctx.orgId ? { organizationId: ctx.orgId } : {};
    const kbWhere: any = ctx.orgId ? { organizationId: ctx.orgId } : {};
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      // 1) uso por provedor (qual IA respondeu)
      const byProvRaw = await tx.aiLearningEvent.groupBy({ by: ["provider"], where: evWhere, _count: { _all: true } });
      const byProvider = byProvRaw
        .filter((r) => !!r.provider)
        .map((r) => ({ provider: r.provider as string, count: r._count._all }))
        .sort((a, b) => b.count - a.count);

      // 2) saúde dos provedores configurados (agregado por tipo de provedor)
      const provRows = await tx.orgAiProvider.findMany({ where: evWhere, select: { provider: true, isActive: true, cooldownUntil: true, lastUsedAt: true, lastError: true } });
      const now = Date.now();
      const agg = new Map<string, { provider: string; configured: number; active: number; inCooldown: number; lastUsedAt: Date | null; lastError: string | null }>();
      for (const p of provRows) {
        const a = agg.get(p.provider) ?? { provider: p.provider, configured: 0, active: 0, inCooldown: 0, lastUsedAt: null, lastError: null };
        a.configured++;
        if (p.isActive) a.active++;
        if (p.cooldownUntil && new Date(p.cooldownUntil).getTime() > now) a.inCooldown++;
        if (p.lastUsedAt && (!a.lastUsedAt || p.lastUsedAt > a.lastUsedAt)) a.lastUsedAt = p.lastUsedAt;
        if (p.lastError && !a.lastError) a.lastError = p.lastError;
        agg.set(p.provider, a);
      }
      const providers = [...agg.values()].sort((a, b) => b.active - a.active);

      // 3) RAG / base de conhecimento (o que "aprendeu")
      const kbPublished = await tx.kbEntry.count({ where: { ...kbWhere, status: "published" } });
      const kbHumanTaught = await tx.kbEntry.count({ where: { ...kbWhere, status: "published", aiGenerated: false } });
      const kbAiGenerated = await tx.kbEntry.count({ where: { ...kbWhere, status: "published", aiGenerated: true } });
      const humanTeachEvents = await tx.aiLearningEvent.count({ where: { ...evWhere, eventType: "human_teach" } });
      let indexed = 0;
      try {
        const rows = ctx.orgId
          ? await tx.$queryRaw<Array<{ c: number }>>`SELECT count(*)::int AS c FROM kb_embeddings WHERE organization_id = ${ctx.orgId}::uuid`
          : await tx.$queryRaw<Array<{ c: number }>>`SELECT count(*)::int AS c FROM kb_embeddings`;
        indexed = Number(rows?.[0]?.c ?? 0);
      } catch { indexed = 0; }
      let growth: Array<{ week: string; count: number }> = [];
      try {
        const rows = ctx.orgId
          ? await tx.$queryRaw<Array<{ wk: Date; c: bigint }>>`SELECT date_trunc('week', created_at) AS wk, count(*) AS c FROM kb_entries WHERE organization_id = ${ctx.orgId}::uuid AND created_at > now() - interval '8 weeks' GROUP BY 1 ORDER BY 1`
          : await tx.$queryRaw<Array<{ wk: Date; c: bigint }>>`SELECT date_trunc('week', created_at) AS wk, count(*) AS c FROM kb_entries WHERE created_at > now() - interval '8 weeks' GROUP BY 1 ORDER BY 1`;
        growth = rows.map((r) => ({ week: new Date(r.wk).toISOString().slice(0, 10), count: Number(r.c) }));
      } catch { growth = []; }

      return {
        byProvider,
        providers,
        embeddingsEnabled: this.embeddings.enabled(),
        rag: { kbPublished, kbHumanTaught, kbAiGenerated, indexed, humanTeachEvents, growth },
      };
    });
  }
}
