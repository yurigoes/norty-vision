import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";

type Category = "info" | "low" | "warning" | "critical";

interface UpsertTemplateInput {
  channel: "email" | "whatsapp";
  code: string;
  name: string;
  category?: Category;
  subject?: string | null;
  body: string;
  isActive?: boolean;
}

/** Cor do branding do email por tipo/urgencia. */
const CATEGORY = {
  info:     { color: "#2563eb", label: "Informação" },
  low:      { color: "#0d9488", label: "Não urgente" },
  warning:  { color: "#f59e0b", label: "Urgente" },
  critical: { color: "#dc2626", label: "Crítico / Inadimplente" },
} as const;

/** Variaveis de sistema chaveaveis (puxam dados reais no envio). */
const VARIABLE_CATALOG: Array<{ group: string; items: Array<{ key: string; label: string }> }> = [
  {
    group: "Empresa",
    items: [
      { key: "empresa.nome", label: "Nome da empresa" },
      { key: "empresa.documento", label: "CNPJ/CPF" },
      { key: "empresa.telefone", label: "Telefone" },
      { key: "empresa.email", label: "E-mail" },
      { key: "loja.nome", label: "Loja" },
    ],
  },
  {
    group: "Cliente",
    items: [
      { key: "cliente.nome", label: "Nome do cliente" },
      { key: "cliente.cpf", label: "CPF" },
      { key: "cliente.telefone", label: "Telefone" },
      { key: "cliente.email", label: "E-mail" },
      { key: "cliente.nascimento", label: "Nascimento" },
    ],
  },
  {
    group: "Crediário",
    items: [
      { key: "crediario.parcela", label: "Parcela (ex.: 2/12)" },
      { key: "crediario.valor", label: "Valor da parcela" },
      { key: "crediario.vencimento", label: "Vencimento" },
      { key: "crediario.total", label: "Total da compra" },
      { key: "link.pagamento", label: "Link de pagamento" },
      { key: "link.portal", label: "Link do portal" },
    ],
  },
];

interface SmtpInput {
  host?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
  password?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  enabled?: boolean;
}

/** Variaveis de exemplo pra testar/pre-visualizar modelos sem dados reais. */
const SAMPLE_VARS: Record<string, string> = {
  "empresa.nome": "Sua Empresa",
  "empresa.documento": "12.345.678/0001-90",
  "empresa.telefone": "(11) 99999-8888",
  "empresa.email": "contato@suaempresa.com",
  "loja.nome": "Loja Centro",
  "cliente.nome": "Maria Souza",
  "cliente.cpf": "123.456.789-09",
  "cliente.telefone": "(11) 98888-7777",
  "cliente.email": "maria@email.com",
  "cliente.nascimento": "10/05/1990",
  "crediario.parcela": "2/12",
  "crediario.valor": "R$ 150,00",
  "crediario.vencimento": "10/06/2026",
  "crediario.total": "R$ 1.800,00",
  "link.pagamento": "https://exemplo.com/pagar",
  "link.portal": "https://exemplo.com/c",
  // aliases curtos (compat com modelos antigos)
  nome: "Maria Souza",
  valor: "R$ 150,00",
  vencimento: "10/06/2026",
  parcela: "2/12",
  empresa: "Sua Empresa",
  loja: "Loja Centro",
};

