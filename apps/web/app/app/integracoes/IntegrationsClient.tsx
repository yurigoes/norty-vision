"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

interface Status {
  chatwoot: { provisioned: boolean };
  glpi: { provisioned: boolean };
  evolution: { instanceName: string | null; status: string | null };
}

export function IntegrationsClient({ initial }: { initial: Status }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrationCard name="Chatwoot" desc="Atendimento / chat" ok={initial.chatwoot.provisioned} />
        <IntegrationCard name="GLPI" desc="Helpdesk / ativos" ok={initial.glpi.provisioned} />
      </div>
      <EvolutionCard instanceName={initial.evolution.instanceName} initialStatus={initial.evolution.status} />
      <ExtraInstancesCard />
      <AiProvidersCard />
    </div>
  );
}

type AiProv = { id: string; provider: string; label: string | null; model: string | null; baseUrl: string | null; accountId: string | null; priority: number; isActive: boolean; hasKey: boolean; cooldownUntil: string | null; lastError: string | null; lastUsedAt: string | null };

const AI_PROVIDERS: { id: string; name: string; free: string; steps: string[]; needs: ("model" | "baseUrl" | "accountId")[]; modelHint?: string; keyless?: boolean }[] = [
  { id: "groq", name: "Groq (grátis, rápido)", free: "Grátis, sem cartão", needs: ["model"], modelHint: "llama-3.3-70b-versatile",
    steps: ["Acesse console.groq.com e crie a conta (grátis).", "Vá em 'API Keys' → 'Create API Key' e copie a chave.", "Cole a chave aqui. Modelo sugerido: llama-3.3-70b-versatile."] },
  { id: "cloudflare", name: "Cloudflare Workers AI (grátis)", free: "~10 mil/dia grátis", needs: ["accountId", "model"], modelHint: "@cf/meta/llama-3.1-8b-instruct",
    steps: ["No painel da Cloudflare, copie o Account ID (em qualquer domínio, barra lateral).", "Vá em 'AI' → 'Workers AI' → crie um API Token com permissão Workers AI.", "Cole o Account ID e o Token aqui. Modelo: @cf/meta/llama-3.1-8b-instruct."] },
  { id: "gemini", name: "Google Gemini (grátis)", free: "~1.500 req/dia grátis", needs: ["model"], modelHint: "gemini-1.5-flash",
    steps: ["Acesse aistudio.google.com/app/apikey.", "Clique em 'Create API key' e copie.", "Cole aqui. Modelo: gemini-1.5-flash."] },
  { id: "openai", name: "OpenAI-compatível (OpenRouter…)", free: "Depende do provedor", needs: ["baseUrl", "model"],
    steps: ["Funciona com qualquer API no formato OpenAI (ex.: OpenRouter — openrouter.ai).", "Pegue a API key e a base URL (ex.: https://openrouter.ai/api/v1).", "Cole a chave, a base URL e o modelo."] },
  { id: "local", name: "Modelo local (Ollama/vLLM)", free: "Próprio servidor · dado não sai da infra", needs: ["baseUrl", "model"], keyless: true, modelHint: "llama3.1:8b",
    steps: ["Roda na sua infra (Ollama, vLLM ou LM Studio) — open-source, sem custo por uso e privado.", "Informe a URL OpenAI-compatible do servidor (ex.: http://ollama:11434/v1).", "Clique em 'Autenticar e listar modelos' e escolha o modelo baixado (ex.: llama3.1:8b, qwen2.5, deepseek-r1). API key é opcional."] },
  { id: "anthropic", name: "Anthropic (Claude, pago)", free: "Pago", needs: ["model"], modelHint: "claude-3-5-haiku-latest",
    steps: ["Em console.anthropic.com → API Keys, crie e copie a chave.", "Cole aqui. Modelo: claude-3-5-haiku-latest."] },
];

