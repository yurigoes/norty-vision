"use client";

import { useEffect, useState, type FormEvent } from "react";

type VaultStatus = {
  configured: boolean;
  hint: string | null;
  unlocked: boolean;
};

type CredItem = {
  id: string;
  provider: string;
  label: string;
  consoleUrl: string | null;
  username: string | null;
  password: string | null;
  notes: string | null;
  externalAdminUserId: string | null;
  isSystem: boolean;
  updatedAt: string;
};

export function CredentialsVault() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<CredItem[]>([]);
  const [revealedItems, setRevealedItems] = useState<CredItem[]>([]);

  async function reloadStatus() {
    const res = await fetch("/api/platform/vault/status", {
      credentials: "include",
    });
    if (res.ok) setStatus((await res.json()) as VaultStatus);
  }

  async function reloadItems(reveal: boolean) {
    const url = reveal ? "/api/platform/vault?reveal=1" : "/api/platform/vault";
    const res = await fetch(url, { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { items: CredItem[] };
      if (reveal) setRevealedItems(data.items);
      else setItems(data.items);
    }
  }

  useEffect(() => {
    reloadStatus();
    reloadItems(false);
  }, []);

  useEffect(() => {
    if (status?.unlocked) {
      reloadItems(true);
    } else {
      setRevealedItems([]);
    }
  }, [status?.unlocked]);

  if (!status) return <p className="text-muted">Carregando...</p>;

  if (!status.configured) {
    return <SetSecretCard onDone={() => reloadStatus()} firstTime />;
  }

  if (!status.unlocked) {
    return (
      <UnlockCard hint={status.hint} onUnlocked={() => reloadStatus()} />
    );
  }

  const list = revealedItems.length ? revealedItems : items;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
        <span className="text-green-100">
          🔓 Cofre desbloqueado · sessão de 30 minutos
        </span>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/platform/vault/lock", {
              method: "POST",
              credentials: "include",
            });
            reloadStatus();
          }}
          className="text-xs text-green-200 underline hover:text-green-100"
        >
          Travar agora
        </button>
      </div>

      <DiscoverIdsCard onDone={() => reloadItems(true)} />

      <MasterSyncCard onSynced={() => reloadItems(true)} />

      {list.map((it) => (
        <CredCard key={it.id} item={it} onRefresh={() => reloadItems(true)} />
      ))}

      <AddCustomEntry onAdded={() => reloadItems(true)} />
    </div>
  );
}

// ============================================================================
// Cards
// ============================================================================
function SetSecretCard({
  onDone,
  firstTime,
  currentRequired,
}: {
  onDone: () => void;
  firstTime?: boolean;
  currentRequired?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      newSecret: String(fd.get("newSecret") ?? ""),
      hint: String(fd.get("hint") ?? "") || undefined,
    };
    if (currentRequired) {
      payload.currentSecret = String(fd.get("currentSecret") ?? "");
    }
    try {
      const res = await fetch("/api/platform/vault/set-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Falha");
        return;
      }
      setSuccess(true);
      setTimeout(onDone, 800);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-line bg-bg/60 p-6 backdrop-blur-sm"
    >
      <div>
        <h2 className="text-lg font-semibold">
          {firstTime ? "Configure a senha mestra do cofre" : "Trocar senha mestra"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Esta senha é diferente do login. É usada apenas para desbloquear o
          cofre de credenciais. Só você deve saber.
        </p>
      </div>

      {currentRequired && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Senha atual
          </span>
          <input
            type="password"
            name="currentSecret"
            required
            className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          {firstTime ? "Nova senha mestra" : "Nova senha"}
        </span>
        <input
          type="password"
          name="newSecret"
          required
          minLength={8}
          autoFocus
          className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
        <p className="mt-1 text-[11px] text-muted">
          Mínimo 8 caracteres. Use algo memorável — não é recuperável sem reset
          completo.
        </p>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Dica (opcional)
        </span>
        <input
          type="text"
          name="hint"
          maxLength={200}
          placeholder="Lembrete público — não escreva a senha aqui!"
          className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
          Senha mestra configurada.
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Salvando..." : firstTime ? "Configurar senha mestra" : "Trocar senha"}
      </button>
    </form>
  );
}

function UnlockCard({
  hint,
  onUnlocked,
}: {
  hint: string | null;
  onUnlocked: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/platform/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: String(fd.get("secret") ?? "") }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Senha incorreta");
        return;
      }
      onUnlocked();
    } finally {
      setLoading(false);
    }
  }

  if (showChange) {
    return <SetSecretCard onDone={() => setShowChange(false)} currentRequired />;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-line bg-bg/60 p-6 backdrop-blur-sm"
    >
      <div>
        <h2 className="text-lg font-semibold">🔒 Cofre bloqueado</h2>
        <p className="mt-1 text-sm text-muted">
          Informe a senha mestra. A sessão fica desbloqueada por 30 minutos.
        </p>
        {hint && (
          <p className="mt-2 rounded-md border border-line bg-bg/40 p-2 text-xs text-muted">
            💡 dica: {hint}
          </p>
        )}
      </div>

      <input
        type="password"
        name="secret"
        required
        autoFocus
        placeholder="Senha mestra"
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-3 text-sm text-fg outline-none focus:border-brand"
      />

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Validando..." : "Desbloquear"}
      </button>

      <button
        type="button"
        onClick={() => setShowChange(true)}
        className="block w-full text-center text-xs text-muted hover:text-brand"
      >
        Trocar senha mestra
      </button>
    </form>
  );
}