/** Modelos automáticos disponíveis para personalização (aba Mensagens → "Modelos do sistema"). */
const SYSTEM_TEMPLATES: Array<{ code: string; name: string; group: string; channels: ("email" | "whatsapp")[]; category: Category; description: string; variables: string[]; subject?: string; body: string }> = [
  // ---- RH / Ponto ----
  { code: "ponto_justificativa_decisao", name: "Ponto — decisão da justificativa", group: "RH / Ponto", channels: ["whatsapp", "email"], category: "info", description: "Enviado ao funcionário quando o gestor aprova/recusa uma justificativa ou correção de ponto.", variables: ["funcionario.nome", "funcionario.primeiro_nome", "dia", "status", "observacao"], subject: "Solicitação de ponto {{status}} — {{dia}}", body: "Olá {{funcionario.primeiro_nome}}, sua solicitação de ponto de {{dia}} foi {{status}}.\n{{observacao}}" },
  { code: "ponto_falta_marcacao", name: "Ponto — não registrou marcação", group: "RH / Ponto", channels: ["whatsapp", "email"], category: "warning", description: "Aviso automático ao funcionário que não bateu a entrada ou esqueceu a saída.", variables: ["funcionario.nome", "funcionario.primeiro_nome", "tipo"], subject: "Aviso de ponto", body: "Olá {{funcionario.primeiro_nome}}, notamos que você ainda não registrou a {{tipo}} de hoje. Se já trabalhou, registre o ponto ou abra uma justificativa no portal." },
  { code: "ponto_resumo_gestor", name: "Ponto — resumo diário ao gestor", group: "RH / Ponto", channels: ["whatsapp", "email"], category: "info", description: "Resumo diário de divergências enviado ao gestor.", variables: ["data", "faltas", "atrasos", "incompletas", "empresa"], subject: "Resumo do ponto — {{data}}", body: "Resumo do ponto de hoje ({{data}}) — {{empresa}}:\n• Faltas: {{faltas}}\n• Atrasos: {{atrasos}}\n• Marcações incompletas: {{incompletas}}" },
  { code: "employee_credentials", name: "RH — credenciais de acesso", group: "RH / Ponto", channels: ["whatsapp", "email"], category: "info", description: "Envio do login/senha provisória do portal do funcionário.", variables: ["funcionario.nome", "login", "senha", "link"], subject: "Seu acesso ao portal do funcionário", body: "Olá {{funcionario.nome}}! Seu acesso ao portal:\nLogin: {{login}}\nSenha provisória: {{senha}}\nAcesse: {{link}}" },
  // ---- Financeiro ----
  { code: "payables_reminder", name: "Financeiro — contas a pagar", group: "Financeiro", channels: ["whatsapp", "email"], category: "warning", description: "Resumo diário de contas a vencer/vencidas enviado aos responsáveis.", variables: ["empresa.nome"], subject: "Contas a pagar — {{empresa.nome}}", body: "Resumo das contas a pagar de {{empresa.nome}}: confira vencimentos próximos e em atraso no painel." },
  // ---- Cobrança / crediário ----
  { code: "dunning", name: "Cobrança — aviso de parcela", group: "Cobrança", channels: ["whatsapp", "email"], category: "warning", description: "Aviso de cobrança da parcela em aberto.", variables: ["cliente.nome", "crediario.valor", "crediario.vencimento", "link.pagamento"], subject: "Parcela em aberto", body: "Olá {{cliente.nome}}, sua parcela de {{crediario.valor}} vence em {{crediario.vencimento}}. Pague aqui: {{link.pagamento}}" },
  { code: "credit_payment", name: "Crediário — pagamento confirmado", group: "Cobrança", channels: ["whatsapp", "email"], category: "low", description: "Confirmação de pagamento de parcela.", variables: ["cliente.nome", "crediario.valor", "crediario.parcela"], subject: "Pagamento confirmado", body: "Olá {{cliente.nome}}, recebemos o pagamento de {{crediario.valor}} (parcela {{crediario.parcela}}). Obrigado!" },
  // ---- Agenda ----
  { code: "agenda_proxima_data", name: "Agenda — lembrete de atendimento", group: "Agenda", channels: ["whatsapp", "email"], category: "info", description: "Lembrete do próximo atendimento agendado.", variables: ["cliente.nome", "link.portal"], subject: "Lembrete do seu atendimento", body: "Olá {{cliente.nome}}, este é um lembrete do seu atendimento. Detalhes/confirmação: {{link.portal}}" },
  { code: "pesquisa_satisfacao", name: "Pesquisa de satisfação", group: "Atendimento", channels: ["whatsapp", "email"], category: "low", description: "Pesquisa NPS enviada ao fim do atendimento.", variables: ["cliente.nome", "link.portal"], subject: "Como foi seu atendimento?", body: "Olá {{cliente.nome}}, conta pra gente como foi seu atendimento? {{link.portal}}" },
];

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireOrg(ctx: RequestContext): string {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId;
  }

  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
  }

  // ============================ TEMPLATES ============================

  async listTemplates(ctx: RequestContext) {
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.messageTemplate.findMany({
        where: { organizationId: orgId },
        orderBy: [{ channel: "asc" }, { name: "asc" }],
      }),
    );
  }

  async upsertTemplate(ctx: RequestContext, input: UpsertTemplateInput) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const code = input.code
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.messageTemplate.upsert({
        where: {
          organizationId_channel_code: { organizationId: orgId, channel: input.channel, code },
        },
        update: {
          name: input.name,
          category: input.category ?? "info",
          subject: input.subject ?? null,
          body: input.body,
          isActive: input.isActive ?? true,
        },
        create: {
          organizationId: orgId,
          channel: input.channel,
          code,
          name: input.name,
          category: input.category ?? "info",
          subject: input.subject ?? null,
          body: input.body,
          isActive: input.isActive ?? true,
        },
      }),
    );
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const t = await tx.messageTemplate.findUnique({ where: { id } });
      if (!t) throw new AppError(ErrorCode.NotFound, "Modelo nao encontrado", 404);
      if (!ctx.isPlatformAdmin && t.organizationId !== ctx.orgId) {
        throw new AppError(ErrorCode.Forbidden, "Fora da sua org", 403);
      }
      await tx.messageTemplate.delete({ where: { id } });
      return { ok: true };
    });
  }

  // ============================== SMTP ==============================

  /** Versao segura (sem senha) pra exibir. */
  async getSmtp(ctx: RequestContext) {
    const orgId = this.requireOrg(ctx);
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organizationSmtpSettings.findUnique({ where: { organizationId: orgId } }),
    );
    if (!s) return null;
    return {
      host: s.host,
      port: s.port,
      secure: s.secure,
      username: s.username,
      hasPassword: !!s.password,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      replyTo: s.replyTo,
      enabled: s.enabled,
    };
  }

  async upsertSmtp(ctx: RequestContext, input: SmtpInput) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const data: Record<string, unknown> = {};
    for (const k of [
      "host", "port", "secure", "username", "fromName", "fromEmail", "replyTo", "enabled",
    ] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    // so atualiza senha se vier preenchida (mantem a existente caso vazia)
    if (input.password !== undefined && input.password !== null && input.password !== "") {
      data.password = input.password;
    }
    // se o host foi informado e o admin nao marcou explicitamente enabled,
    // habilita automaticamente (cadastrar SMTP = querer usar) — corrige o caso
    // do email nao disparar mesmo com SMTP "cadastrado".
    if (input.enabled === undefined && input.host) {
      data.enabled = true;
    }
    const enabledCreate = input.enabled ?? (input.host ? true : false);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organizationSmtpSettings.upsert({
        where: { organizationId: orgId },
        update: data,
        create: {
          organizationId: orgId,
          host: input.host ?? null,
          port: input.port ?? 587,
          secure: input.secure ?? false,
          username: input.username ?? null,
          password: input.password ?? null,
          fromName: input.fromName ?? null,
          fromEmail: input.fromEmail ?? null,
          replyTo: input.replyTo ?? null,
          enabled: enabledCreate,
        },
      }),
    ).then(() => this.getSmtp(ctx));
  }

  // ============================== TESTE ==============================

  /** Renderiza {{chave}} (aceita pontos: empresa.nome) com as variaveis dadas. */
  render(body: string, vars?: Record<string, unknown>): string {
    const v = { ...SAMPLE_VARS, ...(vars ?? {}) };
    return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, k) =>
      v[k] !== undefined && v[k] !== null ? String(v[k]) : `{{${k}}}`,
    );
  }

  /** Catalogo de variaveis chaveaveis pra UI. */
  variablesCatalog() {
    return VARIABLE_CATALOG;
  }

  /** Catálogo dos modelos AUTOMÁTICOS do sistema (mensagens disparadas sozinhas).
   *  A empresa pode "Personalizar" cada um — vira um MessageTemplate editável (override).
   *  Enquanto não personalizar, o sistema usa o texto padrão embutido no código. */
  systemTemplatesCatalog() {
    return SYSTEM_TEMPLATES;
  }

  /** Branding da empresa (logo + nome) pro wrapper do email. */
  private async orgBrand(ctx: RequestContext) {
    const orgId = this.requireOrg(ctx);
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({
        where: { id: orgId },
        select: { name: true, logoUrl: true },
      }),
    );
    return { name: org?.name ?? "Empresa", logoUrl: org?.logoUrl ?? null };
  }

  /** Monta o HTML do email com branding da empresa + cor do tipo/urgencia. */
  buildEmailHtml(opts: {
    bodyHtml: string;
    category: Category;
    brandName: string;
    logoUrl: string | null;
  }): string {
    const c = CATEGORY[opts.category] ?? CATEGORY.info;
    const header = opts.logoUrl
      ? `<img src="${opts.logoUrl}" alt="" style="max-height:44px;max-width:200px;object-fit:contain"/>`
      : `<span style="font-size:18px;font-weight:700;color:#fff">${escapeHtml(opts.brandName)}</span>`;
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.08)">
    <div style="background:${c.color};padding:18px 24px;text-align:left">
      ${header}
      <div style="color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.9;margin-top:6px">${c.label}</div>
    </div>
    <div style="padding:28px 24px;line-height:1.6;font-size:15px">${opts.bodyHtml}</div>
    <div style="border-top:1px solid #e5e7eb;padding:14px 24px;font-size:11px;color:#9ca3af">${escapeHtml(opts.brandName)}</div>
  </div>
