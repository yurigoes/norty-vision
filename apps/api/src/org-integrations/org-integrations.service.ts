import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

/** Tira a handle (InfiniteTag) do config, sem o `$` inicial. */
function ipHandle(config: unknown): string | null {
  const h = (config as any)?.handle;
  if (typeof h !== "string" || !h.trim()) return null;
  return h.trim().replace(/^\$/, "");
}

@Injectable()
export class OrgIntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async get(ctx: RequestContext, provider: string) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organizationIntegration.findFirst({
        where: { organizationId: ctx.orgId!, provider },
      }),
    );
  }

  /** Versao publica/segura (sem token) pra exibir status. */
  async getSafe(ctx: RequestContext, provider: string) {
    const i = await this.get(ctx, provider);
    if (!i) return null;
    return {
      id: i.id,
      provider: i.provider,
      label: i.label,
      status: i.status,
      hasToken: !!i.accessToken,
      hasWebhookSecret: !!i.webhookSecret,
      publicKey: i.publicKey,
      config: i.config ?? {},
      lastPingAt: i.lastPingAt,
      lastPingStatus: i.lastPingStatus,
    };
  }

  async upsert(
    ctx: RequestContext,
    provider: string,
    patch: {
      accessToken?: string | null;
      publicKey?: string | null;
      webhookSecret?: string | null;
      label?: string | null;
      status?: "active" | "disabled" | "error";
      config?: Record<string, unknown>;
    },
  ) {
    if (!ctxCan(ctx, "integrations.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar integrações", 403);
    }
    const data: Record<string, unknown> = { updatedByUserId: ctx.userId ?? null };
    for (const k of ["accessToken", "publicKey", "webhookSecret", "label", "status", "config"] as const) {
      if (patch[k] !== undefined) data[k] = patch[k] as any;
    }
    // se veio um access token e o status não foi informado, ativa
    // automaticamente (antes ficava "disabled" e o Pix nunca funcionava).
    if (data.status === undefined && patch.accessToken) data.status = "active";
    // InfinitePay: a credencial é a handle (no config); ativa ao receber a handle.
    if (data.status === undefined && ipHandle(patch.config)) data.status = "active";
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organizationIntegration.upsert({
        where: { organizationId_provider: { organizationId: ctx.orgId!, provider } },
        update: data,
        create: {
          organizationId: ctx.orgId!,
          provider,
          label: patch.label ?? (provider === "infinitepay" ? "InfinitePay" : "Mercado Pago"),
          accessToken: patch.accessToken ?? null,
          publicKey: patch.publicKey ?? null,
          webhookSecret: patch.webhookSecret ?? null,
          config: (patch.config ?? {}) as any,
          status: patch.status ?? (patch.accessToken || ipHandle(patch.config) ? "active" : "disabled"),
        },
      }),
    );
  }

  async test(ctx: RequestContext, provider: string) {
    const i = await this.get(ctx, provider);
    if (!i) throw new AppError(ErrorCode.ValidationFailed, "Integração não configurada", 400);

    // InfinitePay: a API não tem ping/me. Validamos chamando /links com um
    // payload mínimo (R$ 1) — se voltar "Merchant not found", a handle tá
    // errada. Se voltar OK, tem URL — handle válida. Antes só checava se a
    // string existia (deixava typo passar tipo "vrsportsepersonaliza" em vez
    // de "vrsportspersonalizados", causando 500 só na hora de gerar pagamento).
    if (provider === "infinitepay") {
      const handle = ipHandle(i.config);
      if (!handle) throw new AppError(ErrorCode.ValidationFailed, "Informe a sua handle (InfiniteTag)", 400);
      // Chama com order_nsu única (test_<timestamp>) pra não conflitar com
      // links reais. Description curto, R$1 mínimo.
      const adapter = new (await import("../payments/infinitepay.adapter")).InfinitePayAdapter(handle);
      const r = await adapter.createLink({
        items: [{ quantity: 1, price: 100, description: "Validação de handle" }],
        orderNsu: `test_${Date.now()}`,
      });
      const url = (await import("../payments/infinitepay.adapter")).InfinitePayAdapter.extractUrl(r.body);
      const valid = r.ok && !!url;
      const errMsg = !valid ? (
        // Pega a mensagem real da InfinitePay (ex.: "Merchant not found")
        typeof r.body === "object" && (r.body as any)?.message ? String((r.body as any).message)
        : r.error ?? (r.status ? `HTTP ${r.status}` : "Falha desconhecida")
      ) : null;
      await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.organizationIntegration.update({ where: { id: i.id }, data: {
          lastPingAt: new Date(),
          lastPingStatus: valid ? "ok" : `erro: ${errMsg ?? "?"}`.slice(0, 200),
          // Só ATIVA a integração se passou no teste — antes ativava qualquer handle
          status: valid ? "active" : "error",
        } }),
      );
      if (!valid) return { ok: false, status: r.status, error: errMsg, account: handle };
      return { ok: true, status: 200, account: handle };
    }

    if (!i.accessToken) {
      throw new AppError(ErrorCode.ValidationFailed, "Sem access token configurado", 400);
    }
    if (provider !== "mercadopago") {
      throw new AppError(ErrorCode.ValidationFailed, "Provider nao suportado", 400);
    }
    const adapter = new MercadoPagoOrgAdapter(i.accessToken);
    const r = await adapter.ping();
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organizationIntegration.update({
        where: { id: i.id },
        data: {
          lastPingAt: new Date(),
          lastPingStatus: r.ok ? "ok" : `erro ${r.status}`,
          // testar conexão com sucesso ativa a integração
          status: r.ok ? "active" : "error",
        },
      }),
    );
    return { ok: r.ok, status: r.status, account: r.ok ? r.body?.nickname ?? r.body?.email : undefined, error: r.error };
  }

  /** Resolve a handle InfinitePay de uma org ativa (usado pelo PaymentsService). */
  async resolveInfinitepay(organizationId: string): Promise<{ handle: string } | null> {
    const i = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organizationIntegration.findFirst({
        where: { organizationId, provider: "infinitepay", status: "active" },
      }),
    );
    const handle = ipHandle(i?.config);
    return handle ? { handle } : null;
  }

  /** Resolve credenciais MP de uma org (usado pelo PaymentsService). */
  async resolveMp(
    organizationId: string,
  ): Promise<{ accessToken: string; webhookSecret: string | null } | null> {
    const i = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organizationIntegration.findFirst({
        where: { organizationId, provider: "mercadopago", status: "active" },
      }),
    );
    if (!i?.accessToken) return null;
    return { accessToken: i.accessToken, webhookSecret: i.webhookSecret ?? null };
  }
}
