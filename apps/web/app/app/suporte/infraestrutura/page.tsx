import { headers } from "next/headers";
import { PageHeader } from "../../../../components/PageHeader";
import { ROOT_DOMAIN } from "../../../../lib/brand";

export const dynamic = "force-dynamic";

/**
 * Topologia REAL desta instalação (`infra/docker/docker-compose.norty.yml`).
 *
 * A página descrevia o stack da OUTRA instalação (containers e domínio que
 * não existem aqui). Descrição de infraestrutura
 * que não bate com a máquina é pior que nenhuma: manda o suporte procerar
 * container que não existe.
 */
export default async function InfraestruturaPage() {
  // o domínio real de quem está lendo, não um cravado no código
  const host = (await headers()).get("host")?.split(":")[0] ?? ROOT_DOMAIN;

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Infraestrutura"
        title="Como o sistema está montado"
        description="Topologia, domínios e onde cada serviço roda."
      />

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Endereços</h2>
        <div className="space-y-2 text-sm">
          <Row label="App + API" value={host} />
          <Row label="API" value={`${host}/api/*`} />
          <Row label="Arquivos (MinIO)" value={`${host}/storage/*`} />
          <Row label="Portais" value="/e · /rh · /c · /f  (por empresa)" />
        </div>
        <p className="mt-4 text-xs text-muted">
          Chatwoot, GLPI e Evolution (WhatsApp) são integrações opcionais — os
          endereços de cada uma ficam em <strong>Integrações</strong>, no menu
          do master.
        </p>
      </section>

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Serviços em containers</h2>
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg/40 p-4 font-mono text-xs text-fg">
{`nv-cloudflared   túnel Cloudflare — o TLS termina no edge
nv-caddy         roteia por caminho: /api → nv-api,
                 /storage → minio, resto → nv-web
nv-web           Next.js 15 (App Router)
nv-api           NestJS + Fastify + Prisma + Argon2id

postgres         PostgreSQL 16 com Row-Level Security   ┐
redis            cache, sessões e filas                 ├ compartilhados
minio            storage S3-compatible (logos, uploads) ┘`}
        </pre>
        <p className="mt-4 text-xs text-muted">
          Postgres, Redis e MinIO são compartilhados com o outro stack da mesma
          VPS — não há uma segunda cópia de cada.
        </p>
      </section>

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Rede</h2>
        <p className="text-sm text-muted">
          Os containers conversam pelas redes docker <code>norty-internal</code>{" "}
          e <code>yugo-internal</code> (esta última para alcançar o Postgres, o
          Redis e o MinIO compartilhados). <strong>Nada é publicado nas portas
          80/443 do host</strong>: todo o tráfego externo entra pelo túnel da
          Cloudflare, que termina o TLS no edge.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Banco</h2>
        <div className="space-y-2 text-sm">
          <Row label="norty_vision" value="PostgreSQL 16 · RLS por empresa e loja" />
          <Row label="Isolamento" value="organization_id + store_id em toda tabela" />
          <Row label="Migrations" value="SQL versionado em packages/db/sql" />
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
