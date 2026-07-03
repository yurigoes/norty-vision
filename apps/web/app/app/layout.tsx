import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, can } from "../../lib/session";
import { apiFetch } from "../../lib/api";
import { getChatwootEmbedConfig } from "../../lib/integrations";
import { hexToRgbTriplet } from "../../lib/color";
import { ThemeToggle } from "../../components/ThemeToggle";
import { LogoutButton } from "../../components/LogoutButton";
import { ChatwootWidget } from "../../components/ChatwootWidget";
import { BrandLogo } from "../../components/BrandLogo";
import { SaasWatermark } from "../../components/SaasWatermark";
import { SidebarLink } from "../../components/SidebarLink";
import { SidebarSection } from "../../components/SidebarSection";
import { SidebarCountsProvider } from "../../components/SidebarCounts";
import { LockedModules } from "../../components/LockedModules";
import { moduleLabel, moduleAllowedForNiche } from "../../lib/modules";
import { InternalAlerts } from "../../components/InternalAlerts";
import { RouteFade } from "../../components/RouteFade";
import { DialogProvider } from "../../components/SystemDialog";
import { ImpersonationBanner } from "../../components/ImpersonationBanner";
import { MasterViewCompany } from "../../components/MasterViewCompany";
import { LoadingProvider } from "../../components/Loading";
import { Mensalidades } from "./billing/Mensalidades";
import { AppPwa } from "./AppPwa";
import { SoftphoneProvider } from "../../components/SoftphoneProvider";
import { CentralLeadsBoot } from "../../components/CentralLeadsBoot";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Norty Vision" },
  icons: { apple: "/yugo-app-icon.svg" },
};

