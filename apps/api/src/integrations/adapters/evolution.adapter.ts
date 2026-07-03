import type { AdapterCredentials, AdapterResponse } from "./types";

/**
 * EvolutionAdapter
 *
 * Evolution API (open source WhatsApp gateway). Sem conceito de usuario;
 * cada *instance* = 1 numero WhatsApp Business. Yugo cria 1 instance por Store.
 *
 * Docs: https://doc.evolution-api.com/
 *
 * Credenciais esperadas em platform_integrations:
 *  - baseUrl:  ex 'https://evolution.empresa.com'
 *  - apiKey:   AUTHENTICATION_API_KEY do .env do Evolution (header 'apikey')
 */
export class EvolutionAdapter {
  constructor(private readonly creds: AdapterCredentials) {}

  /** GET / -> sanity check, devolve versao/status */
  async ping(): Promise<AdapterResponse<unknown>> {
    return this.request("GET", "/");
  }

  /** Eventos que assinamos no webhook (basta esses pro inbox+status). */
  private static readonly WEBHOOK_EVENTS = [
    "QRCODE_UPDATED",
    "MESSAGES_UPSERT",
    "MESSAGES_UPDATE",
    "SEND_MESSAGE",
    "CONNECTION_UPDATE",
  ];

  /**
   * POST /instance/create — cria instancia nova.
   *
   * IMPORTANTE: a estrutura do `webhook` mudou entre v1.x e v2.x do Evolution.
   * v1.x usava snake_case (webhook_by_events / webhook_base64); v2.x exige
   * camelCase + `enabled` (byEvents / base64 / enabled). Mandar no formato
   * antigo no v2.x faz o webhook NÃO ser registrado — instância aparece
   * conectada mas nenhuma mensagem chega no nosso webhook, e nenhum
   * `send.message` confirma os envios. Mantemos só o formato novo, que é o
   * suportado em todas as 2.x atuais.
   */
  async createInstance(opts: {
    instanceName: string;
    integration?: "WHATSAPP-BAILEYS" | "WHATSAPP-BUSINESS";
    webhookUrl?: string;
    qrcode?: boolean;
  }): Promise<AdapterResponse<{ instance: { instanceName: string }; qrcode?: { base64?: string; code?: string } }>> {
    return this.request("POST", "/instance/create", {
      instanceName: opts.instanceName,
      integration: opts.integration ?? "WHATSAPP-BAILEYS",
      qrcode: opts.qrcode ?? true,
      webhook: opts.webhookUrl ? {
        enabled: true,
        url: opts.webhookUrl,
        byEvents: false,
        base64: false,
        events: EvolutionAdapter.WEBHOOK_EVENTS,
      } : undefined,
    });
  }

