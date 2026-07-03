"use client";

import { useState, type FormEvent, type ReactNode } from "react";

type Integration = Record<string, unknown> & {
  id: string;
  provider: string;
  label: string;
  description: string | null;
  baseUrl: string;
  webhookUrl: string | null;
  consoleUrl: string | null;
  apiKey: string | null;
  apiToken: string | null;
  username: string | null;
  password: string | null;
  status: string;
  embedEnabled: boolean;
  embedLabel: string | null;
  embedIcon: string | null;
};

interface Props {
  initial: Array<Record<string, unknown>>;
}

interface FieldDef {
  /** chave do form values - bate com o nome do campo no banco */
  name:
    | "label"
    | "baseUrl"
    | "webhookUrl"
    | "consoleUrl"
    | "apiKey"
    | "apiToken"
    | "username"
    | "password"
    | "embedLabel"
    | "embedIcon";
  /** label visivel (substitui o generico) */
  label: string;
  /** explicacao abaixo do campo */
  help?: ReactNode;
  type?: "text" | "password" | "url";
  placeholder?: string;
}

/**
 * Esquema de campos por provider. Cada provider mostra apenas o que
 * realmente usa, com labels especificos pro contexto dele.
 */
const PROVIDER_SCHEMA: Record<
  string,
  {
    intro: ReactNode;
    fields: FieldDef[];
    docsUrl?: string;
  }
