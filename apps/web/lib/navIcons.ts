import {
  Activity, AlertCircle, Archive, ArrowLeftRight, BadgePercent, BarChart3, Banknote,
  Blocks, BookOpen, Boxes, Brain, Briefcase, Building2, CalendarDays, ChartPie,
  ClipboardList, Coins, Contact, CreditCard, Factory, FileSignature, FileSpreadsheet,
  FileText, Fingerprint, Gauge, Globe, Handshake, HeartHandshake, KeyRound, LayoutGrid,
  LifeBuoy, Lock, Mail, MessagesSquare, Package, Phone, PhoneCall, PiggyBank, Puzzle,
  Receipt, Scissors, ScrollText, Send, Settings, ShieldCheck, ShoppingCart, Sparkles,
  Store, Tags, Target, Truck, UserCog, Users, Wallet, Webhook,
  type LucideIcon,
} from "lucide-react";

/**
 * ÍCONE DE CADA ITEM DO MENU
 * ============================================================================
 * O menu era 69 linhas de texto puro: todas com o mesmo peso, a mesma forma,
 * o mesmo tamanho. Encontrar "Cobrança" no meio de "Comissões", "Contratos" e
 * "Contas a pagar" virava leitura, não reconhecimento.
 *
 * O mapa é por ROTA (todo item tem uma) e não pela chave de módulo, que é
 * opcional. Rota desconhecida cai no `Blocks` — nunca fica sem ícone, nunca
 * quebra ao entrar uma tela nova.
 *
 * Os nomes vêm do `lucide-react`, que já é dependência do projeto e é
 * tree-shakeable: só os ícones listados aqui entram no bundle.
 */
const ICONS: Record<string, LucideIcon> = {
  "/app": Gauge,

  // ---------------------------------------------------------------- operação
  "/app/painel/otica": ChartPie,
  "/app/insights": Sparkles,
  "/app/agenda": CalendarDays,
  "/app/leads": Target,
  "/app/disparador": Send,
  "/app/vendas": ShoppingCart,
  "/app/caixa": Wallet,
  "/app/producao": Factory,
  "/app/producao/costureiras": Scissors,
  "/app/producao/import": FileSpreadsheet,
  "/app/atendimento": MessagesSquare,
  "/app/atendimento/macros": Blocks,
  "/app/atendimento/webhooks": Webhook,
  "/app/crm": HeartHandshake,
  "/app/prospector": Globe,
  "/app/voip": Phone,
  "/app/suporte-sistema": LifeBuoy,

  // --------------------------------------------------------------- comercial
  "/app/orcamentos": ClipboardList,
  "/app/clientes": Contact,
  "/app/chamados": AlertCircle,
  "/app/mala-direta": Mail,
  "/app/produtos": Package,
  "/app/catalogo": Store,
  "/app/comissoes": BadgePercent,
  "/app/pesquisas": Activity,

  // ------------------------------------------------------------------- ótica
  "/app/fornecedores": Truck,
  "/app/pedidos-lente": Boxes,
  "/app/repasses": Handshake,

  // -------------------------------------------------------------- financeiro
  "/app/crediario": CreditCard,
  "/app/pagamentos": Banknote,
  "/app/transacoes": ArrowLeftRight,
  "/app/cobranca": PiggyBank,
  "/app/relatorios": BarChart3,
  "/app/vendas-historico": Archive,
  "/app/financeiro/contas-a-pagar": Receipt,
  "/app/financeiro/contas-a-receber": Coins,
  "/app/fiscal": ScrollText,

  // --------------------------------------------------------------- documentos
  "/app/contratos": FileSignature,
  "/app/modelos": FileText,
  "/app/empresa-contrato": FileSignature,

  // ------------------------------------------------------------------ pessoas
  "/app/rh": Users,
  "/app/ponto": Fingerprint,

  // ------------------------------------------------------------- configuração
  "/app/lojas": Building2,
  "/app/usuarios": UserCog,
  "/app/permissoes": ShieldCheck,
  "/app/voip-admin": PhoneCall,
  "/app/portal-cliente": Globe,
  "/app/integracoes": Puzzle,
  "/app/billing": CreditCard,

  // -------------------------------------------------------------------- conta
  "/app/suporte": LifeBuoy,
  "/app/conta": UserCog,
  "/app/perfil/seguranca": KeyRound,

  // ------------------------------------------------------------------- master
  "/app/platform": LayoutGrid,
  "/app/platform/organizations": Building2,
  "/app/platform/contatos": Contact,
  "/app/platform/suporte": LifeBuoy,
  "/app/platform/settings": Settings,
  "/app/platform/plans": Tags,
  "/app/platform/niches": Briefcase,
  "/app/platform/modulos": Blocks,
  "/app/platform/financeiro": Banknote,
  "/app/platform/ia": Brain,
  "/app/platform/contratos": FileSignature,
  "/app/platform/integrations": Puzzle,
  "/app/platform/fiscal-ref": ScrollText,
  "/app/platform/credentials": Lock,
  "/app/platform/team": Users,
  "/app/platform/audit": BookOpen,
  "/app/platform/grants": KeyRound,
};

/** Ícone da rota; `Blocks` para o que ainda não estiver no mapa. */
export function iconForHref(href: string): LucideIcon {
  return ICONS[href] ?? Blocks;
}
