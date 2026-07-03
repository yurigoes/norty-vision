import type { AdapterCredentials, AdapterResponse } from "./types";

/**
 * GlpiAdapter
 *
 * GLPI REST API (apirest.php). Auth em 2 passos:
 *  1) initSession() -> recebe session_token
 *  2) demais requests usam session_token + app_token (api_key)
 *
 * Docs: https://github.com/glpi-project/glpi/blob/main/apirest.md
 *
 * Credenciais esperadas em platform_integrations:
 *  - baseUrl:  ex 'https://glpi.empresa.com'
 *  - apiKey:   App-Token (gerado em GLPI Setup > General > API)
 *  - apiToken: user_token de um usuario admin (alternativa: username/password)
 *  - username/password: fallback se apiToken nao for fornecido
 *
 * Entities representam empresas; Groups representam lojas/divisoes.
 */
export class GlpiAdapter {
  private sessionToken: string | null = null;
  constructor(private readonly creds: AdapterCredentials) {}

  /** GET /initSession -> session_token; chamado automaticamente */
  async initSession(): Promise<AdapterResponse<{ session_token: string }>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "App-Token": this.creds.apiKey ?? "",
    };
    if (this.creds.apiToken) {
      headers["Authorization"] = `user_token ${this.creds.apiToken}`;
    } else if (this.creds.username && this.creds.password) {
      const basic = Buffer.from(
        `${this.creds.username}:${this.creds.password}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${basic}`;
    }

    try {
      const res = await fetchWithTimeout(this.url("/apirest.php/initSession"), {
        method: "GET",
        headers,
      });
      const json = await safeJson(res);
      if (res.ok && json && typeof json === "object" && "session_token" in json) {
        this.sessionToken = (json as any).session_token;
      }
      return {
        ok: res.ok,
        status: res.status,
        body: json as { session_token: string },
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        ok: false,
        status: 0,
        body: null as any,
        error: e?.name === "AbortError" ? "timeout (GLPI nao respondeu em 12s)" : e?.message ?? "network error",
      };
    }
  }

  async ping(): Promise<AdapterResponse<unknown>> {
    return this.initSession();
  }

  /** POST /Entity - cria empresa/divisao raiz */
  async createEntity(opts: {
    name: string;
    completename?: string;
    parentEntityId?: number;
  }): Promise<AdapterResponse<{ id: number }>> {
    // NAO enviar 'completename': no GLPI é campo calculado (read-only) e
    // mandá-lo causa HTTP 400. Só name + entities_id (parent, default 0=raiz).
    return this.request("POST", "/apirest.php/Entity", {
      input: {
        name: opts.name,
        entities_id: opts.parentEntityId ?? 0,
      },
    });
  }

  /**
   * Busca uma entidade existente pelo nome (entities_id=0 = filha da raiz).
   * Usado como fallback quando createEntity falha por duplicidade.
   */
  async findEntityByName(name: string): Promise<number | null> {
    const r = await this.request<any>("GET", "/apirest.php/Entity?range=0-999");
    const list: any[] = Array.isArray(r.body) ? r.body : Array.isArray(r.rawBody) ? (r.rawBody as any) : [];
    const match = list.find((e) => e && e.name === name);
    return match?.id ? Number(match.id) : null;
  }

  /** POST /Group - cria grupo (representa store dentro da entity) */
  async createGroup(opts: {
    name: string;
    entityId: number;
    comment?: string;
  }): Promise<AdapterResponse<{ id: number }>> {
    return this.request("POST", "/apirest.php/Group", {
      input: {
        name: opts.name,
        entities_id: opts.entityId,
        is_recursive: 1,
        comment: opts.comment ?? "",
      },
    });
  }

  /**
   * Cria usuario no GLPI. O itemtype User NAO aceita entities_id/_useremails/
   * _profiles_id direto no add (causa "Bad Request"/ERROR_GLPI_ADD). O jeito
   * correto e em etapas:
   *   1) POST /User com campos validos (name, realname, firstname, password)
   *   2) POST /UserEmail vinculando o email
   *   3) POST /Profile_User vinculando profile + entity
   * Retorna o id do usuario criado (etapas 2/3 sao best-effort).
   */
  async createUser(opts: {
    name: string;
    realname?: string;
    firstname?: string;
    email: string;
    password: string;
    entityId: number;
    groupId?: number;
    profileId?: number;  // profile padrao "Self-Service" = 1
  }): Promise<AdapterResponse<{ id: number }>> {
    const created = await this.request<{ id: number }>("POST", "/apirest.php/User", {
      input: {
        name: opts.name,               // login
        realname: opts.realname ?? "",
        firstname: opts.firstname ?? opts.name,
        password: opts.password,
        password2: opts.password,
        is_active: 1,
        comment: "Provisionado via yugo-platform",
      },
    });
    const userId = extractId(created);
    if (!created.ok || !userId) return created;

    // 2) email (best-effort)
    await this.request("POST", "/apirest.php/UserEmail", {
      input: { users_id: userId, email: opts.email, is_default: 1 },
    }).catch(() => undefined);

    // 3) profile + entity (best-effort)
    await this.request("POST", "/apirest.php/Profile_User", {
      input: {
        users_id: userId,
        profiles_id: opts.profileId ?? 1,
        entities_id: opts.entityId,
        is_recursive: 1,
      },
    }).catch(() => undefined);

    // 4) grupo (opcional)
    if (opts.groupId) {
      await this.request("POST", "/apirest.php/Group_User", {
        input: { users_id: userId, groups_id: opts.groupId },
      }).catch(() => undefined);
    }

    return { ok: true, status: created.status, body: { id: userId }, rawBody: created.rawBody };
  }

  /** PUT /User/{id} - atualiza a senha do usuário (sync com o painel). */
  async updateUserPassword(userId: number | string, password: string): Promise<AdapterResponse<unknown>> {
    return this.request("PUT", `/apirest.php/User/${userId}`, {
      input: { id: Number(userId), password, password2: password },
    });
  }

  /** PUT /User/{id} - atualiza nome, senha, email */
  async updateUser(opts: {
    id: number | string;
    name?: string;
    firstname?: string;
    realname?: string;
    password?: string;
    email?: string;
  }): Promise<AdapterResponse<unknown>> {
    const input: Record<string, unknown> = { id: opts.id };
    if (opts.name) input.name = opts.name;
    if (opts.firstname) input.firstname = opts.firstname;
    if (opts.realname) input.realname = opts.realname;
    if (opts.password) {
      input.password = opts.password;
      input.password2 = opts.password;
    }
    if (opts.email) input._useremails = [opts.email];
    return this.request("PUT", `/apirest.php/User/${opts.id}`, { input });
  }

  /**
   * Busca user por email via Search API.
   * Field 115 = User.email (em algumas versoes).
   * Retorna a primeira correspondencia.
   */
  async findUserByEmail(email: string): Promise<AdapterResponse<{ data?: Array<Record<string, unknown>> }>> {
    const q = new URLSearchParams({
      "criteria[0][field]": "115",
      "criteria[0][searchtype]": "contains",
      "criteria[0][value]": email,
      "forcedisplay[0]": "2",
      "forcedisplay[1]": "1",
      "forcedisplay[2]": "115",
    });
    return this.request("GET", `/apirest.php/search/User?${q.toString()}`);
  }

  /** GET /killSession - encerra (boa pratica em scripts curtos) */
  async killSession(): Promise<void> {
    if (!this.sessionToken) return;
    try {
      await fetch(this.url("/apirest.php/killSession"), {
        method: "GET",
        headers: this.authHeaders(),
      });
    } catch { /* ignore */ }
    this.sessionToken = null;
  }

  // --------------------------------------------------------------------------
  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<AdapterResponse<T>> {
    if (!this.sessionToken) {
      const init = await this.initSession();
      if (!init.ok) return init as AdapterResponse<T>;
    }
    try {
      const res = await fetchWithTimeout(this.url(path), {
        method,
        headers: this.authHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await safeJson(res);
      return {
        ok: res.ok,
        status: res.status,
        body: res.ok ? (json as T) : null,
        rawBody: json,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        ok: false,
        status: 0,
        body: null,
        error: e?.message ?? "network error",
      };
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "App-Token": this.creds.apiKey ?? "",
      "Session-Token": this.sessionToken ?? "",
    };
  }

  private url(path: string): string {
    return `${this.creds.baseUrl.replace(/\/+$/, "")}${path}`;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 12_000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** GLPI add retorna {id} ou [{id}] dependendo do itemtype/versao. */
function extractId(res: { body: unknown; rawBody?: unknown }): number | null {
  const src: any = res.body ?? res.rawBody;
  if (!src) return null;
  if (Array.isArray(src)) {
    const first = src[0];
    return first && typeof first.id === "number" ? first.id : null;
  }
  return typeof src.id === "number" ? src.id : src.id ? Number(src.id) : null;
}