function CredCard({
  item,
  onRefresh,
}: {
  item: CredItem;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isMasked = item.password?.startsWith("••") ?? false;

  return (
    <article className="rounded-xl border border-line bg-bg/60 p-5 backdrop-blur-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{item.label}</h3>
            {item.isSystem && (
              <span className="rounded-full bg-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                sistema
              </span>
            )}
          </div>
          {item.consoleUrl && (
            <a
              href={item.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-brand hover:underline"
            >
              {item.consoleUrl} ↗
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="text-sm text-brand hover:underline"
        >
          {editing ? "Cancelar" : "Editar"}
        </button>
      </header>

      {!editing && (
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Field label="Usuário" value={item.username ?? "—"} />
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">
              Senha
            </dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="font-mono text-xs">
                {showPassword && !isMasked ? item.password : "••••••••"}
              </code>
              {!isMasked && item.password && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-brand hover:underline"
                >
                  {showPassword ? "ocultar" : "mostrar"}
                </button>
              )}
              {item.password && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(item.password ?? "");
                  }}
                  className="text-[11px] text-muted hover:text-brand"
                  title="copiar"
                >
                  📋
                </button>
              )}
            </dd>
          </div>
          <Field
            label="External ID"
            value={item.externalAdminUserId ?? "—"}
            mono
          />
        </dl>
      )}

      {item.notes && !editing && (
        <p className="mt-3 rounded-md border border-line bg-bg/40 p-3 text-xs text-muted">
          {item.notes}
        </p>
      )}

      {editing && <EditCardForm item={item} onDone={onRefresh} />}
    </article>
  );
}

function EditCardForm({
  item,
  onDone,
}: {
  item: CredItem;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/platform/vault/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(fd.get("username") ?? "").trim() || null,
          password: String(fd.get("password") ?? "").trim() || null,
          consoleUrl: String(fd.get("consoleUrl") ?? "").trim() || null,
          notes: String(fd.get("notes") ?? "").trim() || null,
          externalAdminUserId:
            String(fd.get("externalAdminUserId") ?? "").trim() || null,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Falha");
        return;
      }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-line pt-4">
      <FormField name="username" label="Usuário" defaultValue={item.username ?? ""} />
      <FormField
        name="password"
        label="Senha"
        type="password"
        defaultValue=""
        placeholder="(deixe vazio pra manter)"
      />
      <FormField
        name="consoleUrl"
        label="URL do console"
        type="url"
        defaultValue={item.consoleUrl ?? ""}
      />
      <FormField
        name="externalAdminUserId"
        label="External admin user ID (Chatwoot/GLPI)"
        defaultValue={item.externalAdminUserId ?? ""}
        help="Usado pra sync de senha. Veja docs do provider."
      />
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Notas
        </span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={item.notes ?? ""}
          className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}

function AddCustomEntry({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/platform/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: String(fd.get("provider") ?? "")
            .trim()
            .toLowerCase(),
          label: String(fd.get("label") ?? "").trim(),
          consoleUrl: String(fd.get("consoleUrl") ?? "").trim() || null,
          username: String(fd.get("username") ?? "").trim() || null,
          password: String(fd.get("password") ?? "").trim() || null,
          notes: String(fd.get("notes") ?? "").trim() || null,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Falha");
        return;
      }
      setOpen(false);
      onAdded();
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-line py-4 text-sm text-muted hover:border-brand hover:text-brand"
      >
        + Adicionar credencial customizada
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-line bg-bg/60 p-5"
    >
      <h3 className="text-base font-semibold">Nova credencial</h3>
      <FormField name="provider" label="Provider (slug)" required help="Ex: cloudflare, namecheap, ses-aws" />
      <FormField name="label" label="Nome amigável" required />
      <FormField name="consoleUrl" label="URL do console" type="url" />
      <FormField name="username" label="Usuário" />
      <FormField name="password" label="Senha" type="password" />
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Notas
        </span>
        <textarea
          name="notes"
          rows={2}
          className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </label>
      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Salvando..." : "Adicionar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-fg"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`mt-0.5 text-xs ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function FormField({
  name,
  label,
  defaultValue = "",
  type = "text",
  placeholder,
  required,
  help,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
      />
      {help && <p className="mt-1 text-[11px] text-muted">{help}</p>}
    </label>
  );
}

