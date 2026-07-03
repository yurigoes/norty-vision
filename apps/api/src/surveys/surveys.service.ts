import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";

interface CreateSurveyInput {
  organizationId: string;
  storeId?: string | null;
  customerId?: string | null;
  kind: "lens_order" | "sale" | "appointment" | "production" | "manual";
  refId?: string | null;
  stage?: string | null;
  sellerUserId?: string | null;
}

@Injectable()
export class SurveysService {
  private readonly logger = new Logger("Surveys");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /**
   * Cria a pesquisa e dispara o link público pro cliente (WhatsApp/email).
   * Best-effort: não lança se o envio falhar. Evita duplicar pesquisa pendente
   * pro mesmo ref/etapa.
   */
  async createAndSend(input: CreateSurveyInput) {
    if (!input.customerId) return null; // sem cliente não há pra quem enviar

    // dedup: já existe pesquisa pra esse ref+etapa?
    if (input.refId) {
      const dup = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.satisfactionSurvey.findFirst({
          where: { refId: input.refId, kind: input.kind, stage: input.stage ?? null },
          select: { id: true },
        }),
      );
      if (dup) return dup;
    }

    const token = randomBytes(18).toString("base64url");
    const survey = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId ?? null,
          customerId: input.customerId ?? null,
          kind: input.kind,
          refId: input.refId ?? null,
          stage: input.stage ?? null,
          sellerUserId: input.sellerUserId ?? null,
          token,
        },
      }),
    );

    // contato do cliente
    const customer = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.findFirst({
        where: { id: input.customerId! },
        select: { name: true, phone: true, whatsappPhone: true, email: true },
      }),
    );
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: input.organizationId }, select: { slug: true } })).catch(() => null);
    const link = `${orgBaseUrl(org?.slug)}/p/${token}`;
    const firstName = (customer?.name ?? "Cliente").split(" ")[0];
    const text = input.kind === "appointment"
      ? `Olá ${firstName}! Como foi seu atendimento hoje? Dê uma nota de 1 a 5 ⭐ (1 ruim, 5 ótimo) aqui: ${link}\n\n> Sistema de Avaliação YUGO+`
      : `Olá ${firstName}! Conta pra gente como foi sua experiência? Leva 30 segundos: ${link}`;

    try {
      if (input.storeId) {
        const r = await this.notifications.notify({
          organizationId: input.organizationId,
          storeId: input.storeId,
          customerId: input.customerId,
          whatsappPhone: customer?.whatsappPhone ?? customer?.phone ?? null,
          email: customer?.email ?? null,
          subject: "Como foi sua experiência?",
          text,
          templateCode: "pesquisa_satisfacao",
        });
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.satisfactionSurvey.update({
            where: { id: survey.id },
            data: { sentAt: new Date(), channel: r.whatsapp ? "whatsapp" : r.email ? "email" : null },
          }),
        );
      }
    } catch (e: any) {
      this.logger.warn(`falha ao enviar pesquisa: ${e?.message}`);
    }
    return survey;
  }

  /**
   * NPS espontâneo enviado pelo próprio cliente no portal (sempre disponível).
   * Cria já respondido. Evita duplicar mais de uma avaliação por dia/cliente.
   */
  async submitPortalNps(input: {
    organizationId: string; customerId: string; storeId?: string | null;
    npsScore: number; comment?: string | null;
  }) {
    if (input.npsScore < 0 || input.npsScore > 10) {
      throw new AppError(ErrorCode.ValidationFailed, "Nota NPS inválida (0 a 10)", 400);
    }
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.findFirst({
        where: { customerId: input.customerId, kind: "manual", stage: "portal", respondedAt: { gte: since } },
        select: { id: true },
      }),
    );
    if (recent) throw new AppError(ErrorCode.Conflict, "Você já avaliou recentemente. Obrigado!", 409);

    const token = randomBytes(18).toString("base64url");
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId ?? null,
          customerId: input.customerId,
          kind: "manual",
          stage: "portal",
          token,
          npsScore: input.npsScore,
          comment: input.comment?.slice(0, 1000) ?? null,
          respondedAt: new Date(),
          sentAt: new Date(),
          channel: "portal",
        },
      }),
    );
  }

  /** Dados públicos pra montar a página de resposta (sem auth). */
  async getPublic(token: string) {
    const s = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.findUnique({ where: { token } }),
    );
    if (!s) throw new AppError(ErrorCode.NotFound, "Pesquisa não encontrada", 404);

    let storeBrand: { primaryColor: string | null; logoUrl: string | null; name: string } | null = null;
    if (s.storeId) {
      const store = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.store.findFirst({ where: { id: s.storeId! }, select: { name: true, themePrimaryColor: true, logoUrl: true } }),
      );
      if (store) storeBrand = { name: store.name, primaryColor: store.themePrimaryColor, logoUrl: store.logoUrl };
    }
    let sellerName: string | null = null;
    if (s.sellerUserId) {
      const u = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.user.findFirst({ where: { id: s.sellerUserId! }, select: { name: true } }),
      );
      sellerName = u?.name ?? null;
    }
    return {
      token: s.token,
      kind: s.kind,
      answered: !!s.respondedAt,
      sellerName,
      storeBrand,
    };
  }

  /** Resposta pública (sem auth). NPS (0-10) e/ou nota 1-5 estrelas. */
  async respond(token: string, input: { npsScore?: number | null; sellerRating?: number | null; comment?: string | null }) {
    const s = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.findUnique({ where: { token } }),
    );
    if (!s) throw new AppError(ErrorCode.NotFound, "Pesquisa não encontrada", 404);
    if (s.respondedAt) throw new AppError(ErrorCode.Conflict, "Pesquisa já respondida", 409);
    const hasNps = input.npsScore != null;
    const hasStars = input.sellerRating != null;
    if (!hasNps && !hasStars) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe uma nota", 400);
    }
    if (hasNps && (input.npsScore! < 0 || input.npsScore! > 10)) {
      throw new AppError(ErrorCode.ValidationFailed, "Nota NPS inválida (0 a 10)", 400);
    }
    if (hasStars && (input.sellerRating! < 1 || input.sellerRating! > 5)) {
      throw new AppError(ErrorCode.ValidationFailed, "Nota inválida (1 a 5)", 400);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.update({
        where: { id: s.id },
        data: {
          npsScore: input.npsScore ?? null,
          sellerRating: input.sellerRating ?? null,
          comment: input.comment?.slice(0, 1000) ?? null,
          respondedAt: new Date(),
        },
      }),
    );
    return { ok: true };
  }

  /** Lista + métricas (NPS + média de nota do vendedor) pro admin. */
  async list(ctx: RequestContext, opts?: { start?: string; end?: string }) {
    this.requireAdmin(ctx);
    const from = opts?.start ? new Date(opts.start + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts?.end ? new Date(opts.end + "T23:59:59Z") : new Date();

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const surveys = await tx.satisfactionSurvey.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      const answered = surveys.filter((s) => s.respondedAt && s.npsScore != null);
      const promoters = answered.filter((s) => (s.npsScore ?? 0) >= 9).length;
      const detractors = answered.filter((s) => (s.npsScore ?? 0) <= 6).length;
      const nps = answered.length > 0 ? Math.round(((promoters - detractors) / answered.length) * 100) : null;

      const ratings = answered.filter((s) => s.sellerRating != null).map((s) => s.sellerRating!);
      const avgSeller = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

      // nomes dos vendedores
      const sellerIds = [...new Set(surveys.map((s) => s.sellerUserId).filter(Boolean) as string[])];
      const users = sellerIds.length
        ? await tx.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })
        : [];
      const um = new Map(users.map((u) => [u.id, u.name]));

      return {
        from,
        to,
        metrics: {
          sent: surveys.length,
          answered: answered.length,
          nps,
          promoters,
          detractors,
          neutrals: answered.length - promoters - detractors,
          avgSellerRating: avgSeller,
        },
        items: surveys.map((s) => ({
          id: s.id,
          kind: s.kind,
          stage: s.stage,
          npsScore: s.npsScore,
          sellerRating: s.sellerRating,
          sellerName: s.sellerUserId ? um.get(s.sellerUserId) ?? null : null,
          comment: s.comment,
          respondedAt: s.respondedAt,
          createdAt: s.createdAt,
        })),
      };
    });
  }
}
