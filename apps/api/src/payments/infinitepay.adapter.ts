/**
 * InfinitePayAdapter — checkout por LINK da InfinitePay (CloudWalk).
 *
 * A API do "Checkout" é identificada apenas pela `handle` (InfiniteTag, sem o
 * `$`) no corpo — NÃO há token/secret. Por isso o webhook não tem assinatura:
 * a confirmação SEMPRE passa por `paymentCheck` antes de liquidar.
 *
 * Endpoints (base https://api.checkout.infinitepay.io):
 *   POST /links          → cria o link de pagamento (Pix / cartão até 12x)
 *   POST /payment_check  → consulta o status { paid, paid_amount, ... }
 *
 * Docs: https://www.infinitepay.io/checkout-documentacao
 */

interface IpResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
  error?: string;
}

export interface IpItem {
  quantity: number;
  /** preço unitário em CENTAVOS (R$ 10,00 = 1000). */
  price: number;
  description: string;
}

export class InfinitePayAdapter {
  private readonly base = "https://api.checkout.infinitepay.io";

  constructor(private readonly handle: string) {}

  private async req<T = any>(path: string, payload: unknown): Promise<IpResult<T>> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as T;
      return {
        ok: res.ok,
        status: res.status,
        body,
        error: res.ok ? undefined : (body as any)?.message ?? (body as any)?.error ?? `Falha InfinitePay (${res.status})`,
      };
    } catch (e: any) {
      return { ok: false, status: 0, body: null as any, error: e?.message };
    }
  }

  /** Cria o link de checkout. Retorna a URL do link e o slug da fatura.
   *
   *  Sanitiza tudo que a API do InfinitePay costuma rejeitar silenciosamente:
   *  - quantity/price como inteiros (não strings)
   *  - description trimada e com fallback (vazio é rejeitado)
   *  - order_nsu max 50 chars, ASCII-safe
   *  - customer.phone_number só dígitos
   */
  async createLink(opts: {
    items: IpItem[];
    orderNsu: string;
    redirectUrl?: string;
    webhookUrl?: string;
    customer?: { name?: string; email?: string; phone_number?: string };
  }): Promise<IpResult> {
    const items = (opts.items ?? []).map((it) => ({
      quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
      price: Math.max(1, Math.floor(Number(it.price) || 0)),
      description: (it.description || "Pagamento").toString().slice(0, 100).trim() || "Pagamento",
    }));
    const orderNsu = String(opts.orderNsu || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
    const payload: Record<string, unknown> = {
      handle: this.handle,
      items,
      order_nsu: orderNsu,
    };
    if (opts.redirectUrl) payload.redirect_url = opts.redirectUrl;
    if (opts.webhookUrl) payload.webhook_url = opts.webhookUrl;
    if (opts.customer && (opts.customer.name || opts.customer.email || opts.customer.phone_number)) {
      payload.customer = {
        ...(opts.customer.name ? { name: opts.customer.name.slice(0, 100) } : {}),
        ...(opts.customer.email ? { email: opts.customer.email.slice(0, 100) } : {}),
        ...(opts.customer.phone_number ? { phone_number: opts.customer.phone_number.replace(/\D/g, "").slice(0, 14) } : {}),
      };
    }
    return this.req("/links", payload);
  }

  /** Extrai a URL do link da resposta, tentando vários formatos.
   *  v2.x devolve `url`, v1.x já devolveu `link`, alguns endpoints aninham em
   *  `data` ou `result`. Faz busca recursiva por chave que pareça URL HTTP.
   *  Exportado pra que o caller use no lugar do `body?.url ?? body?.link ...`. */
  static extractUrl(body: any): string | null {
    if (!body || typeof body !== "object") return null;
    // tenta os caminhos óbvios primeiro
    const direct = body.url ?? body.link ?? body.payment_url ?? body.checkout_url
      ?? body.data?.url ?? body.data?.link ?? body.data?.checkout_url
      ?? body.result?.url ?? body.result?.link
      ?? null;
    if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;
    // busca recursiva (até 3 níveis) por qualquer valor que pareça URL HTTPS
    const seen = new WeakSet<object>();
    const walk = (o: any, depth: number): string | null => {
      if (depth > 3 || !o || typeof o !== "object" || seen.has(o)) return null;
      seen.add(o);
      for (const v of Object.values(o)) {
        if (typeof v === "string" && /^https?:\/\/(checkout\.infinitepay\.io|pag\.ae)\//.test(v)) return v;
        if (v && typeof v === "object") { const r = walk(v, depth + 1); if (r) return r; }
      }
      return null;
    };
    return walk(body, 0);
  }

  /**
   * Consulta o status do pagamento. Resposta:
   * { success, paid, amount, paid_amount, installments, capture_method }
   */
  async paymentCheck(opts: { orderNsu: string; transactionNsu?: string | null; slug?: string | null }): Promise<IpResult> {
    return this.req("/payment_check", {
      handle: this.handle,
      order_nsu: opts.orderNsu,
      transaction_nsu: opts.transactionNsu ?? undefined,
      slug: opts.slug ?? undefined,
    });
  }
}
