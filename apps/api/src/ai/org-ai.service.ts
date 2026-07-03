import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

type ProviderCfg = {
  id?: string;
  provider: "anthropic" | "groq" | "gemini" | "cloudflare" | "openai" | "local";
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  accountId?: string | null;
};

// provedores aceitos no cadastro/listagem
const PROVIDERS = ["anthropic", "groq", "gemini", "cloudflare", "openai", "local"];
// "local" = modelo open-source rodando na própria infra (Ollama/vLLM/LM Studio),
// exposto via endpoint OpenAI-compatible. NÃO exige API key (servidor interno).
const KEYLESS = ["local"];

/**
 * Assistente de IA por empresa, com failover.
 *
 * Cada empresa cadastra suas conexões (provedores) em ordem de prioridade. Ao
 * gerar uma resposta, tentamos a 1ª ativa; se ela estourar a cota (429/402) ou
 * falhar, marcamos um "descanso" (cooldown) e seguimos pra próxima — mantendo o
 * MESMO prompt/contexto, então nenhuma "alucina": todas recebem o mesmo estado.
 */
@Injectable()
export class OrgAiService {
  private readonly logger = new Logger("OrgAi");
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas administradores", 403);
  }

  // ----- CRUD (UI) -----
  async list(ctx: RequestContext) {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgAiProvider.findMany({ where: {}, orderBy: { priority: "asc" } }));
    return rows.map((r) => ({
      id: r.id, provider: r.provider, label: r.label, model: r.model, baseUrl: r.baseUrl, accountId: r.accountId,
      priority: r.priority, isActive: r.isActive, hasKey: !!r.apiKey,
      cooldownUntil: r.cooldownUntil, lastError: r.lastError, lastUsedAt: r.lastUsedAt,
    }));
  }

  async upsert(ctx: RequestContext, input: { id?: string; provider: string; label?: string; apiKey?: string; model?: string; baseUrl?: string; accountId?: string; priority?: number; isActive?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!PROVIDERS.includes(input.provider)) throw new AppError(ErrorCode.ValidationFailed, "Provedor inválido", 400);
    if (input.provider === "local" && !input.baseUrl?.trim() && !input.id) throw new AppError(ErrorCode.ValidationFailed, "Informe a URL do servidor local (ex.: http://ollama:11434/v1)", 400);
    const data: any = {
      provider: input.provider, label: input.label ?? null, model: input.model ?? null,
      baseUrl: input.baseUrl ?? null, accountId: input.accountId ?? null,
      priority: input.priority ?? 0, isActive: input.isActive ?? true,
    };
    // só sobrescreve a chave se vier preenchida (não apaga ao editar sem reenviar)
    if (input.apiKey && input.apiKey.trim()) { data.apiKey = input.apiKey.trim(); data.cooldownUntil = null; data.lastError = null; }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.orgAiProvider.update({ where: { id: input.id }, data }) : tx.orgAiProvider.create({ data: { ...data, organizationId: orgId, apiKey: input.apiKey?.trim() ?? null } }),
    ).then((r) => ({ id: r.id }));
  }

  async remove(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgAiProvider.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /**
   * Autentica com a chave informada e devolve a lista de modelos disponíveis do
   * provedor (pra UI montar um dropdown). Se `id` vier e a chave não for reenviada,
   * usa a chave já salva — assim dá pra trocar o modelo sem redigitar o token.
   */
  async listModels(ctx: RequestContext, input: { id?: string; provider: string; apiKey?: string; baseUrl?: string; accountId?: string }): Promise<{ models: string[] }> {
    this.requireAdmin(ctx);
    let { provider } = input;
    let apiKey = input.apiKey?.trim() ?? "";
    let baseUrl = input.baseUrl?.trim() ?? "";
    let accountId = input.accountId?.trim() ?? "";
    if (input.id) {
      const saved = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgAiProvider.findFirst({ where: { id: input.id } }));
      if (saved) {
        provider = provider || saved.provider;
        if (!apiKey) apiKey = saved.apiKey ?? "";
        if (!baseUrl) baseUrl = saved.baseUrl ?? "";
        if (!accountId) accountId = saved.accountId ?? "";
      }
    }
    if (!PROVIDERS.includes(provider)) throw new AppError(ErrorCode.ValidationFailed, "Provedor inválido", 400);
    if (provider === "local") {
      if (!baseUrl) throw new AppError(ErrorCode.ValidationFailed, "Informe a URL do servidor local para listar os modelos", 400);
    } else if (!apiKey) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe a chave (API key) para listar os modelos", 400);
    }
    return { models: await this.fetchModels(provider, apiKey, baseUrl, accountId) };
  }

  /** Consulta a API "list models" de cada provedor. Lança AppError 400 com a causa. */
  private async fetchModels(provider: string, apiKey: string, baseUrl: string, accountId: string): Promise<string[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const bad = (status: number) => new AppError(ErrorCode.ValidationFailed, status === 401 || status === 403 ? "Chave recusada pelo provedor (401/403)" : `Provedor respondeu HTTP ${status}`, 400);
    const isText = (id: string) => !!id && !/whisper|tts|embed|guard|moderation|distil|rerank|vision-only/i.test(id);
    try {
      if (provider === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { signal: ctrl.signal, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
        if (!r.ok) throw bad(r.status);
        const d: any = await r.json();
        return (d?.data ?? []).map((m: any) => m.id).filter(Boolean);
      }
      if (provider === "gemini") {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, { signal: ctrl.signal });
        if (!r.ok) throw bad(r.status);
        const d: any = await r.json();
        return (d?.models ?? [])
          .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((m: any) => String(m.name ?? "").replace(/^models\//, ""))
          .filter(Boolean);
      }
      if (provider === "cloudflare") {
        if (!accountId) throw new AppError(ErrorCode.ValidationFailed, "Informe o Account ID da Cloudflare", 400);
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=100&task=Text+Generation`, { signal: ctrl.signal, headers: { authorization: `Bearer ${apiKey}` } });
        if (!r.ok) throw bad(r.status);
        const d: any = await r.json();
        return (d?.result ?? []).map((m: any) => m.name).filter(Boolean).sort();
      }
      // groq + openai-compatível + local (Ollama/vLLM): todos expõem GET /models
      const base = provider === "groq" ? "https://api.groq.com/openai/v1" : (baseUrl || "https://api.openai.com/v1");
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const r = await fetch(`${base.replace(/\/+$/, "")}/models`, { signal: ctrl.signal, headers });
      if (!r.ok) throw bad(r.status);
      const d: any = await r.json();
      // Ollama devolve {models:[{name}]} no /api/tags, mas no /v1/models segue o
      // formato OpenAI ({data:[{id}]}). Cobrimos os dois por segurança.
      const ids = (d?.data ?? d?.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean);
      return ids.filter(isText).sort();
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      throw new AppError(ErrorCode.ValidationFailed, e?.name === "AbortError" ? "Tempo esgotado ao consultar o provedor" : (e?.message ?? "Falha ao listar modelos"), 400);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Testa a conexão com um "ping" curto. */
  async test(ctx: RequestContext, id: string) {
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgAiProvider.findFirst({ where: { id } }));
    if (!p) throw new AppError(ErrorCode.NotFound, "Conexão não encontrada", 404);
    const out = await this.callProvider(p as any, "Você é um teste. Responda apenas: ok", "ping", 16).catch((e) => ({ error: e?.message } as any));
    const ok = typeof out === "string" && out.length > 0;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgAiProvider.update({ where: { id }, data: { lastError: ok ? null : String((out as any)?.error ?? "falhou"), cooldownUntil: ok ? null : p.cooldownUntil } })).catch(() => undefined);
    return { ok, reply: ok ? out : null, error: ok ? null : String((out as any)?.error ?? "falhou") };
  }

  /** A empresa tem IA configurada (própria ou via .env)? */
  async hasProvider(orgId: string): Promise<boolean> {
    const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.orgAiProvider.count({ where: { organizationId: orgId, isActive: true } })).catch(() => 0);
    if (c > 0) return true;
    const e = process.env;
    return !!(e.GROQ_API_KEY || e.GEMINI_API_KEY || (e.CLOUDFLARE_AI_TOKEN && e.CLOUDFLARE_ACCOUNT_ID) || e.OPENAI_API_KEY || e.ANTHROPIC_API_KEY || e.LOCAL_AI_URL);
  }

  // ----- núcleo: geração com failover (chamado pelo bot/atendimento) -----
  /** Gera texto usando as conexões da empresa em ordem de prioridade, pulando as
   *  em cooldown. Se a empresa não tiver nenhuma, cai no provedor do .env (se houver). */
  async complete(orgId: string, system: string, user: string, maxTokens = 350): Promise<string | null> {
    // 1) provedores da própria empresa
    let out = await this.runOrgProviders(orgId, system, user, maxTokens);
    if (out != null) return out;
    // 2) fallback: provedores configurados no YUGO (plataforma). Assim o master e
    //    qualquer empresa sem IA própria usam a IA central do yugo (slug).
    const pid = await this.platformOrgId();
    if (pid && pid !== orgId) {
      out = await this.runOrgProviders(pid, system, user, maxTokens);
      if (out != null) return out;
    }
    // 3) fallback final: provedor do ambiente (.env), se configurado
    return this.callEnvProvider(system, user, maxTokens).catch(() => null);
  }

  /** Roda os provedores ATIVOS de uma org em ordem de prioridade. null se nenhum respondeu. */
  private async runOrgProviders(orgId: string, system: string, user: string, maxTokens: number): Promise<string | null> {
    const providers = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgAiProvider.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { priority: "asc" } }),
    ).catch(() => [] as any[]);
    const now = Date.now();
    const usable = providers.filter((p) => (p.apiKey || (p.provider === "local" && p.baseUrl)) && (!p.cooldownUntil || new Date(p.cooldownUntil).getTime() < now));
    for (const p of usable) {
      try {
        const text = await this.callProvider(p as any, system, user, maxTokens);
        if (text != null && (typeof text !== "string" || text.trim())) {
          const o = typeof text === "string" ? text : JSON.stringify(text);
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.orgAiProvider.update({ where: { id: p.id }, data: { lastUsedAt: new Date(), lastError: null } })).catch(() => undefined);
          return o;
        }
      } catch (e: any) {
        const cooldown = e?.quota ? this.endOfDay() : e?.rateLimited ? new Date(now + 60_000) : new Date(now + 2 * 60_000);
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.orgAiProvider.update({ where: { id: p.id }, data: { cooldownUntil: cooldown, lastError: String(e?.message ?? "erro").slice(0, 300) } })).catch(() => undefined);
        this.logger.warn(`provider ${p.provider} falhou (${e?.quota ? "cota do dia" : e?.rateLimited ? "limite/min" : "erro"}): ${e?.message} — tentando próximo`);
      }
    }
    return null;
  }

  /** id da empresa da plataforma (slug PLATFORM_ORG_SLUG, default "yugo"). Cacheado. */
  private platformOrgIdCache: string | null = null;
  private async platformOrgId(): Promise<string | null> {
    if (this.platformOrgIdCache) return this.platformOrgIdCache;
    const slug = (process.env.PLATFORM_ORG_SLUG ?? "yugo").toLowerCase();
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { slug }, select: { id: true } })).catch(() => null);
    this.platformOrgIdCache = org?.id ?? null;
    return this.platformOrgIdCache;
  }

  /** Gera texto usando a IA central do yugo (contexto master/sem empresa específica). */
  async completePlatform(system: string, user: string, maxTokens = 350): Promise<string | null> {
    const pid = await this.platformOrgId();
    if (pid) { const out = await this.runOrgProviders(pid, system, user, maxTokens); if (out != null) return out; }
    return this.callEnvProvider(system, user, maxTokens).catch(() => null);
  }

  private endOfDay(): Date {
    const d = new Date(); d.setHours(23, 59, 59, 0); return d;
  }

  /**
   * Geração multimodal (texto + 1 imagem) com failover. Usado pela leitura de
   * comprovante/boleto (OCR/IA). Só provedores com visão (anthropic, gemini,
   * openai-compatível) são tentados; os demais são pulados. Best-effort: devolve
   * null se nenhum provedor com visão estiver disponível ou todos falharem.
   */
  async completeVision(orgId: string, system: string, user: string, imageDataUrl: string, maxTokens = 500): Promise<string | null> {
    const m = (imageDataUrl || "").match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1]!, b64 = m[2]!;
    const providers = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgAiProvider.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { priority: "asc" } }),
    ).catch(() => [] as any[]);
    const now = Date.now();
    const usable = (providers as any[]).filter((p) =>
      ["anthropic", "gemini", "openai"].includes(p.provider) && p.apiKey && (!p.cooldownUntil || new Date(p.cooldownUntil).getTime() < now),
    );
    for (const p of usable) {
      try {
        const text = await this.callVision(p as any, system, user, mime, b64, maxTokens);
        if (text && text.trim()) {
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.orgAiProvider.update({ where: { id: p.id }, data: { lastUsedAt: new Date(), lastError: null } })).catch(() => undefined);
          return text;
        }
      } catch (e: any) {
        const cooldown = e?.quota ? this.endOfDay() : e?.rateLimited ? new Date(now + 60_000) : new Date(now + 2 * 60_000);
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.orgAiProvider.update({ where: { id: p.id }, data: { cooldownUntil: cooldown, lastError: String(e?.message ?? "erro").slice(0, 300) } })).catch(() => undefined);
        this.logger.warn(`vision ${p.provider} falhou: ${e?.message} — tentando próximo`);
      }
    }
    // fallback ambiente (.env): tenta anthropic/openai/gemini se houver chave
    const env = process.env;
    let cfg: ProviderCfg | null = null;
    if (env.OPENAI_API_KEY) cfg = { provider: "openai", apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL };
    else if (env.ANTHROPIC_API_KEY) cfg = { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL };
    else if (env.GEMINI_API_KEY) cfg = { provider: "gemini", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL };
    if (!cfg) return null;
    return this.callVision(cfg, system, user, mime, b64, maxTokens).catch(() => null);
  }

  /** Chamada multimodal a um provedor específico. */
  private async callVision(cfg: ProviderCfg, system: string, user: string, mime: string, b64: string, maxTokens: number): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const fail = (status: number, body: string) => {
      const err: any = new Error(`HTTP ${status} ${body.slice(0, 120)}`);
      const daily = /per day|tokens per day|requests per day|daily|quota|insufficient|exceeded/i.test(body);
      err.quota = status === 402 || daily; err.rateLimited = status === 429 && !daily;
      return err;
    };
    try {
      if (cfg.provider === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey ?? "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: cfg.model || "claude-3-5-sonnet-latest", max_tokens: maxTokens, system,
            messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text: user }] }],
          }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.content?.[0]?.text ?? null;
      }
      if (cfg.provider === "gemini") {
        const model = cfg.model || "gemini-1.5-flash";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`, {
          method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      }
      // openai-compatível (gpt-4o / gpt-4o-mini têm visão)
      const base = cfg.baseUrl || "https://api.openai.com/v1";
      const model = cfg.model || "gpt-4o-mini";
      const r = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model, max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: [{ type: "text", text: user }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] },
          ],
        }),
      });
      if (!r.ok) throw fail(r.status, await r.text());
      const d: any = await r.json();
      return d?.choices?.[0]?.message?.content ?? null;
    } finally { clearTimeout(timer); }
  }

  /** Chama um provedor específico. Lança {quota:true} em 429/402 pra acionar failover. */
  private async callProvider(cfg: ProviderCfg, system: string, user: string, maxTokens: number): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const fail = (status: number, body: string) => {
      const err: any = new Error(`HTTP ${status} ${body.slice(0, 120)}`);
      const daily = /per day|tokens per day|requests per day|daily|quota|insufficient|exceeded/i.test(body);
      err.quota = status === 402 || daily;            // cota do dia → descansa até a virada
      err.rateLimited = status === 429 && !daily;     // limite por minuto → descanso curto
      return err;
    };
    try {
      if (cfg.provider === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey ?? "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: cfg.model || "claude-3-5-haiku-latest", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.content?.[0]?.text ?? null;
      }
      if (cfg.provider === "gemini") {
        const model = cfg.model || "gemini-1.5-flash";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`, {
          method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      }
      if (cfg.provider === "cloudflare") {
        const model = cfg.model || "@cf/meta/llama-3.1-8b-instruct";
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/run/${model}`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.result?.response ?? null;
      }
      // groq + openai-compatível + local (Ollama/vLLM/LM Studio): API OpenAI chat.
      // local roda na própria infra → sem API key e timeout maior (CPU é lento).
      const isLocal = cfg.provider === "local";
      if (isLocal) clearTimeout(timer);
      const localCtrl = isLocal ? new AbortController() : ctrl;
      const localTimer = isLocal ? setTimeout(() => localCtrl.abort(), 60_000) : timer;
      const base = cfg.provider === "groq" ? "https://api.groq.com/openai/v1" : (cfg.baseUrl || "https://api.openai.com/v1");
      const model = cfg.model || (cfg.provider === "groq" ? "llama-3.3-70b-versatile" : isLocal ? (process.env.LOCAL_AI_MODEL || "llama3.1:8b") : "gpt-4o-mini");
      const headers: Record<string, string> = { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) };
      try {
        const r = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST", signal: localCtrl.signal, headers,
          body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (!r.ok) throw fail(r.status, await r.text());
        const d: any = await r.json();
        return d?.choices?.[0]?.message?.content ?? null;
      } finally {
        if (isLocal) clearTimeout(localTimer);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Provedor do ambiente (.env) — fallback de plataforma quando a empresa não cadastrou nenhum. */
  private async callEnvProvider(system: string, user: string, maxTokens: number): Promise<string | null> {
    const env = process.env;
    let cfg: ProviderCfg | null = null;
    // prioridade: provedor local (open-source, dado não sai da infra) primeiro.
    if (env.LOCAL_AI_URL) cfg = { provider: "local", baseUrl: env.LOCAL_AI_URL, apiKey: env.LOCAL_AI_KEY, model: env.LOCAL_AI_MODEL };
    else if (env.GROQ_API_KEY) cfg = { provider: "groq", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL };
    else if (env.GEMINI_API_KEY) cfg = { provider: "gemini", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL };
    else if (env.CLOUDFLARE_AI_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) cfg = { provider: "cloudflare", apiKey: env.CLOUDFLARE_AI_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, model: env.CLOUDFLARE_AI_MODEL };
    else if (env.OPENAI_API_KEY) cfg = { provider: "openai", apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL };
    else if (env.ANTHROPIC_API_KEY) cfg = { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL };
    if (!cfg) return null;
    return this.callProvider(cfg, system, user, maxTokens).catch(() => null);
  }
}