function AiProvidersCard() {
  const dialog = useDialog();
  const [items, setItems] = useState<AiProv[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AiProv | null>(null);

  const load = useCallback(() => {
    fetch("/api/ai/providers", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setItems(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(id: string) {
    const res = await fetch(`/api/ai/providers/${id}/test`, { method: "POST", credentials: "include" });
    const d = await res.json().catch(() => null);
    if (d?.ok) dialog.toast("Conexão OK ✅", "success"); else dialog.toast(d?.error ?? "Falhou", "error");
    load();
  }
  async function remove(p: AiProv) {
    if (!(await dialog.confirm({ title: "Remover conexão de IA", message: `Remover ${p.label || p.provider}?`, tone: "danger" }))) return;
    await fetch(`/api/ai/providers/${p.id}/delete`, { method: "POST", credentials: "include" });
    load();
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Assistente de IA (atendimento)</h3>
          <p className="text-xs text-muted">Cadastre 1 ou mais conexões. Quando uma estoura a cota do dia, o sistema pula pra próxima continuando o atendimento. Ordem = prioridade (menor primeiro).</p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-grad px-4 py-2">+ Conexão</button>
      </div>

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted">Nenhuma conexão de IA. Sem IA, o bot usa menu + palavras-chave.</p>
        ) : items.map((p) => {
          const meta = AI_PROVIDERS.find((x) => x.id === p.provider);
          const cooling = p.cooldownUntil && new Date(p.cooldownUntil).getTime() > Date.now();
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">#{p.priority} · {p.label || meta?.name || p.provider}</span>
                <span className="ml-2 text-xs text-muted">{p.model || meta?.modelHint || ""}</span>
                {cooling && <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">em descanso (cota)</span>}
                {p.lastError && !cooling && <span className="ml-2 text-[11px] text-red-300">erro: {p.lastError.slice(0, 40)}</span>}
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.isActive ? "bg-green-500/20 text-green-300" : "bg-line text-muted"}`}>{p.isActive ? "ativa" : "inativa"}</span>
                <button onClick={() => test(p.id)} className="rounded-md border border-line px-2 py-1 hover:border-brand">testar</button>
                <button onClick={() => setEditing(p)} className="rounded-md border border-line px-2 py-1 hover:border-brand">editar</button>
                <button onClick={() => remove(p)} className="rounded-md border border-line px-2 py-1 text-red-300 hover:border-red-400">excluir</button>
              </div>
            </div>
          );
        })}
      </div>

      {(adding || editing) && (
        <AiProviderForm
          editing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
          count={items.length}
        />
      )}
    </section>
  );
}

function AiProviderForm({ editing, onClose, onSaved, count }: { editing: AiProv | null; onClose: () => void; onSaved: () => void; count: number }) {
  const dialog = useDialog();
  const [provider, setProvider] = useState(editing?.provider ?? "groq");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(editing?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
  const [accountId, setAccountId] = useState(editing?.accountId ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manual, setManual] = useState(false);
  const meta = AI_PROVIDERS.find((x) => x.id === provider)!;

  const canFetch =
    (meta.keyless || apiKey.trim().length > 0 || !!editing) &&
    (provider !== "cloudflare" || accountId.trim().length > 0) &&
    ((provider !== "openai" && provider !== "local") || baseUrl.trim().length > 0);

  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/ai/providers/models", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ id: editing?.id, provider, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined, accountId: accountId.trim() || undefined }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setModels([]); setManual(true); dialog.toast(d?.error?.message ?? "Não foi possível listar (verifique a chave)", "error"); return; }
      const list: string[] = d?.models ?? [];
      setModels(list);
      if (list.length === 0) { setManual(true); dialog.toast("Nenhum modelo retornado — digite manualmente.", "info"); }
      else {
        setManual(false);
        if (!model || !list.includes(model)) setModel(list.find((m) => m === meta.modelHint) ?? list[0]);
      }
    } finally { setLoadingModels(false); }
  }, [editing?.id, provider, apiKey, baseUrl, accountId, model, meta.modelHint, dialog]);

  // ao editar, já temos chave salva → busca os modelos automaticamente ao abrir
  useEffect(() => { if (editing) void fetchModels(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save() {
    if (!editing && !meta.keyless && !apiKey.trim()) { dialog.toast("Cole a chave (API key)", "error"); return; }
    if (provider === "local" && !baseUrl.trim()) { dialog.toast("Informe a URL do servidor local (ex.: http://ollama:11434/v1)", "error"); return; }
    if (!model.trim()) { dialog.toast("Escolha (ou digite) o modelo", "error"); return; }
    setBusy(true);
    const res = await fetch("/api/ai/providers", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        id: editing?.id,
        provider,
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
        baseUrl: baseUrl.trim() || undefined,
        accountId: accountId.trim() || undefined,
        priority: editing?.priority ?? count,
        isActive,
        label: editing?.label ?? meta.name,
      }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Não foi possível salvar", "error"); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">{editing ? "Editar conexão de IA" : "Nova conexão de IA"}</h3>

        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setModel(""); setModels([]); setManual(false); }}
          className="input-base mt-3"
        >
          {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.free}</option>)}
        </select>

        <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3 text-xs text-muted">
          <p className="mb-1 font-semibold text-fg">Como obter a chave:</p>
          <ol className="list-decimal space-y-1 pl-4">
            {meta.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>

        {meta.needs.includes("accountId") && (
          <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Account ID (Cloudflare)" className="input-base mt-3" />
        )}
        {meta.needs.includes("baseUrl") && (
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === "local" ? "URL do servidor (ex.: http://ollama:11434/v1)" : "Base URL (ex.: https://openrouter.ai/api/v1)"} className="input-base mt-3" />
        )}
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={meta.keyless ? "API key (opcional — servidor local)" : editing ? "Nova API key (deixe em branco pra manter a atual)" : "API key"}
          className="input-base mt-2"
        />

        {/* Modelo: dropdown vindo do provedor, com fallback pra digitação manual */}
        {!manual && models.length > 0 ? (
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input-base mt-2">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`Modelo${meta.modelHint ? ` (ex.: ${meta.modelHint})` : ""}`} className="input-base mt-2" />
        )}
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <button type="button" onClick={() => { if (!canFetch) { dialog.toast("Cole a chave (e Account ID/Base URL, se houver) antes.", "error"); return; } void fetchModels(); }} disabled={loadingModels} className="text-brand hover:underline disabled:opacity-50">
            {loadingModels ? "buscando modelos…" : "🔄 Autenticar e listar modelos"}
          </button>
          {models.length > 0 && (
            <button type="button" onClick={() => setManual((v) => !v)} className="text-muted hover:text-fg">
              {manual ? "escolher da lista" : "digitar manualmente"}
            </button>
          )}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded border-line" />
          Conexão ativa (entra no failover)
        </label>

        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 py-2">{editing ? "Salvar alterações" : "Salvar conexão"}</button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

type Extra = { id: string; name: string; label: string | null; status: string | null; inboxId: string | null };
function ExtraInstancesCard() {
  const dialog = useDialog();
  const [extras, setExtras] = useState<Extra[]>([]);
  const [maxExtra, setMaxExtra] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState<string | null>(null);
  const timers = useRef<{ poll?: any; refresh?: any }>({});

  const load = useCallback(() => {
    fetch("/api/company-integrations/evolution/instances", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setExtras(d.extras ?? []); setMaxExtra(d.maxExtra ?? 0); setCanCreate(!!d.canCreate); } }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  function stopTimers() { clearInterval(timers.current.poll); clearInterval(timers.current.refresh); }
  useEffect(() => () => stopTimers(), []);

  async function createNew() {
    const label = await dialog.prompt({ title: "Novo número de WhatsApp", message: "Dê um nome pra identificar (ex.: Vendas, Loja Centro):", placeholder: "Vendas" });
    if (label === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/company-integrations/evolution/instances", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ label: label.trim() || undefined }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Não foi possível criar", "error"); return; }
      load();
      if (d?.id) openQr(d.id);
    } finally { setBusy(false); }
  }

  async function loadQr(id: string) {
    try {
      const res = await fetch(`/api/company-integrations/evolution/instances/${id}/qr`, { credentials: "include", cache: "no-store" });
      const d = await res.json().catch(() => null);
      const b = d?.base64 as string | null;
      setQr(b ? (b.startsWith("data:") ? b : `data:image/png;base64,${b}`) : null);
      setQrMsg(b ? "Escaneie no WhatsApp → Aparelhos conectados" : "Aguardando QR...");
    } catch { setQrMsg("Erro de conexão"); }
  }
  function openQr(id: string) {
    setQrFor(id); setQr(null); setQrMsg("gerando...");
    loadQr(id);
    timers.current.refresh = setInterval(() => loadQr(id), 5000);
    timers.current.poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/company-integrations/evolution/instances/${id}/state`, { credentials: "include", cache: "no-store" });
        const d = await res.json().catch(() => null);
        if (d?.connected) { stopTimers(); setQrFor(null); load(); }
      } catch {}
    }, 4000);
  }
  function closeQr() { stopTimers(); setQrFor(null); }

  async function removeExtra(e: Extra) {
    if (!(await dialog.confirm({ title: "Excluir número", message: `Remover "${e.label || e.name}"? O atendimento por esse número para.`, tone: "danger" }))) return;
    const res = await fetch(`/api/company-integrations/evolution/instances/${e.id}/delete`, { method: "POST", credentials: "include" });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Não foi possível excluir", "error"); return; }
    load();
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Números extras (call center)</h3>
          <p className="text-xs text-muted">Recebem e respondem só pelo atendimento. As notificações continuam saindo pelo número principal. Plano: {extras.length}/{maxExtra}.</p>
        </div>
        <button onClick={createNew} disabled={busy || !canCreate} className="btn-grad px-4 py-2" title={canCreate ? "" : "Limite do plano atingido"}>
          + Novo número
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {extras.length === 0 ? (
          <p className="text-xs text-muted">{maxExtra > 0 ? "Nenhum número extra ainda." : "Seu plano não inclui números extras. Fale com o suporte."}</p>
        ) : extras.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{e.label || e.name}</span>
              <span className="ml-2 font-mono text-[10px] text-muted">{e.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_BADGE[e.status ?? ""] ?? "bg-line text-muted"}`}>
                {e.status === "connected" ? "conectado" : e.status === "disconnected" ? "desconectado" : e.status === "qr_required" ? "aguardando QR" : e.status ?? "não conectado"}
              </span>
              {e.status !== "connected" && <button onClick={() => openQr(e.id)} className="rounded-md border border-line px-2 py-1 text-xs hover:border-brand">Conectar</button>}
              <button onClick={() => removeExtra(e)} className="rounded-md border border-line px-2 py-1 text-xs text-red-300 hover:border-red-400">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {qrFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeQr}>
          <div className="flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
            <h4 className="text-sm font-semibold">Conectar número</h4>
            {qr ? <img src={qr} alt="QR" className="h-56 w-56 rounded-lg bg-white p-2" /> : <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-line text-xs text-muted">{qrMsg ?? "gerando..."}</div>}
            <p className="text-center text-xs text-muted">{qrMsg}</p>
            <button onClick={closeQr} className="mt-1 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-fg">fechar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function IntegrationCard({ name, desc, ok }: { name: string; desc: string; ok: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ok ? "bg-green-500/20 text-green-300" : "bg-line text-muted"}`}>
          {ok ? "ativo" : "não provisionado"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{desc}</p>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  connected: "bg-green-500/20 text-green-300",
  disconnected: "bg-red-500/20 text-red-300",
  failed: "bg-red-500/20 text-red-300",
  qr_required: "bg-orange-500/20 text-orange-300",
};

function EvolutionCard({ instanceName, initialStatus }: { instanceName: string | null; initialStatus: string | null }) {
  const dialog = useDialog();
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<{ poll?: any; refresh?: any }>({});

  const loadQr = useCallback(async () => {
    try {
      const res = await fetch("/api/company-integrations/evolution/qr", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setMsg(data?.error?.message ?? "Falha ao obter QR"); return; }
      const b = data.base64 as string | null;
      setQr(b ? (b.startsWith("data:") ? b : `data:image/png;base64,${b}`) : null);
      setCode(data.code ?? null);
      setMsg(b ? "Escaneie no WhatsApp → Aparelhos conectados" : "Aguardando QR...");
    } catch { setMsg("Erro de conexão"); }
  }, []);

  function stopTimers() {
    clearInterval(timers.current.poll);
    clearInterval(timers.current.refresh);
  }

  function openQr() {
    setShowQr(true);
    loadQr();
    // puxa o QR a cada 5s (o QR pode chegar via webhook QRCODE_UPDATED)
    timers.current.refresh = setInterval(loadQr, 5_000);
    timers.current.poll = setInterval(async () => {
      try {
        const res = await fetch("/api/company-integrations/evolution/state", { credentials: "include", cache: "no-store" });
        const data = await res.json();
        setStatus(data.status ?? status);
        if (data.connected) { stopTimers(); setShowQr(false); setStatus("connected"); }
      } catch { /* ignora */ }
    }, 4_000);
  }

  useEffect(() => () => stopTimers(), []);

  async function action(path: string, confirmMsg?: string) {
    if (confirmMsg && !(await dialog.confirm({ message: confirmMsg, tone: "danger" }))) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/company-integrations/evolution/${path}`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setMsg(data?.error?.message ?? "Falha"); return; }
      if (path === "delete") { setStatus(null); setShowQr(false); stopTimers(); }
      if (path === "disconnect") { setStatus("disconnected"); setShowQr(false); stopTimers(); }
      if (path === "restart") { setStatus("qr_required"); }
    } catch { setMsg("Erro de conexão"); } finally { setBusy(false); }
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">WhatsApp (Evolution)</h3>
          <p className="text-xs text-muted">Instância da empresa: <span className="font-mono">{instanceName ?? "—"}</span></p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_BADGE[status ?? ""] ?? "bg-line text-muted"}`}>
          {status === "connected" ? "conectado" : status === "disconnected" ? "desconectado" : status === "qr_required" ? "aguardando QR" : status ?? "não conectado"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {status !== "connected" && (
          <button onClick={openQr} disabled={busy} className="btn-grad px-4 py-2">
            {showQr ? "Atualizar QR" : "Conectar"}
          </button>
        )}
        <button onClick={() => action("restart", "Reiniciar a instância? Vai gerar um novo QR.")} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand disabled:opacity-50">
          Reiniciar
        </button>
        {status === "connected" && (
          <button onClick={() => action("disconnect", "Desconectar o WhatsApp da empresa?")} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm text-orange-300 transition hover:border-orange-400 disabled:opacity-50">
            Desconectar
          </button>
        )}
        <button onClick={() => action("delete", "Excluir a instância? Será necessário reconectar do zero.")} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm text-red-300 transition hover:border-red-400 disabled:opacity-50">
          Excluir
        </button>
      </div>

      {showQr && (
        <div className="mt-4 flex flex-col items-center gap-2 border-t border-line/50 pt-4">
          {qr ? (
            <img src={qr} alt="QR WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-line text-xs text-muted">{msg ?? "gerando..."}</div>
          )}
          <p className="text-xs text-muted">{msg}</p>
          {code && <code className="break-all rounded bg-line px-2 py-1 text-[10px]">{code}</code>}
        </div>
      )}
      {!showQr && msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </section>
  );
}