> = {
  chatwoot: {
    intro: (
      <>
        Plataforma de chat omnichannel auto-hospedada. Vamos criar Accounts
        (empresas) e Users automaticamente quando você criar uma org no
        yugo. Use <strong>Platform Access Token</strong> — não User Token.
      </>
    ),
    docsUrl: "https://www.chatwoot.com/developers/api/",
    fields: [
      { name: "label", label: "Nome amigável", placeholder: "Chatwoot" },
      {
        name: "baseUrl",
        label: "URL do Chatwoot",
        type: "url",
        placeholder: "https://chatwoot.yugochat.com.br",
        help: "URL pública onde o Chatwoot está rodando.",
      },
      {
        name: "apiToken",
        label: "Platform Access Token",
        type: "password",
        help: (
          <>
            <strong>NÃO use User Access Token.</strong> Vá em{" "}
            <code className="font-mono text-[11px]">
              https://chatwoot.yugochat.com.br/super_admin
            </code>{" "}
            → sidebar "Access Tokens" → <strong>Add new</strong>. Copia o
            token gerado (só aparece uma vez).
          </>
        ),
      },
      {
        name: "consoleUrl",
        label: "URL do console (opcional)",
        type: "url",
        placeholder: "https://chatwoot.yugochat.com.br",
        help: "Link que aparece no menu pra abrir o painel do Chatwoot.",
      },
    ],
  },

  glpi: {
    intro: (
      <>
        Helpdesk/ITSM auto-hospedado. Vamos criar uma Entity (empresa) por
        org, Group (loja) por store, e User por membership. Precisa de{" "}
        <strong>2 tokens</strong>: App-Token e User Token.
      </>
    ),
    docsUrl: "https://github.com/glpi-project/glpi/blob/main/apirest.md",
    fields: [
      { name: "label", label: "Nome amigável", placeholder: "GLPI Helpdesk" },
      {
        name: "baseUrl",
        label: "URL do GLPI",
        type: "url",
        placeholder: "https://chamados.yugochat.com.br",
      },
      {
        name: "apiKey",
        label: "App-Token (do client API)",
        type: "password",
        help: (
          <>
            Ative API REST em{" "}
            <strong>Configurar → Geral → API</strong>. Depois em "Clientes
            API" crie um novo cliente <em>yugo-platform</em> e copia o
            App-Token.
          </>
        ),
      },
      {
        name: "apiToken",
        label: "User Token (do usuário admin)",
        type: "password",
        help: (
          <>
            Logado como <code>glpi</code> (ou outro admin), vá em{" "}
            <strong>seu perfil → Personalização → Tokens de acesso remoto</strong>
            . Em "API token" clique <strong>Gerar</strong> e copia.
          </>
        ),
      },
      {
        name: "username",
        label: "Usuário (opcional, fallback)",
        placeholder: "glpi",
        help: "Se preferir Basic Auth em vez de User Token, preencha aqui.",
      },
      {
        name: "password",
        label: "Senha (opcional, fallback)",
        type: "password",
      },
      {
        name: "consoleUrl",
        label: "URL do console",
        type: "url",
        placeholder: "https://chamados.yugochat.com.br",
      },
    ],
  },

  mercadopago: {
    intro: (
      <>
        Gateway de pagamentos pra assinaturas recorrentes (preapproval). Use o
        <strong> Access Token de Produção</strong> da sua aplicação MP. Quando
        ativo, o sistema detecta pagamentos automaticamente via webhook e
        atualiza a assinatura da org no banco.
      </>
    ),
    docsUrl: "https://www.mercadopago.com.br/developers/pt/reference/subscriptions",
    fields: [
      { name: "label", label: "Nome amigável", placeholder: "Mercado Pago" },
      {
        name: "baseUrl",
        label: "API base",
        type: "url",
        placeholder: "https://api.mercadopago.com",
        help: "Não precisa mexer.",
      },
      {
        name: "apiToken",
        label: "Access Token (Production)",
        type: "password",
        help: (
          <>
            Em{" "}
            <a
              href="https://www.mercadopago.com.br/developers/panel/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              MP Developer Panel
            </a>{" "}
            → sua aplicação → <strong>Credenciais → Produção</strong> →
            copie o <code className="font-mono text-[11px]">APP_USR-...</code>.
            Pra testes, use o de Sandbox.
          </>
        ),
      },
      {
        name: "apiKey",
        label: "Public Key (opcional)",
        type: "password",
        help: "Usado pra Brick/Checkout direto no front (Pix QR). Pra preapproval só, deixe vazio.",
      },
      {
        name: "webhookUrl",
        label: "URL do webhook (gravar no painel MP)",
        type: "url",
        placeholder: "https://yugochat.com.br/api/subscriptions/webhooks/mercadopago",
        help: (
          <>
            Cole essa URL no painel do MP em{" "}
            <strong>Sua aplicação → Webhooks → Modo Produção</strong>. Eventos:
            <code className="font-mono text-[11px]"> payment</code>,{" "}
            <code className="font-mono text-[11px]">subscription_preapproval</code>.
          </>
        ),
      },
      {
        name: "consoleUrl",
        label: "URL do console (opcional)",
        type: "url",
        placeholder: "https://www.mercadopago.com.br/developers/panel/app",
      },
      {
        name: "password",
        label: "Webhook Secret (opcional)",
        type: "password",
        help: "Mesma chave secreta do webhook configurada no painel MP. Quando preenchida, validamos a assinatura (x-signature) de cada notificação — igual ao fluxo da empresa.",
      },
    ],
  },

  evolution: {
    intro: (
      <>
        Gateway WhatsApp self-hosted. Sem usuários — cada Instance representa
        1 número WhatsApp. Vamos criar 1 instance por <strong>Store</strong>{" "}
        quando provisionar uma org.
      </>
    ),
    docsUrl: "https://doc.evolution-api.com/",
    fields: [
      { name: "label", label: "Nome amigável", placeholder: "Evolution WhatsApp" },
      {
        name: "baseUrl",
        label: "URL do Evolution",
        type: "url",
        placeholder: "https://evo.yugochat.com.br",
      },
      {
        name: "apiKey",
        label: "AUTHENTICATION_API_KEY",
        type: "password",
        help: (
          <>
            Variável de ambiente <code>AUTHENTICATION_API_KEY</code> do
            Evolution. No nosso setup está em{" "}
            <code className="font-mono text-[11px]">
              /opt/yugo-platform/infra/docker/.env.production
            </code>{" "}
            como <code>EVOLUTION_API_KEY</code>.
          </>
        ),
      },
      {
        name: "webhookUrl",
        label: "URL do webhook (callbacks)",
        type: "url",
        placeholder: "https://yugochat.com.br/api/webhooks/evolution",
        help:
          "Onde o Evolution manda mensagens recebidas. Será usado quando o webhook estiver implementado.",
      },
      {
        name: "consoleUrl",
        label: "URL do manager",
        type: "url",
        placeholder: "https://evo.yugochat.com.br/manager",
      },
    ],
  },
};

