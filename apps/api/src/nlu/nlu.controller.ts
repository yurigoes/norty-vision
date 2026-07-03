import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PrismaService } from "../prisma/prisma.service";
import { NluService } from "./nlu.service";

const ClassifyTestSchema = z.object({
  text: z.string().min(1).max(2000),
});

const UpsertKeywordSchema = z.object({
  intent: z.enum(["confirm", "reschedule", "cancel", "question", "opt_out", "unknown"]),
  keyword: z.string().min(1).max(120),
  matchType: z.enum(["exact", "contains", "regex", "starts_with"]).optional(),
  weight: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
  storeId: z.string().uuid().nullable().optional(),
});

const ResolveSchema = z.object({
  resolvedIntent: z.enum([
    "confirm",
    "reschedule",
    "cancel",
    "question",
    "opt_out",
    "unknown",
  ]),
  resolutionNote: z.string().max(500).optional(),
  promoteAsKeyword: z.boolean().optional(),
});

@Controller("nlu")
export class NluController {
  constructor(
    private readonly nlu: NluService,
    private readonly prisma: PrismaService,
  ) {}

  /** Testa um texto sem persistir nada — debug. */
  @Post("classify")
  @HttpCode(200)
  async classify(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = ClassifyTestSchema.parse(body);
    return this.nlu.classify({
      organizationId: ctx.orgId ?? null,
      storeId: ctx.storeId ?? null,
      text: input.text,
    });
  }

  // ====== KEYWORDS (escopo: org/store/global) ======
  @Get("keywords")
  async listKeywords(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
    @Query("intent") intent?: string,
  ) {
    const items = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.intentKeyword.findMany({
          where: {
            isActive: true,
            ...(intent ? { intent } : {}),
            OR: [
              { organizationId: null, storeId: null },
              ...(ctx.orgId ? [{ organizationId: ctx.orgId, storeId: null }] : []),
              ...(ctx.orgId && storeId
                ? [{ organizationId: ctx.orgId, storeId }]
                : []),
            ],
          },
          orderBy: [{ intent: "asc" }, { weight: "desc" }],
        }),
    );
    return { items };
  }

  @Post("keywords")
  @HttpCode(201)
  async createKeyword(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = UpsertKeywordSchema.parse(body);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new Error("Apenas admin");
    }
    const kw = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.intentKeyword.create({
        data: {
          organizationId: ctx.isPlatformAdmin ? null : ctx.orgId!,
          storeId: input.storeId ?? null,
          intent: input.intent,
          keyword: input.keyword,
          matchType: input.matchType ?? "contains",
          weight: input.weight ?? 1,
          isActive: input.isActive ?? true,
          source: "manual",
          createdBy: ctx.userId ?? null,
        },
      }),
    );
    return { keyword: kw };
  }

  // ====== UNRESOLVED REPLIES (fila) ======
  @Get("unresolved")
  async listUnresolved(
    @CurrentContext() ctx: RequestContext,
    @Query("limit") limit?: string,
  ) {
    const items = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.unresolvedReply.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "asc" },
          take: Math.min(parseInt(limit ?? "50"), 200),
        }),
    );
    return { items };
  }

  @Patch("unresolved/:id/resolve")
  async resolve(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = ResolveSchema.parse(body);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const u = await tx.unresolvedReply.findUnique({ where: { id } });
      if (!u) throw new Error("Nao encontrado");

      let promotedId: string | null = null;
      if (input.promoteAsKeyword && input.resolvedIntent !== "unknown") {
        const kw = await tx.intentKeyword.create({
          data: {
            organizationId: u.organizationId,
            storeId: u.storeId,
            intent: input.resolvedIntent,
            keyword: u.rawText.toLowerCase().slice(0, 120),
            matchType: "contains",
            weight: 0.8,
            source: "admin_promoted",
            createdBy: ctx.userId ?? null,
          },
        });
        promotedId = kw.id;
      }

      const resolved = await tx.unresolvedReply.update({
        where: { id },
        data: {
          status: "resolved",
          resolvedIntent: input.resolvedIntent,
          resolvedAt: new Date(),
          resolvedBy: ctx.userId ?? null,
          resolutionNote: input.resolutionNote ?? null,
          promotedToKeywordId: promotedId,
        },
      });

      return { unresolved: resolved };
    });
  }
}
