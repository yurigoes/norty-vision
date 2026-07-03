import Link from "next/link";
import { BrandLogo } from "../../components/BrandLogo";

export const metadata = {
  title: "Termos de uso",
  description: "Termos de uso da plataforma.",
};

export default async function TermosPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <Link href="/" className="mb-12 inline-block transition-opacity hover:opacity-80">
        <BrandLogo size="md" />
      </Link>
      <h1 className="text-3xl font-semibold">Termos de uso</h1>
      <p className="mt-6 text-muted">
        Em construção. O texto definitivo será publicado em breve pelo master da
        plataforma.
      </p>
      <Link href="/" className="mt-12 inline-block text-sm text-muted hover:text-fg">
        ← voltar
      </Link>
    </main>
  );
}
