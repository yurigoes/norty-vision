/**
 * ESQUELETO DE CARREGAMENTO
 * ============================================================================
 * Não existia nenhum `loading.tsx` no projeto: entre uma tela e outra o
 * sistema ficava parado, mostrando a tela ANTERIOR, e o único sinal de vida
 * era o overlay "Processando…" — que bloqueia a tela inteira e é a linguagem
 * de quem está salvando algo, não de quem está abrindo uma página.
 *
 * Aqui o lugar do conteúdo é ocupado por blocos na forma do que vem: a pessoa
 * já vê a tabela, o quadro ou o formulário tomando forma. A percepção de
 * espera cai mesmo com o mesmo tempo de resposta.
 *
 * O cabeçalho é sempre o mesmo porque todas as telas usam o `PageHeader`.
 */

export function SkeletonLine({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton h-4 ${className}`} style={style} />;
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Cabeçalho: categoria, título e descrição — o formato do `PageHeader`. */
function HeaderSkeleton() {
  return (
    <div className="mb-6 sm:mb-8">
      <SkeletonLine className="h-3 w-28" />
      <SkeletonLine className="mt-2.5 h-7 w-56 sm:h-8 sm:w-72" />
      <SkeletonLine className="mt-3 h-4 w-full max-w-md" />
    </div>
  );
}

function Cards({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-5">
          <SkeletonLine className="h-3 w-20" />
          <SkeletonLine className="mt-3 h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

function Rows({ n = 6 }: { n?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <SkeletonLine className="h-3 w-32" />
      </div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
          <SkeletonBlock className="h-9 w-9 shrink-0 rounded-full" />
          <SkeletonLine className="w-40 max-w-[38%]" />
          <SkeletonLine className="hidden w-28 sm:block" />
          <SkeletonLine className="ml-auto w-16" />
        </div>
      ))}
    </div>
  );
}

function Board() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {Array.from({ length: 4 }).map((_, c) => (
        <div key={c} className="w-64 shrink-0 rounded-2xl border border-line bg-surface p-3">
          <SkeletonLine className="h-3 w-24" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Form() {
  return (
    <div className="max-w-2xl space-y-5 rounded-2xl border border-line bg-surface p-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i}>
          <SkeletonLine className="h-3 w-24" />
          <SkeletonBlock className="mt-2 h-11 rounded-xl" />
        </div>
      ))}
      <SkeletonBlock className="h-11 w-36 rounded-xl" />
    </div>
  );
}

function Calendar() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex gap-2">
        <SkeletonBlock className="h-9 w-32 rounded-xl" />
        <SkeletonBlock className="h-9 w-24 rounded-xl" />
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 35 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-14 rounded-lg sm:h-20" />
        ))}
      </div>
    </div>
  );
}

/** Lista à esquerda + conteúdo à direita (atendimento, PDV, telefone). */
function Split() {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-14 rounded-xl" />
        ))}
      </div>
      <SkeletonBlock className="hidden h-[420px] rounded-2xl lg:block" />
    </div>
  );
}

/** Painel inicial: números em cima, grade de atalhos embaixo. */
function Home() {
  return (
    <div className="space-y-8">
      <Cards />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** Texto corrido: ajuda, guias, política, tela de módulo bloqueado. */
function Doc() {
  return (
    <div className="max-w-2xl space-y-3">
      {[100, 92, 96, 70].map((w, i) => (
        <SkeletonLine key={i} style={{ width: `${w}%` }} />
      ))}
      <SkeletonBlock className="mt-6 h-28 rounded-2xl" />
      {[88, 94, 60].map((w, i) => (
        <SkeletonLine key={`b${i}`} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      <Cards />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-64 rounded-2xl" />
        <SkeletonBlock className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

export type SkeletonVariant =
  | "page"
  | "table"
  | "dashboard"
  | "board"
  | "form"
  | "calendar"
  | "split"
  | "home"
  | "doc";

const CORPO: Record<SkeletonVariant, () => React.JSX.Element> = {
  page: () => (
    <div className="space-y-6">
      <Cards n={3} />
      <Rows n={4} />
    </div>
  ),
  table: () => <Rows />,
  dashboard: Dashboard,
  board: Board,
  form: Form,
  calendar: Calendar,
  split: Split,
  home: Home,
  doc: Doc,
};

/**
 * Tela inteira em estado de carregamento. Usado pelos `loading.tsx`.
 *
 * `aria-busy` + `role="status"` fazem o leitor de tela anunciar "carregando"
 * uma vez, em vez de ler os blocos vazios.
 */
export function PageSkeleton({ variant = "page" }: { variant?: SkeletonVariant }) {
  const Corpo = CORPO[variant];
  return (
    <div role="status" aria-busy="true" aria-label="Carregando" className="animate-fade-in">
      <span className="sr-only">Carregando…</span>
      <HeaderSkeleton />
      <Corpo />
    </div>
  );
}
