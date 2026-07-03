import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";

/**
 * Cliente do WhatsApp Cloud API (Meta Graph API).
 *
 * Faz o lado de SAÍDA do canal oficial:
 *  - enviar mensagem livre (sessão) dentro da janela de 24h — grátis;
 *  - enviar template aprovado (fora da janela) — cobrado;
 *  - puxar os modelos de mensagem (templates) da WABA.
 *
 * Credenciais via env (ver config.ts): META_ACCESS_TOKEN (token permanente de
 * System User), META_PHONE_NUMBER_ID, META_WABA_ID, META_GRAPH_VERSION.
 */
@Injectable()
export class MetaAdapter {
  private readonly logger = new Logger("MetaAdapter");

  private get version() {
    return process.env.META_GRAPH_VERSION || "v21.0";
  }
  private get base() {
    return `https://graph.facebook.com/${this.version}`;
  }
  private get token() {
    return process.env.META_ACCESS_TOKEN || "";
  }

  /** Valida a assinatura X-Hub-Signature-256 do webhook (HMAC-SHA256 do corpo cru
   *  com o App Secret). Fail-closed: sem secret ou sem header => inválido. */
  static verifySignature(raw: Buffer | string, header?: string | null): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !header) return false;
    const body = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
    const expected =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    try {
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    if (!this.token) throw new Error("META_ACCESS_TOKEN não configurado");
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText;
      throw new Error(`Meta ${method} ${path} falhou (${res.status}): ${msg}`);
    }
    return json;
  }

  /** Envia mensagem de texto livre (sessão). Só funciona dentro da janela de 24h. */
  async sendText(to: string, body: string, phoneNumberId?: string): Promise<{ id: string | null }> {
    const pnid = phoneNumberId || process.env.META_PHONE_NUMBER_ID;
    if (!pnid) throw new Error("META_PHONE_NUMBER_ID não configurado");
    const json = await this.call("POST", `${pnid}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    });
    return { id: json?.messages?.[0]?.id ?? null };
  }

  /** Envia um template aprovado (reengaja lead fora da janela de 24h). */
  async sendTemplate(
    to: string,
    name: string,
    languageCode = "pt_BR",
    components?: unknown[],
    phoneNumberId?: string,
  ): Promise<{ id: string | null }> {
    const pnid = phoneNumberId || process.env.META_PHONE_NUMBER_ID;
    if (!pnid) throw new Error("META_PHONE_NUMBER_ID não configurado");
    const json = await this.call("POST", `${pnid}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: languageCode },
        ...(components && components.length ? { components } : {}),
      },
    });
    return { id: json?.messages?.[0]?.id ?? null };
  }

  /**
   * Puxa os modelos de mensagem (templates) da WABA. Retorna nome, status,
   * categoria, idioma e componentes — pra IA/operador escolher o modelo certo.
   */
  async listTemplates(wabaId?: string): Promise<
    Array<{ name: string; status: string; category: string; language: string; components: any[] }>
  > {
    const waba = wabaId || process.env.META_WABA_ID;
    if (!waba) throw new Error("META_WABA_ID não configurado");
    const out: any[] = [];
    let path: string | null = `${waba}/message_templates?limit=100`;
    // pagina enquanto a Meta devolver "paging.next"
    while (path) {
      const json: any = await this.call("GET", path);
      for (const t of json?.data ?? []) {
        out.push({
          name: t.name,
          status: t.status,
          category: t.category,
          language: t.language,
          components: t.components ?? [],
        });
      }
      const next: string | undefined = json?.paging?.next;
      path = next ? next.replace(`${this.base}/`, "") : null;
    }
    return out;
  }
}
