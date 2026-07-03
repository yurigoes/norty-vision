import Link from "next/link";
import { ThemeToggle } from "../../components/ThemeToggle";
import { BrandLogo } from "../../components/BrandLogo";
import { EntrarMenu } from "../../components/EntrarMenu";
import { ApresentacaoClient } from "./ApresentacaoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demonstração — yugochat" };

export default function ApresentacaoPage() {
  return (
    <main className="relative">
      <nav className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/"><BrandLogo size="md" className="transition-opacity hover:opacity-80" /></Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="hidden text-sm text-muted hover:text-fg sm:block">Início</Link>
            <Link href="/planos" className="hidden text-sm text-muted hover:text-fg sm:block">Planos</Link>
            <EntrarMenu />
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <ApresentacaoClient />

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="text-2xl font-semibold">Gostou? Comece grátis por 14 dias.</h2>
        <p className="mt-2 text-muted">Sem cartão no cadastro. Ative só os módulos que precisar e contrate mais quando quiser.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/planos" className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">Ver planos</Link>
          <Link href="/#contato" className="rounded-lg border border-line px-6 py-3 text-sm font-semibold transition hover:border-brand">Falar com a gente</Link>
        </div>
      </section>
    </main>
  );
}