// ============================================================================
// MasterSyncCard — troca senha/email do master em yugo + Chatwoot + GLPI
// ============================================================================
function MasterSyncCard({ onSynced }: { onSynced: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    providers: Array<{
      provider: string;
      ok: boolean;
      status?: number;
      message?: string;
    }>;
    updatedYugo: boolean;
  } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, string> = {
      currentPlatformPassword: String(fd.get("currentPlatformPassword") ?? ""),
    };
    const np = String(fd.get("newPassword") ?? "").trim();
    const ne = String(fd.get("newEmail") ?? "").trim();
    if (np) payload.newPassword = np;
    if (ne) payload.newEmail = ne;
    if (!np && !ne) {
      setError("Informe nova senha ou novo e-mail (pelo menos um).");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/platform/master/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha");
        return;
      }
      setResult(data);
      onSynced();
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-brand/40 bg-brand/10 px-5 py-4 text-left transition hover:bg-brand/20"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-brand">
              🔁 Sincronizar senha em todos os sistemas
            </p>
            <p className="mt-1 text-sm text-muted">
              Troca de uma vez a senha (e/ou e-mail) do master no yugo, no
              Chatwoot e no GLPI. Exige <code>External admin user ID</code>{" "}
              preenchido em cada provider abaixo.
            </p>
          </div>
          <span className="text-2xl text-brand">→</span>
        </div>
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-brand/40 bg-brand/5 p-6"
    >
      <header className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            Sincronizar credenciais do master
          </h3>
          <p className="mt-1 text-sm text-muted">
            Vai atualizar:{" "}
            <strong>yugo</strong> · <strong>Chatwoot</strong> ·{" "}
            <strong>GLPI</strong>. Evolution não tem usuário (só API key).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-fg"
        >
          ✕
        </button>
      </header>

      <FormField
        name="currentPlatformPassword"
        label="Sua senha atual no yugo"
        type="password"
        required
        help="Pra confirmar que é você."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="newPassword"
          label="Nova senha"
          type="password"
          help="Min 12 caracteres, maiúscula, minúscula, número. Deixe vazio se só quer trocar e-mail."
        />
        <FormField
          name="newEmail"
          label="Novo e-mail (opcional)"
          type="email"
          help="Se quiser trocar o e-mail em todos os sistemas."
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-line bg-bg/40 p-4">
          <p className="text-sm font-semibold">Resultado:</p>
          <p className="text-sm">
            <span className="inline-block w-24">yugo:</span>
            <span className="text-green-300">✓ atualizado</span>
          </p>
          {result.providers.map((p) => (
            <p key={p.provider} className="text-sm">
              <span className="inline-block w-24">{p.provider}:</span>
              {p.ok ? (
                <span className="text-green-300">
                  ✓ atualizado{p.status ? ` (HTTP ${p.status})` : ""}
                </span>
              ) : (
                <span className="text-red-300">
                  ✗ {p.message ?? "falhou"}
                </span>
              )}
            </p>
          ))}
          {result.providers.some((p) => !p.ok) && (
            <p className="text-xs text-muted">
              Falhas comuns: External admin user ID não preenchido no cofre,
              ou integração desativada em /app/platform/integrations.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Sincronizando..." : "Sincronizar tudo"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-fg"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// DiscoverIdsCard - auto-descobre external_admin_user_id em Chatwoot e GLPI
// ============================================================================
function DiscoverIdsCard({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    chatwoot: string | null;
    glpi: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function discover() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/platform/master/discover", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha");
        return;
      }
      setResult(data);
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-bg/40 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">🔍 Auto-descobrir IDs externos</p>
          <p className="mt-1 text-xs text-muted">
            Procura seu email do master no Chatwoot e GLPI e preenche o{" "}
            <code className="font-mono">External admin user ID</code>{" "}
            automaticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={discover}
          disabled={loading}
          className="rounded-lg border border-line px-4 py-2 text-xs font-medium hover:border-brand disabled:opacity-50"
        >
          {loading ? "Buscando..." : "Descobrir agora"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-1 rounded-md border border-line bg-bg/60 p-3 text-xs">
          <p>
            <span className="inline-block w-20">Chatwoot:</span>
            {result.chatwoot ? (
              <span className="text-green-300">ID = {result.chatwoot}</span>
            ) : (
              <span className="text-red-300">não encontrado</span>
            )}
          </p>
          <p>
            <span className="inline-block w-20">GLPI:</span>
            {result.glpi ? (
              <span className="text-green-300">ID = {result.glpi}</span>
            ) : (
              <span className="text-red-300">não encontrado</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