export function IntegrationsList({ initial }: Props) {
  const list = initial as Integration[];
  return (
    <div className="space-y-4">
      {list.map((it) => (
        <IntegrationCard key={it.provider} integration={it} />
      ))}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const schema = PROVIDER_SCHEMA[integration.provider];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    label: integration.label ?? "",
    baseUrl: integration.baseUrl ?? "",
    webhookUrl: integration.webhookUrl ?? "",
    consoleUrl: integration.consoleUrl ?? "",
    apiKey: integration.apiKey ?? "",
    apiToken: integration.apiToken ?? "",
    username: integration.username ?? "",
    password: integration.password ?? "",
    embedLabel: integration.embedLabel ?? "",
    embedIcon: integration.embedIcon ?? "",
  });
  const [embedEnabled, setEmbedEnabled] = useState(integration.embedEnabled);
  const [status, setStatus] = useState(integration.status);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { embedEnabled, status };
      for (const [k, v] of Object.entries(values)) {
        payload[k] = v.trim() === "" ? null : v.trim();
      }
      const res = await fetch(`/api/platform/integrations/${integration.provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? "Falha ao salvar");
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  const isActive = status === "active";
  const fields = schema?.fields ?? [];

  return (
    <article className="card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{integration.label}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                isActive
                  ? "bg-success/15 text-success"
                  : "bg-surface-2 text-muted"
              }`}
            >
              {status}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{integration.description}</p>
          <p className="mt-1 text-xs text-muted">
            provider: <code className="font-mono">{integration.provider}</code>
            {schema?.docsUrl && (
              <>
                {" · "}
                <a
                  href={schema.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand underline hover:opacity-80"
                >
                  docs
                </a>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 text-sm text-brand hover:underline"
        >
          {open ? "Fechar" : "Configurar →"}
        </button>
      </header>

      {open && (
        <form onSubmit={save} className="mt-6 space-y-4 border-t border-line pt-6">
          {schema?.intro && (
            <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">
              {schema.intro}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <Field
                key={f.name}
                def={f}
                value={values[f.name] ?? ""}
                onChange={(v) => setValues({ ...values, [f.name]: v })}
              />
            ))}
          </div>

          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={embedEnabled}
                onChange={(e) => setEmbedEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              <span>
                <strong>Mostrar no menu lateral</strong>
                <span className="ml-2 text-muted">
                  (item de menu pra abrir o console externo)
                </span>
              </span>
            </label>
            {embedEnabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  def={{
                    name: "embedLabel",
                    label: "Label no menu",
                    placeholder: "Ex: WhatsApp",
                  }}
                  value={values.embedLabel ?? ""}
                  onChange={(v) => setValues({ ...values, embedLabel: v })}
                />
                <Field
                  def={{
                    name: "embedIcon",
                    label: "Ícone (lucide)",
                    placeholder: "message-circle",
                  }}
                  value={values.embedIcon ?? ""}
                  onChange={(v) => setValues({ ...values, embedIcon: v })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs font-medium uppercase tracking-wider text-muted">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input-base w-auto py-1.5"
            >
              <option value="disabled">disabled</option>
              <option value="active">active</option>
              <option value="error">error</option>
            </select>
          </div>

          {error && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {savedAt && (
            <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              Salvo às {savedAt.toLocaleTimeString("pt-BR")}.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <TestButton provider={integration.provider} />
            <button
              type="submit"
              disabled={saving}
              className="btn-grad"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {def.label}
      </span>
      <input
        type={def.type ?? "text"}
        value={value}
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="input-base"
      />
      {def.help && (
        <p className="mt-1 text-[11px] leading-snug text-muted">{def.help}</p>
      )}
    </label>
  );
}

function TestButton({ provider }: { provider: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; status: number; error?: string } | null>(null);

  async function run() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/platform/integrations/${provider}/test`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; status?: number; error?: string };
      setResult({ ok: Boolean(data.ok), status: data.status ?? 0, error: data.error });
    } catch (e: any) {
      setResult({ ok: false, status: 0, error: String(e?.message ?? "erro") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={testing}
        className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50"
      >
        {testing ? "Testando..." : "Testar conexão"}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.ok
            ? `✓ conexão OK (HTTP ${result.status})`
            : `✗ falhou${result.status ? ` (HTTP ${result.status})` : ""}: ${result.error ?? ""}`}
        </span>
      )}
    </div>
  );
}
