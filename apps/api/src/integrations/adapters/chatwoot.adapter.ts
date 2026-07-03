import type { AdapterCredentials, AdapterResponse } from "./types";

/**
 * ChatwootAdapter
 *
 * Usa duas APIs do Chatwoot:
 *  - Platform API (auth: platform access token): admin global, gerencia Accounts e Users
 *  - Application API (auth: user_access_token por account): gerencia conversas dentro de uma account
 *
 * Docs: https://www.chatwoot.com/developers/api/
 *
 * Credenciais esperadas em platform_integrations:
 *  - baseUrl:  ex 'https://chatwoot.empresa.com'
 *  - apiToken: Platform Access Token (gerado em chatwoot UI > Profile > Access Token)
 */
export class ChatwootAdapter {
  constructor(private readonly creds: AdapterCredentials) {}

  /**
   * Sanity check do token Platform.
   * NAO existe GET /platform/api/v1/accounts; usamos agent_bots que tem
   * index. Token invalido = 401, valido = 200 (lista vazia ou nao).
   */
  async ping(): Promise<AdapterResponse<unknown>> {
    return this.request("GET", "/platform/api/v1/agent_bots");
  }

  /** POST /platform/api/v1/accounts - cria uma nova empresa */
  async createAccount(opts: {
    name: string;
    locale?: string;
  }): Promise<AdapterResponse<{ id: number; name: string }>> {
    return this.request("POST", "/platform/api/v1/accounts", {
      name: opts.name,
      locale: opts.locale ?? "pt_BR",
    });
  }

  /** GET /platform/api/v1/accounts/{id} */
  async getAccount(accountId: number | string) {
    return this.request("GET", `/platform/api/v1/accounts/${accountId}`);
  }

  /**
   * POST /platform/api/v1/users - cria user global (adiciona a account depois).
   * `confirmed: true` evita o fluxo de confirmacao por email, permitindo login
   * imediato / SSO. Retorna o user com `id`.
   */
  async createUser(opts: {
    name: string;
    email: string;
    password: string;
  }): Promise<AdapterResponse<{ id: number; email: string }>> {
    return this.request("POST", "/platform/api/v1/users", {
      name: opts.name,
      email: opts.email,
      password: opts.password,
      confirmed: true,
    });
  }

  /** POST /platform/api/v1/accounts/{id}/account_users - adiciona user a uma account */
  async addUserToAccount(opts: {
    accountId: number | string;
    userId: number | string;
    role?: "administrator" | "agent";
  }): Promise<AdapterResponse<unknown>> {
    return this.request(
      "POST",
      `/platform/api/v1/accounts/${opts.accountId}/account_users`,
      {
        user_id: opts.userId,
        role: opts.role ?? "agent",
      },
    );
  }

  /** GET /platform/api/v1/users/{id}/login - SSO URL temporaria (login transparente) */
  async ssoLoginUrl(userId: number | string): Promise<AdapterResponse<{ url: string }>> {
    return this.request<{ url: string }>(
      "GET",
      `/platform/api/v1/users/${userId}/login`,
    );
  }

  /** GET /platform/api/v1/users/{id} - busca user por ID */
  async getUser(userId: number | string) {
    return this.request<{ id: number; email: string; name: string }>(
      "GET",
      `/platform/api/v1/users/${userId}`,
    );
  }

  /** PATCH /platform/api/v1/users/{id} - atualiza nome, email, senha */
  async updateUser(opts: {
    id: number | string;
    name?: string;
    email?: string;
    password?: string;
  }): Promise<AdapterResponse<{ id: number; email: string }>> {
    const body: Record<string, string> = {};
    if (opts.name) body.name = opts.name;
    if (opts.email) body.email = opts.email;
    if (opts.password) body.password = opts.password;
    return this.request("PATCH", `/platform/api/v1/users/${opts.id}`, body);
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
          "api_access_token": this.creds.apiToken ?? "",
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
        error: e?.name === "AbortError" ? "timeout (servidor nao respondeu em 12s)" : e?.message ?? "network error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