  /**
   * POST /webhook/set/{name} — (re)configura o webhook de uma instância que já
   * existe. Útil pra consertar instâncias antigas que foram criadas com o
   * payload v1.x e ficaram sem eventos registrados no Evolution v2.x.
   */
  async setWebhook(instanceName: string, webhookUrl: string): Promise<AdapterResponse<unknown>> {
    return this.request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: EvolutionAdapter.WEBHOOK_EVENTS,
      },
    });
  }

  /** GET /webhook/find/{name} — lê o webhook configurado (diagnóstico). */
  async findWebhook(instanceName: string): Promise<AdapterResponse<{ enabled?: boolean; url?: string; events?: string[] }>> {
    return this.request("GET", `/webhook/find/${encodeURIComponent(instanceName)}`);
  }

  /**
   * POST /chatwoot/set/{name} - liga a instância a uma conta Chatwoot.
   * Com `autoCreate: true`, o próprio Evolution cria a caixa de entrada (inbox)
   * tipo API dentro da conta informada. Como cada empresa tem a SUA conta
   * Chatwoot, o acesso à caixa já fica restrito aos usuários daquela empresa.
   *
   * `token` = User Access Token de um agente/admin da conta (Application API).
   * `url`   = base do Chatwoot acessível pelo Evolution (interna no docker serve).
   */
  async setChatwoot(instanceName: string, opts: {
    accountId: string;
    token: string;
    url: string;
    nameInbox: string;
    signMsg?: boolean;
    reopenConversation?: boolean;
    conversationPending?: boolean;
  }): Promise<AdapterResponse<unknown>> {
    return this.request("POST", `/chatwoot/set/${encodeURIComponent(instanceName)}`, {
      enabled: true,
      accountId: opts.accountId,
      token: opts.token,
      url: opts.url.replace(/\/+$/, ""),
      signMsg: opts.signMsg ?? true,
      reopenConversation: opts.reopenConversation ?? true,
      conversationPending: opts.conversationPending ?? false,
      nameInbox: opts.nameInbox,
      importContacts: true,
      importMessages: true,
      daysLimitImportMessages: 7,
      autoCreate: true,
      organization: opts.nameInbox,
    });
  }

  /** GET /chatwoot/find/{name} - lê a config Chatwoot atual da instância. */
  async findChatwoot(instanceName: string): Promise<AdapterResponse<{ enabled?: boolean; accountId?: string; nameInbox?: string }>> {
    return this.request("GET", `/chatwoot/find/${encodeURIComponent(instanceName)}`);
  }

  /** GET /instance/connect/{name} - pega QR code novo / status */
  async getConnect(instanceName: string): Promise<AdapterResponse<{ base64?: string; code?: string; pairingCode?: string }>> {
    return this.request("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
  }

  /** GET /instance/connectionState/{name} */
  async getConnectionState(instanceName: string) {
    return this.request("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  }

  /** DELETE /instance/delete/{name} */
  async deleteInstance(instanceName: string) {
    return this.request("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  /** POST /instance/logout/{name} - desconecta sem deletar */
  async logout(instanceName: string) {
    return this.request("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  /** PUT /instance/restart/{name} - reinicia a instancia (novo QR) */
  async restart(instanceName: string) {
    return this.request("PUT", `/instance/restart/${encodeURIComponent(instanceName)}`);
  }

  /** POST /message/sendText/{name} */
  async sendText(opts: {
    instanceName: string;
    number: string;          // E.164 sem + (5511999998888)
    text: string;
    linkPreview?: boolean;   // default false — links vão só clicáveis (sem card)
  }) {
    return this.request("POST", `/message/sendText/${encodeURIComponent(opts.instanceName)}`, {
      number: opts.number,
      text: opts.text,
      linkPreview: opts.linkPreview ?? false,
    });
  }

  /**
   * POST /message/sendMedia/{name} - envia imagem/video/documento (URL ou
   * base64) com legenda. Para documento, informe fileName + mimetype.
   * Formato compativel com Evolution v2.3.x.
   */
  async sendMedia(opts: {
    instanceName: string;
    number: string;
    mediaUrl: string;          // URL publica OU base64
    caption?: string;
    mediatype?: "image" | "video" | "document";
    fileName?: string;
    mimetype?: string;
  }) {
    const body: Record<string, unknown> = {
      number: opts.number,
      mediatype: opts.mediatype ?? "image",
      media: opts.mediaUrl,
      caption: opts.caption ?? "",
    };
    if (opts.fileName) body.fileName = opts.fileName;
    if (opts.mimetype) body.mimetype = opts.mimetype;
    return this.request("POST", `/message/sendMedia/${encodeURIComponent(opts.instanceName)}`, body);
  }

  /**
   * POST /message/sendWhatsAppAudio/{name} - nota de voz (ptt) no WhatsApp.
   * O endpoint de áudio é SEPARADO do sendMedia (que falha pra voz). audio = URL
   * pública OU base64 (Evolution converte pra ogg/opus automaticamente).
   */
  async sendWhatsAppAudio(opts: { instanceName: string; number: string; audioUrl: string }) {
    return this.request("POST", `/message/sendWhatsAppAudio/${encodeURIComponent(opts.instanceName)}`, {
      number: opts.number,
      audio: opts.audioUrl,
    });
  }

  /**
   * POST /chat/getBase64FromMediaMessage/{name} - baixa e descriptografa a mídia
   * de uma mensagem recebida (WhatsApp guarda criptografado). Retorna base64 +
   * mimetype. Aceita o objeto `message` cru do webhook (messages.upsert).
   */
  async getBase64FromMediaMessage(opts: {
    instanceName: string;
    message: unknown;
    convertToMp4?: boolean;
  }): Promise<AdapterResponse<{ base64?: string; mimetype?: string; fileName?: string }>> {
    return this.request("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(opts.instanceName)}`, {
      message: opts.message,
      convertToMp4: opts.convertToMp4 ?? false,
    });
  }

  // --------------------------------------------------------------------------
  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<AdapterResponse<T>> {
    const url = `${this.creds.baseUrl.replace(/\/+$/, "")}${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": this.creds.apiKey ?? "",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
      return {
        ok: res.ok,
        status: res.status,
        body: res.ok ? (json as T) : null,
        rawBody: json ?? text,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        ok: false,
        status: 0,
        body: null,
        error: e?.name === "AbortError" ? "timeout (Evolution nao respondeu em 12s)" : e?.message ?? "network error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
