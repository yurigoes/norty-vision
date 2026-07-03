import Link from "next/link";
import { SsoCards } from "./SsoCards";

export default function SuporteIndex() {
  const cards = [
    { title: "Ajuda", body: "Passo a passo de cada ação no sistema.", href: "/app/suporte/ajuda" },
    { title: "Guia do sistema", body: "O que cada módulo faz, explicado.", href: "/app/suporte/guia" },
    { title: "Guia da Gráfica", body: "Passo a passo pra configurar o fluxo da gráfica/uniformes.", href: "/app/suporte/guia-grafica" },
    { title: "Specs técnicas", body: "Stack, segurança, infra (acesso restrito).", href: "/app/suporte/specs" },
    { title: "Infraestrutura", body: "Topologia, serviços e domínios da plataforma.", href: "/app/suporte/infraestrutura" },
    { title: "Servidor / VPS", body: "RAM, disco, backup e manutenção (master).", href: "/app/suporte/sistema" },
    { title: "Saúde do sistema", body: "Status dos serviços em tempo real.", href: "/app/suporte/saude" },
    { title: "Backup", body: "Jobs de backup configurados e última execução.", href: "/app/suporte/backup" },
    { title: "Privacidade · LGPD", body: "Trail de acessos a dados pessoais.", href: "/app/suporte/privacidade" },
  ];
  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Como podemos ajudar?</h1>
        <p className="mt-2 text-muted">
          Documentação, status e informações da plataforma. Tudo num só lugar.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card block"
          >
            <h3 className="text-base font-semibold">{c.title}</h3>
            <p className="mt-1 text-sm text-muted">{c.body}</p>
          </Link>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
          Acessos rápidos (SSO)
        </h2>
        <SsoCards />
      </section>
    </div>
  );
}
