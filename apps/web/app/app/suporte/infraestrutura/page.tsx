export const dynamic = "force-dynamic";

export default function InfraestruturaPage() {
  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Infraestrutura
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Como o sistema está montado</h1>
        <p className="mt-2 text-muted">
          Topologia, domínios, e onde cada serviço roda.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Domínios</h2>
        <div className="space-y-2 text-sm">
          <Row label="App + API" value="yugochat.com.br" />
          <Row label="Chatwoot (atendimento)" value="chatwoot.yugochat.com.br" />
          <Row label="GLPI (chamados)" value="chamados.yugochat.com.br" />
          <Row label="Evolution (WhatsApp)" value="evo.yugochat.com.br" />
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Serviços em containers</h2>
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg/40 p-4 font-mono text-xs text-fg">
{`yugo-caddy       reverse proxy + TLS 1.3 + HTTP/3
yugo-web         Next.js 15 (landing + /app + /login)
yugo-api         NestJS + Fastify + Prisma + Argon2id
yugo-postgres    PostgreSQL 16 com Row-Level Security
yugo-redis       cache + sessões + filas (BullMQ futuro)
yugo-minio       storage S3-compatible (logos, uploads)

yugo-chatwoot          chat omnichannel (Rails 7)
yugo-chatwoot-sidekiq  worker do Chatwoot
yugo-glpi              helpdesk (PHP)
yugo-glpi-db           MariaDB do GLPI
yugo-evolution         WhatsApp Business gateway

rustdesk-hbbs / hbbr   suporte remoto (coabita)`}
        </pre>
      </section>

      <section className="mb-8 rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Rede interna</h2>
        <p className="text-sm text-muted">
          Containers conversam entre si via rede docker <code>yugo-internal</code>.
          Apenas Caddy expõe portas 80/443 ao mundo. Acesso externo passa
          obrigatoriamente por TLS 1.3 com cert Let's Encrypt auto-renovado.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Bancos de dados</h2>
        <div className="space-y-2 text-sm">
          <Row label="yugo" value="42 tabelas + RLS" />
          <Row label="chatwoot" value="Schema do Chatwoot (compartilha Postgres)" />
          <Row label="evolution" value="Schema do Evolution (compartilha Postgres)" />
          <Row label="GLPI" value="MariaDB separada (yugo-glpi-db)" />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
