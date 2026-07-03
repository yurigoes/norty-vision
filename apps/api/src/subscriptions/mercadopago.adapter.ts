/**
 * Mercado Pago — Preapproval (assinaturas recorrentes) adapter.
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/subscriptions
 *
 * O MP separa em dois conceitos:
 *  - preapproval_plan: catalogo do plano (valor + frequencia)
 *  - preapproval:      assinatura individual ligada a um payer
 *
 * Estrategia MVP:
 *  - Quando o usuario assina, criamos um preapproval direto (sem plan_id),
 *    com `auto_recurring` definindo valor + frequencia.
 *  - MP retorna `init_point` que abrimos pro user pagar.
 *  - Webhook /api/webhooks/mercadopago notifica status.
 */

interface MpCredentials {
  accessToken: string;  // platform_integrations.apiToken
  webhookSecret?: string;
}

interface CreatePreapprovalInput {
  reason: string;          // descricao da assinatura
  payerEmail: string;
  externalReference: string; // nosso subscription.id pra correlacionar
  backUrl: string;         // pra onde redirecionar apos pagamento
  amountCents: number;
  frequencyDays: 30 | 365; // mensal/anual aproximado (MP exige em dias)
  trialDays?: number;
}

interface CreatePreapprovalResponse {
  ok: boolean;
  status: number;
  preapprovalId?: string;
  initPoint?: string;
  error?: string;
}

export class MercadoPagoAdapter {
  private readonly base = "https://api.mercadopago.com";

  constructor(private readonly creds: MpCredentials) {}

  private async req(path: string, init?: RequestInit) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.creds.accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return res;
  }

  async ping(): Promise<{ ok: boolean; status: number; message?: string }> {
    try {
      const res = await this.req("/users/me");
      return { ok: res.ok, status: res.status };
    } catch (e: any) {
      return { ok: false, status: 0, message: e?.message };
    }
  }

  async createPreapproval(
    input: CreatePreapprovalInput,
  ): Promise<CreatePreapprovalResponse> {
    const today = new Date();
    const startDate = input.trialDays
      ? new Date(today.getTime() + input.trialDays * 86400_000)
      : today;
    const endDate = new Date(startDate.getTime() + 365 * 86400_000 * 10); // 10 anos

    const payload = {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      auto_recurring: {
        frequency: input.frequencyDays === 365 ? 1 : 1,
        frequency_type: input.frequencyDays === 365 ? "years" : "months",
        transaction_amount: input.amountCents / 100,
        currency_id: "BRL",
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
      status: "pending",
    };

    try {
      const res = await this.req("/preapproval", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body: any = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: body?.message ?? body?.error ?? "Falha no MP",
        };
      }
      return {
        ok: true,
        status: res.status,
        preapprovalId: body?.id,
        initPoint: body?.init_point,
      };
    } catch (e: any) {
      return { ok: false, status: 0, error: e?.message };
    }
  }

  async getPreapproval(id: string): Promise<{ ok: boolean; status: number; body: any }> {
    const res = await this.req(`/preapproval/${id}`);
    return {
      ok: res.ok,
      status: res.status,
      body: await res.json().catch(() => null),
    };
  }

  async cancelPreapproval(id: string) {
    const res = await this.req(`/preapproval/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    return { ok: res.ok, status: res.status };
  }

  async getPayment(id: string): Promise<{ ok: boolean; status: number; body: any }> {
    const res = await this.req(`/v1/payments/${id}`);
    return {
      ok: res.ok,
      status: res.status,
      body: await res.json().catch(() => null),
    };
  }
}