</body></html>`;
  }

  /** Pre-visualizacao HTML do email (com variaveis de exemplo). */
  async previewEmail(
    ctx: RequestContext,
    opts: { templateId?: string; subject?: string; body?: string; category?: Category },
  ) {
    let subject = opts.subject ?? "Assunto do email";
    let body = opts.body ?? "";
    let category: Category = opts.category ?? "info";
    if (opts.templateId) {
      const t = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.messageTemplate.findUnique({ where: { id: opts.templateId } }),
      );
      if (!t) throw new AppError(ErrorCode.NotFound, "Modelo nao encontrado", 404);
      subject = t.subject ?? t.name;
      body = t.body;
      category = (t.category as Category) ?? "info";
    }
    const brand = await this.orgBrand(ctx);
    const bodyHtml = this.render(escapeHtml(body)).replace(/\n/g, "<br/>");
    const html = this.buildEmailHtml({
      bodyHtml,
      category,
      brandName: brand.name,
      logoUrl: brand.logoUrl,
    });
    return { subject: this.render(subject), html };
  }

  async testEmail(ctx: RequestContext, opts: { to: string; templateId?: string }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    let subject = "Teste de email — yugochat";
    let body = "Este é um email de teste do seu sistema. Se você recebeu, o SMTP está funcionando.";
    let category: Category = "info";
    if (opts.templateId) {
      const t = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.messageTemplate.findUnique({ where: { id: opts.templateId } }),
      );
      if (!t) throw new AppError(ErrorCode.NotFound, "Modelo nao encontrado", 404);
      subject = t.subject ? this.render(t.subject) : t.name;
      body = t.body;
      category = (t.category as Category) ?? "info";
    }
    const brand = await this.orgBrand(ctx);
    const html = this.buildEmailHtml({
      bodyHtml: this.render(escapeHtml(body)).replace(/\n/g, "<br/>"),
      category,
      brandName: brand.name,
      logoUrl: brand.logoUrl,
    });
    const r = await this.email.sendForOrg(orgId, {
      to: opts.to,
      subject: this.render(subject),
      html,
      text: this.render(body),
    });
    return { ok: true, source: r.source };
  }

  async testWhatsapp(ctx: RequestContext, opts: { to: string; templateId?: string }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    let body = "Mensagem de teste do seu sistema. ✅";
    if (opts.templateId) {
      const t = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.messageTemplate.findUnique({ where: { id: opts.templateId } }),
      );
      if (!t) throw new AppError(ErrorCode.NotFound, "Modelo nao encontrado", 404);
      body = this.render(t.body);
    }
    // precisa de uma loja com instancia Evolution
    const store = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findFirst({
        where: { organizationId: orgId, status: "active", deletedAt: null },
        select: { id: true },
      }),
    );
    if (!store) throw new AppError(ErrorCode.ValidationFailed, "Crie uma loja primeiro", 400);
    const r = await this.notifications.notify({
      organizationId: orgId,
      storeId: store.id,
      whatsappPhone: opts.to,
      subject: "Teste",
      text: body,
      templateCode: "teste",
    });
    if (!r.whatsapp) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Falha no envio (verifique a instancia WhatsApp da loja)",
        400,
      );
    }
    return { ok: true };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
