/**
 * MercadoPagoOrgAdapter — gateway de pagamento da PROPRIA empresa (org),
 * separado do MP do master (assinaturas da plataforma).
 *
 * Usa o access_token configurado em organization_integrations.
 * Suporta: Pix (QR na hora), cartao avulso (checkout pref), cartao
 * recorrente (preapproval), consulta de pagamento.
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/reference
 */

interface MpResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
  error?: string;
}

export class MercadoPagoOrgAdapter {
  private readonly base = "https://api.mercadopago.com";

  constructor(private readonly accessToken: string) {}

  private async req<T = any>(
    path: string,
    init?: RequestInit & { idempotencyKey?: string },
  ): Promise<MpResult<T>> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      };
      if (init?.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;
      const res = await fetch(`${this.base}${path}`, { ...init, headers });
      const body = (await res.json().catch(() => null)) as T;
      return {
        ok: res.ok,
        status: res.status,
        body,
        error: res.ok ? undefined : (body as any)?.message ?? "Falha MP",
      };
    } catch (e: any) {
      return { ok: false, status: 0, body: null as any, error: e?.message };
    }
  }

  async ping(): Promise<MpResult> {
    return this.req("/users/me");
  }

  /**
   * Cria pagamento Pix imediato. Retorna QR code (copia-e-cola + base64).
   */
  async createPixPayment(opts: {
    amountCents: number;
    description: string;
    externalReference: string;
    payerEmail: string;
    payerName?: string;
    payerDocument?: string;
    expiresMinutes?: number;
    notificationUrl?: string;
  }): Promise<MpResult> {
    const expiration = new Date(
      Date.now() + (opts.expiresMinutes ?? 60) * 60_000,
    ).toISOString();
    const payload: any = {
      transaction_amount: opts.amountCents / 100,
      description: opts.description,
      payment_method_id: "pix",
      external_reference: opts.externalReference,
      date_of_expiration: expiration,
      // sem isto o MP nao notifica o pagamento Pix neste fluxo
      notification_url: opts.notificationUrl,
      payer: {
        email: opts.payerEmail,
        first_name: opts.payerName,
        identification: opts.payerDocument
          ? {
              type: opts.payerDocument.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF",
              number: opts.payerDocument.replace(/\D/g, ""),
            }
          : undefined,
      },
    };
    return this.req("/v1/payments", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: `pix-${opts.externalReference}-${Date.now()}`,
    });
  }

  /**
   * Cria preference de checkout (cartao avulso). Retorna init_point.
   */
  async createCheckoutPreference(opts: {
    amountCents: number;
    title: string;
    externalReference: string;
    payerEmail: string;
    backUrl: string;
    notificationUrl?: string;
  }): Promise<MpResult> {
    const payload: any = {
      items: [
        {
          title: opts.title,
          quantity: 1,
          unit_price: opts.amountCents / 100,
          currency_id: "BRL",
        },
      ],
      external_reference: opts.externalReference,
      payer: { email: opts.payerEmail },
      back_urls: {
        success: opts.backUrl,
        pending: opts.backUrl,
        failure: opts.backUrl,
      },
      auto_return: "approved",
      notification_url: opts.notificationUrl,
    };
    return this.req("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /**
   * Cria assinatura recorrente (preapproval) — cobranca automatica mensal
   * do cartao do cliente final.
   */
  async createPreapproval(opts: {
    amountCents: number;
    reason: string;
    externalReference: string;
    payerEmail: string;
    backUrl: string;
    frequencyMonths?: number;
  }): Promise<MpResult> {
    const payload: any = {
      reason: opts.reason,
      external_reference: opts.externalReference,
      payer_email: opts.payerEmail,
      back_url: opts.backUrl,
      auto_recurring: {
        frequency: opts.frequencyMonths ?? 1,
        frequency_type: "months",
        transaction_amount: opts.amountCents / 100,
        currency_id: "BRL",
      },
      status: "pending",
    };
    return this.req("/preapproval", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // ===== Cartão salvo (Customers + Cards) p/ cobrança automática do crediário =====

  /** Acha um customer MP pelo e-mail (evita duplicar). */
  async findCustomerByEmail(email: string): Promise<MpResult> {
    return this.req(`/v1/customers/search?email=${encodeURIComponent(email)}`);
  }

  /** Cria um customer MP. */
  async createCustomer(opts: { email: string; firstName?: string; document?: string }): Promise<MpResult> {
    const payload: any = { email: opts.email, first_name: opts.firstName };
    if (opts.document) {
      const d = opts.document.replace(/\D/g, "");
      payload.identification = { type: d.length > 11 ? "CNPJ" : "CPF", number: d };
    }
    return this.req("/v1/customers", { method: "POST", body: JSON.stringify(payload) });
  }

  /** Salva o cartão no customer (recebe o token gerado pelo MP.js no front). */
  async saveCard(customerId: string, cardToken: string): Promise<MpResult> {
    return this.req(`/v1/customers/${customerId}/cards`, {
      method: "POST",
      body: JSON.stringify({ token: cardToken }),
    });
  }

  /** Gera um token a partir de um cartão JÁ salvo (cobrança recorrente sem CVV). */
  async cardTokenFromSaved(cardId: string): Promise<MpResult> {
    return this.req("/v1/card_tokens", { method: "POST", body: JSON.stringify({ card_id: cardId }) });
  }

  /** Cobra um valor no cartão salvo (token gerado de cardTokenFromSaved). */
  async chargeWithCard(opts: {
    token: string;
    amountCents: number;
    description: string;
    externalReference: string;
    payerEmail: string;
    customerId?: string;
    paymentMethodId?: string;
    notificationUrl?: string;
  }): Promise<MpResult> {
    const payload: any = {
      transaction_amount: opts.amountCents / 100,
      token: opts.token,
      description: opts.description,
      installments: 1,
      external_reference: opts.externalReference,
      notification_url: opts.notificationUrl,
      payer: opts.customerId
        ? { type: "customer", id: opts.customerId, email: opts.payerEmail }
        : { email: opts.payerEmail },
    };
    if (opts.paymentMethodId) payload.payment_method_id = opts.paymentMethodId;
    return this.req("/v1/payments", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: `card-${opts.externalReference}-${Date.now()}`,
    });
  }

  async getPayment(id: string): Promise<MpResult> {
    return this.req(`/v1/payments/${id}`);
  }

  /** Busca um pagamento APROVADO por external_reference (confirma cartão/checkout). */
  async searchApprovedByRef(externalReference: string): Promise<{ id: string } | null> {
    const r = await this.req(`/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`);
    const results: any[] = (r.body as any)?.results ?? [];
    const approved = results.find((p) => p?.status === "approved");
    return approved?.id ? { id: String(approved.id) } : null;
  }

  async getPreapproval(id: string): Promise<MpResult> {
    return this.req(`/preapproval/${id}`);
  }
}