// `perm` = permissão fina (catálogo) exigida pra ver o item. Quando presente,
// o item só aparece se o usuário tem a permissão (org admin e master sempre têm,
// via can()). Sem `perm`: item de operação aparece pra todos; item admin só pro
// admin. Isso conserta "libero permissão e não aparece" e "BI aparece a todos".
type NavItem = { key?: string; href: string; label: string; perm?: string; subMod?: string };
// Operação só aparece com contexto de empresa (não pro master puro).
const NAV_OPERACAO: NavItem[] = [
  { key: "bi", href: "/app/painel/otica", label: "Painel (BI)", perm: "reports.bi_panel" },
  { key: "insights", href: "/app/insights", label: "Insights (IA)" },
  { key: "agenda", href: "/app/agenda", label: "Agenda" },
  { key: "leads", href: "/app/leads", label: "Leads" },
  { key: "vendas", href: "/app/vendas", label: "Vendas (PDV)" },
  { key: "caixa", href: "/app/caixa", label: "Caixa" },
  { key: "producao", href: "/app/producao", label: "Produção / Pedidos" },
  { key: "producao", href: "/app/producao/costureiras", label: "Costureiras (atribuir / pagar)", subMod: "producao.costureiras" },
  { key: "producao", href: "/app/producao/import", label: "Importar planilha (.xlsx)", subMod: "producao.import" },
  { key: "atendimento_admin", href: "/app/atendimento/macros", label: "Macros do atendimento", subMod: "atendimento.macros" },
  { key: "atendimento_admin", href: "/app/atendimento/webhooks", label: "Webhooks (n8n/Zapier)", subMod: "atendimento.webhooks" },
  { key: "crm", href: "/app/crm", label: "Central de Atendimento" },
  { key: "crm", href: "/app/prospector", label: "Prospecção (leads)", subMod: "crm.prospector" },
  { key: "voip", href: "/app/voip", label: "Telefone (ramal)" },
  { href: "/app/suporte-sistema", label: "Suporte ao sistema" },
];
// Categorias visíveis pro admin da empresa.
const NAV_ADMIN: Array<{ title: string; items: NavItem[] }> = [
  { title: "Comercial", items: [
    { key: "orcamentos", href: "/app/orcamentos", label: "Orçamentos" },
    { key: "clientes", href: "/app/clientes", label: "Clientes" },
    { key: "atendimento", href: "/app/atendimento", label: "Atendimento" },
    { key: "chamados", href: "/app/chamados", label: "Chamados" },
    { key: "mala_direta", href: "/app/mala-direta", label: "Mala direta" },
    { key: "produtos", href: "/app/produtos", label: "Produtos" },
    { key: "catalogo", href: "/app/catalogo", label: "Catálogo online" },
    { key: "comissoes", href: "/app/comissoes", label: "Comissões" },
    { key: "pesquisas", href: "/app/pesquisas", label: "Pesquisas (NPS)" },
  ] },
  { title: "Ótica", items: [
    { key: "fornecedores", href: "/app/fornecedores", label: "Fornecedores" },
    { key: "pedidos_lente", href: "/app/pedidos-lente", label: "Pedidos de lente" },
    { key: "repasses", href: "/app/repasses", label: "Repasses" },
  ] },
  { title: "Financeiro", items: [
    { key: "crediario", href: "/app/crediario", label: "Crediário" },
    { key: "pagamentos", href: "/app/pagamentos", label: "Pagamentos" },
    { key: "pagamentos", href: "/app/transacoes", label: "Transações" },
    { key: "cobranca", href: "/app/cobranca", label: "Cobrança" },
    { key: "relatorios", href: "/app/relatorios", label: "Relatórios" },
    { key: "vendas_historico", href: "/app/vendas-historico", label: "Vendas (histórico)" },
    { key: "financeiro", href: "/app/financeiro/contas-a-pagar", label: "Contas a pagar", subMod: "financeiro.contas_pagar" },
    { key: "financeiro", href: "/app/financeiro/contas-a-receber", label: "Contas a receber", subMod: "financeiro.contas_receber" },
    { key: "fiscal", href: "/app/fiscal", label: "Nota fiscal (config)", perm: "fiscal.config" },
  ] },
  { title: "Documentos", items: [
    { key: "contratos", href: "/app/contratos", label: "Contratos" },
    { key: "modelos", href: "/app/modelos", label: "Mensagens" },
    { href: "/app/empresa-contrato", label: "Contrato da plataforma" },
  ] },
  { title: "Pessoas", items: [
    { key: "rh", href: "/app/rh", label: "RH & Funcionários" },
    { href: "/app/ponto", label: "Ponto eletrônico" },
  ] },
  { title: "Configuração", items: [
    { href: "/app/lojas", label: "Lojas", perm: "stores.manage" },
    { href: "/app/usuarios", label: "Usuários", perm: "users.manage" },
    { href: "/app/permissoes", label: "Permissões", perm: "roles.manage" },
    { key: "voip", href: "/app/voip-admin", label: "Telefonia (call center)", perm: "voip.admin" },
    { href: "/app/portal-cliente", label: "Portal do cliente" },
    { href: "/app/integracoes", label: "Integrações", perm: "integrations.manage" },
    { href: "/app/billing", label: "Assinatura" },
  ] },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.authenticated) {
    redirect("/login");
  }
  // staff da empresa: troca de senha obrigatória no 1º acesso
  // (não vale quando o master está impersonando — ele não troca a senha do dono)
  if (session.user?.mustResetPassword && !session.impersonating) {
    redirect("/trocar-senha");
  }

  const isMaster = session.master !== null;
  // 'support' = suporte master: opera qualquer empresa, mas nao acessa a
  // configuracao do dono do SaaS (identidade, planos, integracoes, cofre).
  const isPlatformOwner = session.master?.platformRole !== "support";
  const isOrgAdmin = session.user?.isOrgAdmin ?? false;
  // widget Chatwoot - master config define se aparece e com qual token
  const chatwootCfg = isMaster ? await getChatwootEmbedConfig() : null;

  // branding da empresa (contratante) — logo + cor principal no nivel da org
  let orgBrand: { primary: string | null; logoUrl: string | null } | null = null;
  // tema padrao escolhido no cadastro da empresa (predominante no slug)
  let orgTheme: "light" | "dark" | null = null;
  // módulos habilitados pelo plano: null = tudo liberado; array = só os listados
  let enabledModules: string[] | null = null;
  let orgStatus: string | null = null;
  let orgNiche: string | null = null;
  // "product skin": marca a org como produto Central de Leads (casca enxuta).
  let productSkin: string | null = null;
  // Deny-list de módulos do nicho, vinda do banco (tabela niches, editável no
  // master). null = ainda não carregado → cai no fallback do código (MODULE_NICHES).
  let nicheHidden: string[] | null = null;
  // Sub-módulos por empresa (Fase 2 + extensão): overrides default-on do master.
  // Mapa genérico { "<modulo>.<sub>": false }.
  let submoduleFeatures: Record<string, boolean> = {};
  if (session.user?.orgId) {
    const ores = await apiFetch<{ organization: any }>(`/api/organizations/me`);
    const org = ores.data?.organization;
    if (org) {
      orgStatus = org.status ?? null;
      orgNiche = org.niche ?? null;
      nicheHidden = Array.isArray(org.nicheHiddenModules) ? org.nicheHiddenModules : null;
      if (org.submoduleFeatures && typeof org.submoduleFeatures === "object") submoduleFeatures = org.submoduleFeatures;
      orgBrand = {
        primary: org.primaryColor ? hexToRgbTriplet(org.primaryColor) : null,
        logoUrl: org.logoUrl ?? null,
      };
      if (org.themeMode === "light" || org.themeMode === "dark") {
        orgTheme = org.themeMode;
      }
      enabledModules = Array.isArray(org.enabledModules) ? org.enabledModules : null;
      productSkin = typeof org.productSkin === "string" ? org.productSkin : null;
    }
  }
  // Central de Leads: produto enxuto na mesma base (menu reduzido + splash).
  const isCentralLeads = productSkin === "central-de-leads";
  // módulo bloqueado quando o plano define uma lista e a chave não está nela
  const locked = (key: string) => enabledModules !== null && !enabledModules.includes(key);

  // categorias visíveis ao usuário atual (operação só com contexto de empresa)
  const opVisible = !isMaster || !!session.impersonating;
  // Filtro por NICHO. Fonte primária = deny-list do banco (nicheHidden, editável
  // no master). Se o banco ainda não respondeu (null), cai no mapa do código
  // (moduleAllowedForNiche) — assim nada quebra antes da migration 190 rodar.
  // Itens SEM `key` são core (sempre aparecem).
  const nicheOk = (it: NavItem) => {
    if (!it.key) return true;
    if (nicheHidden !== null) return !nicheHidden.includes(it.key);
    return moduleAllowedForNiche(it.key, orgNiche);
  };
  // Filtro por PERMISSÃO fina. Item com `perm` só aparece se o usuário tem a
  // permissão (org admin/master sempre passam via can()). Conserta "BI aparece
  // a todos" e "recepcionista vê Integrações".
  const permOk = (it: NavItem) => !it.perm || can(session, it.perm);
  // Filtro por SUB-MÓDULO (Fase 2 + extensão): item com `subMod` ("<modulo>.<sub>",
  // ex.: producao.costureiras, financeiro.contas_pagar) some se o master desligou
  // aquele sub-módulo pra empresa. Default-on.
  const subOk = (it: NavItem) => !it.subMod || submoduleFeatures[it.subMod] !== false;

  // Operação: nicho + permissão + sub-módulo. Itens sem perm continuam visíveis a todos.
  const operacaoItems = NAV_OPERACAO.filter((it) => nicheOk(it) && permOk(it) && subOk(it));

  // Admin: cada item aparece se passar no nicho E:
  //   - tem `perm` → o usuário tem a permissão (não-admin com a perm também vê), OU
  //   - não tem `perm` → só admin da empresa (comportamento seguro de antes).
  // Categoria some se ficar vazia. Antes era tudo-ou-nada por isOrgAdmin; agora
  // um perfil (ex.: recepcionista) pode ver itens específicos pela permissão.
  const adminItemVisible = (it: NavItem) => nicheOk(it) && subOk(it) && (it.perm ? can(session, it.perm) : isOrgAdmin);
  const adminCats = NAV_ADMIN
    .map((c) => ({ ...c, items: c.items.filter(adminItemVisible) }))
    .filter((c) => c.items.length > 0);
  // adminCats só com contexto de org (opVisible) — master puro não vê config de
  // empresa. Dentro disso, cada item respeita perm (recepcionista vê o que pode).
  // Casca enxuta da Central de Leads: só Conversas + Pipeline + Canais.
  const centralLeadsCats: Array<{ title: string; items: NavItem[] }> = [
    { title: "Central de Leads", items: [
      { key: "crm", href: "/app/crm", label: "Leads & Pipeline" },
      { key: "atendimento", href: "/app/atendimento", label: "Conversas" },
      { href: "/app/integracoes", label: "Canais" },
    ] },
  ];
  const visibleCats: Array<{ title: string; items: NavItem[] }> = isCentralLeads
    ? centralLeadsCats
    : [
        ...(opVisible ? [{ title: "Operação", items: operacaoItems }] : []),
        ...(opVisible ? adminCats : []),
      ];
  // módulos bloqueados (deduplicados por chave) → seção "não liberados"
  const lockedKeys = new Set<string>();
  for (const cat of visibleCats) for (const it of cat.items) if (it.key && locked(it.key)) lockedKeys.add(it.key);
  const lockedList = [...lockedKeys].map((k) => ({ key: k, label: moduleLabel(k) }));
  // helper: itens disponíveis (não bloqueados) de uma categoria
  const availItems = (items: NavItem[]) => items.filter((it) => !it.key || !locked(it.key));

  // atalhos SSO/acesso rápido (Chatwoot/GLPI) provisionados pra empresa
  let shortcuts: Array<{ provider: string; label: string; url: string }> = [];
  if (isOrgAdmin) {
    const sc = await apiFetch<{ items: any[] }>(`/api/company-integrations/shortcuts`);
    shortcuts = sc.data?.items ?? [];
  }

  // branding da loja ativa — tem precedencia sobre o da org (loja > empresa)
  let storeBrand: { primary: string | null; logoUrl: string | null } | null = null;
  let companyTheme: "light" | "dark" | null = null;
  if (session.user?.storeId) {
    const sres = await apiFetch<{ store: any }>(`/api/stores/${session.user.storeId}`);
    const st = sres.data?.store;
    if (st) {
      storeBrand = {
        primary: st.themePrimaryColor ? hexToRgbTriplet(st.themePrimaryColor) : null,
        logoUrl: st.logoUrl ?? null,
      };
      if (st.themeMode === "light" || st.themeMode === "dark") {
        companyTheme = st.themeMode;
      }
    }
  }

  // ciclo de cancelamento: 30d carência (acesso normal) → 180d só leitura → encerrado
  let cancelPhase: "active" | "grace" | "readonly" | "ended" = "active";
  let cancelUntil: string | null = null;
  if (session.user?.orgId && !isMaster) {
    const subRes = await apiFetch<{ subscription: any }>(`/api/subscriptions/current`);
    const sub = subRes.data?.subscription;
    if (sub?.status === "canceled" && sub.canceledAt) {
      const days = (Date.now() - new Date(sub.canceledAt).getTime()) / 86400_000;
      const fmt = (d: number) => new Date(new Date(sub.canceledAt).getTime() + d * 86400_000).toLocaleDateString("pt-BR");
      if (days < 30) { cancelPhase = "grace"; cancelUntil = fmt(30); }
      else if (days < 30 + 180) { cancelPhase = "readonly"; cancelUntil = fmt(30 + 180); }
      else cancelPhase = "ended";
    }
  }

  // cor efetiva: loja sobrescreve empresa; logo: loja > empresa (contratante)
  const brandPrimary = storeBrand?.primary ?? orgBrand?.primary ?? null;
  const companyLogo = storeBrand?.logoUrl ?? orgBrand?.logoUrl ?? null;
  // tema efetivo: loja sobrescreve empresa (loja > empresa)
  const effectiveTheme = companyTheme ?? orgTheme;

  // EMPRESA SUSPENSA por inadimplência: bloqueia o acesso e mostra as
  // mensalidades em aberto. Master/impersonação não são bloqueados.
  if (orgStatus === "suspended" && session.user && !isMaster && !session.impersonating) {
    return (
      <LoadingProvider>
        <DialogProvider>
          <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
            <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-300">Acesso suspenso</p>
              <h1 className="mt-2 text-2xl font-semibold">Sua assinatura está com mensalidade em aberto</h1>
              <p className="mt-2 text-sm text-muted">
                Para reativar o acesso, regularize a(s) mensalidade(s) abaixo. Assim que o pagamento for confirmado, o sistema volta ao normal.
              </p>
            </div>
            <Mensalidades />
            <div className="mt-6 flex justify-end">
              <LogoutButton isMaster={false} />
            </div>
          </main>
        </DialogProvider>
      </LoadingProvider>
    );
  }

  // assinatura ENCERRADA (após 30d carência + 180d leitura): acesso fechado.
  if (cancelPhase === "ended" && session.user && !isMaster) {
    return (
      <LoadingProvider>
        <DialogProvider>
          <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10 text-center">
            <div className="rounded-2xl border border-line bg-bg/60 p-8">
              <h1 className="text-2xl font-semibold">Acesso encerrado</h1>
              <p className="mt-2 text-sm text-muted">
                O período de consulta da sua conta cancelada terminou. Para recuperar o acesso e seus dados, reative a assinatura ou fale com o suporte.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <a href="/app/billing" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white">Reativar assinatura</a>
              </div>
              <div className="mt-4 flex justify-center"><LogoutButton isMaster={false} /></div>
            </div>
          </main>
        </DialogProvider>
      </LoadingProvider>
    );
  }

  // softphone app-wide: ativa quando o módulo voip não está bloqueado pelo plano
  // e o usuário é da empresa (master/impersonando não toca como operador).
  const softphoneEnabled = !isMaster && !locked("voip");

  return (
    <LoadingProvider>
    <AppPwa />
    <SoftphoneProvider enabled={softphoneEnabled}>
    {isCentralLeads && <CentralLeadsBoot />}
    <div className="flex min-h-screen">
      {brandPrimary && (
        <style
          dangerouslySetInnerHTML={{
            __html: `:root,.light,.dark{--brand:${brandPrimary};}`,
          }}
        />
      )}
      {effectiveTheme && (
        // tema padrao da empresa/loja: aplica quando o usuario ainda nao escolheu
        // manualmente (sem 'yugo-theme' no localStorage). O toggle continua
        // sobrescrevendo a preferencia do usuario.
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(!localStorage.getItem('yugo-theme')){var t='${effectiveTheme}';var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);}}catch(e){}})();`,
          }}
        />
      )}
      <aside className="scroll-themed sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-line bg-surface/70 px-4 py-6 backdrop-blur-md md:block">
        <Link
          href="/app"
          className="mb-8 block transition-opacity hover:opacity-80"
          aria-label="Voltar ao painel"
        >
          {companyLogo ? (
            <img src={companyLogo} alt="logo" className="h-8 w-auto object-contain" />
          ) : (
            <BrandLogo size="md" />
          )}
        </Link>
        <SidebarCountsProvider>
        <nav className="space-y-1 text-sm">
          <SidebarLink href="/app">Painel</SidebarLink>

          {/* categorias recolhíveis: só itens liberados; bloqueados vão pra
              seção "não liberados" abaixo. Operação só com contexto de empresa. */}
          {visibleCats.map((cat) => {
            const avail = availItems(cat.items);
            if (avail.length === 0) return null;
            return (
              <SidebarSection key={cat.title} title={cat.title} hrefs={avail.map((i) => i.href)}>
                {avail.map((it) => (
                  <SidebarLink key={it.href} href={it.href}>{it.label}</SidebarLink>
                ))}
              </SidebarSection>
            );
          })}

          {/* módulos não liberados (cadeado) — seção recolhida, leva pra venda */}
          <LockedModules items={lockedList} />

          {shortcuts.length > 0 && (
            <>
              <p className="mt-4 px-3 text-[10px] uppercase tracking-wider text-muted">Atalhos</p>
              {shortcuts.map((s) => (
                <a
                  key={s.provider}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-fg transition hover:bg-line"
                >
                  <span className="truncate">{s.label}</span>
                  <span aria-hidden className="ml-2 shrink-0 text-xs text-muted">↗</span>
                </a>
              ))}
            </>
          )}

          <div className="my-4 border-t border-line" />
          <SidebarLink href="/app/suporte">Suporte</SidebarLink>
          {/* 2FA é um recurso de usuário da empresa; o master tem seu próprio
              fluxo (não usar a página de perfil do usuário, que exige session.user
              e jogava o master pro login). */}
          {session.user && (
            <>
              <div className="my-4 border-t border-line" />
              <SidebarLink href="/app/perfil/seguranca">
                Minha segurança (2FA)
              </SidebarLink>
            </>
          )}
          {isMaster && (
            <>
              <div className="my-4 border-t border-line" />
              <p className="px-3 text-[10px] uppercase tracking-wider text-muted">
                Master
              </p>
              <SidebarLink href="/app/platform">Visão geral</SidebarLink>
              <SidebarLink href="/app/platform/organizations">
                Organizações
              </SidebarLink>
              <SidebarLink href="/app/platform/contatos">
                Leads do site
              </SidebarLink>
              <SidebarLink href="/app/platform/suporte">
                Suporte (chamados)
              </SidebarLink>
              <MasterViewCompany />
              {isPlatformOwner && (
                <>
                  <SidebarLink href="/app/platform/settings">
                    Identidade & Branding
                  </SidebarLink>
                  <SidebarLink href="/app/platform/plans">
                    Planos
                  </SidebarLink>
                  <SidebarLink href="/app/platform/niches">
                    Nichos de mercado
                  </SidebarLink>
                  <SidebarLink href="/app/platform/modulos">
                    Preços de módulos
                  </SidebarLink>
                  <SidebarLink href="/app/platform/financeiro">
                    Financeiro (assinaturas)
                  </SidebarLink>
                  <SidebarLink href="/app/platform/ia">
                    Aprendizado de IA
                  </SidebarLink>
                  <SidebarLink href="/app/platform/contratos">
                    Contratos (empresas)
                  </SidebarLink>
                  <SidebarLink href="/app/platform/integrations">
                    Integrações
                  </SidebarLink>
                  <SidebarLink href="/app/platform/fiscal-ref">
                    Tabelas fiscais (NCM/CEST)
                  </SidebarLink>
                  <SidebarLink href="/app/platform/credentials">
                    🔒 Credenciais
                  </SidebarLink>
                  <SidebarLink href="/app/platform/team">
                    Equipe master
                  </SidebarLink>
                  <SidebarLink href="/app/platform/audit">
                    Auditoria
                  </SidebarLink>
                </>
              )}
              <SidebarLink href="/app/platform/grants">
                Acessos às Specs
              </SidebarLink>
            </>
          )}
        </nav>
        </SidebarCountsProvider>

        <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            tema
          </span>
          <ThemeToggle />
        </div>

        <div className="mt-4 border-t border-line pt-4 text-xs text-muted">
          <p className="truncate">
            {isMaster ? "MASTER • " : ""}
            {session.user?.role ?? (isMaster ? "platform-admin" : "")}
          </p>
          {session.user && (
            <a href="/app/conta" className="mt-2 block text-brand hover:underline">Minha conta (trocar senha)</a>
          )}
          <LogoutButton isMaster={isMaster} className="mt-2" />
        </div>
      </aside>

      <main className="mx-auto w-full max-w-[1320px] flex-1 px-6 py-8 md:px-10">
        <DialogProvider>
          {session.impersonating && <ImpersonationBanner orgName={session.impersonating.orgName} />}
          {cancelPhase === "grace" && (
            <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
              Assinatura cancelada. Você continua com acesso completo até <strong>{cancelUntil}</strong>. <a href="/app/billing" className="underline">Reativar assinatura</a>.
            </div>
          )}
          {cancelPhase === "readonly" && (
            <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
              <strong>Modo somente-leitura.</strong> Sua assinatura foi cancelada — você pode consultar seus dados até <strong>{cancelUntil}</strong>, mas não movimentar (vendas, pedidos, estoque). <a href="/app/billing" className="underline">Reativar assinatura</a>.
            </div>
          )}
          <InternalAlerts />
          <RouteFade>{children}</RouteFade>
        </DialogProvider>
      </main>

      {/* marca d'agua do dono do SaaS (canto inferior direito, dark/white) */}
      <SaasWatermark />

      {chatwootCfg && (
        <ChatwootWidget
          baseUrl={chatwootCfg.baseUrl}
          websiteToken={chatwootCfg.websiteToken}
          user={{
            identifier: session.master?.id ?? session.user?.id,
            email: undefined,
            name: isMaster ? "Master" : (session.user?.role ?? ""),
          }}
        />
      )}
    </div>
    </SoftphoneProvider>
    </LoadingProvider>
  );
}
