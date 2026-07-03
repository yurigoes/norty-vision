import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class PlatformContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
  }
  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ============================== TEMPLATES (master) ==============================
  async listTemplates(ctx: RequestContext) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContractTemplate.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
    );
  }

  async createTemplate(ctx: RequestContext, input: { version: string; title: string; description?: string | null; bodyMarkdown: string; kind?: string; isActive?: boolean }) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContractTemplate.create({
        data: {
          version: input.version, title: input.title, description: input.description ?? null,
          bodyMarkdown: input.bodyMarkdown, kind: input.kind ?? "onboarding", isActive: input.isActive ?? true,
        },
      }),
    );
  }

  async updateTemplate(ctx: RequestContext, id: string, input: Partial<{ version: string; title: string; description: string | null; bodyMarkdown: string; kind: string; isActive: boolean }>) {
    this.requireMaster(ctx);
    const data: Record<string, unknown> = {};
    for (const k of ["version", "title", "description", "bodyMarkdown", "kind", "isActive"] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContractTemplate.update({ where: { id }, data }),
    );
  }

  // ============================== CONTRATOS (master) ==============================
  async listContracts(ctx: RequestContext, opts?: { organizationId?: string; status?: string }) {
    this.requireMaster(ctx);
    const items = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContract.findMany({
        where: { ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}), ...(opts?.status ? { status: opts.status } : {}) },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
    const orgIds = [...new Set(items.map((i) => i.organizationId))];
    const orgs = orgIds.length
      ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }))
      : [];
    const om = new Map(orgs.map((o) => [o.id, o.name]));
    return items.map((i) => ({ ...i, organizationName: om.get(i.organizationId) ?? "—" }));
  }

  /** Master envia um contrato (modelo) pra uma empresa → snapshot renderizado + hash.
   *  Para aditivo de módulo à la carte, informe `moduleKey`: preenche {{modulo.nome}}
   *  e {{modulo.preco}} a partir do preço cadastrado pelo master. */
  async assign(ctx: RequestContext, input: { organizationId: string; templateId: string; moduleKey?: string | null }) {
    this.requireMaster(ctx);
    const tpl = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContractTemplate.findFirst({ where: { id: input.templateId } }),
    );
    if (!tpl) throw new AppError(ErrorCode.NotFound, "Modelo não encontrado", 404);
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: input.organizationId }, select: { name: true, legalName: true, document: true, contactEmail: true, contactPhone: true } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Empresa não encontrada", 404);

    let extra: Record<string, string> | undefined;
    let title = tpl.title;
    if (input.moduleKey) {
      const price = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.modulePrice.findUnique({ where: { moduleKey: input.moduleKey! } }));
      const nome = MODULE_LABELS[input.moduleKey] ?? input.moduleKey;
      const preco = price && price.priceCents > 0 ? brlCents(price.priceCents) : "a combinar";
      extra = { "modulo.nome": nome, "modulo.preco": preco, "modulo.chave": input.moduleKey };
      title = `${tpl.title} — ${nome}`;
    }

    const bodyHtml = renderContractHtml(tpl.bodyMarkdown, org, extra);
    const bodyHash = sha256(bodyHtml);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContract.create({
        data: {
          organizationId: input.organizationId,
          templateId: tpl.id,
          version: tpl.version,
          title,
          bodyHtml,
          bodyHash,
          status: "pending",
        },
      }),
    );
  }

  /**
   * Gera automaticamente o ADITIVO do módulo à la carte pra empresa (chamado
   * pelo fluxo de compra quando o pagamento é aprovado). Best-effort: se não
   * houver modelo ativo de aditivo, ou já existir um aditivo deste módulo, não
   * faz nada. Sem ctx de master — é chamada interna do sistema.
   */
  async autoAssignModuleAddendum(organizationId: string, moduleKey: string): Promise<void> {
    const tpl = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContractTemplate.findFirst({ where: { kind: "aditivo_modulo", isActive: true }, orderBy: { createdAt: "desc" } }),
    );
    if (!tpl) return;
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: organizationId }, select: { name: true, legalName: true, document: true, contactEmail: true, contactPhone: true } }),
    );
    if (!org) return;
    const nome = MODULE_LABELS[moduleKey] ?? moduleKey;
    const title = `${tpl.title} — ${nome}`;
    const dup = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContract.findFirst({ where: { organizationId, title, status: { in: ["pending", "accepted"] } }, select: { id: true } }),
    );
    if (dup) return;
    const price = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.modulePrice.findUnique({ where: { moduleKey } }));
    const preco = price && price.priceCents > 0 ? brlCents(price.priceCents) : "a combinar";
    const bodyHtml = renderContractHtml(tpl.bodyMarkdown, org, { "modulo.nome": nome, "modulo.preco": preco, "modulo.chave": moduleKey });
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContract.create({
        data: { organizationId, templateId: tpl.id, version: tpl.version, title, bodyHtml, bodyHash: sha256(bodyHtml), status: "pending" },
      }),
    );
  }

  async cancel(ctx: RequestContext, id: string) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformContract.update({ where: { id }, data: { status: "canceled" } }),
    );
  }

  // ============================== EMPRESA (org admin) ==============================
  /** Contratos da empresa atual: pendentes + aceitos. */
  async forOrg(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.platformContract.findMany({ where: { organizationId: ctx.orgId!, status: { in: ["pending", "accepted"] } }, orderBy: { createdAt: "desc" } }),
    );
  }

  /** HTML do contrato (snapshot) com selo. Master ou a própria empresa. */
  async html(ctx: RequestContext, id: string): Promise<string> {
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformContract.findFirst({ where: { id } }));
    if (!c) throw new AppError(ErrorCode.NotFound, "Contrato não encontrado", 404);
    return wrapContractDocument(c);
  }

  /** Empresa aceita (clickwrap): registra IP, UA, nome/doc, timestamp. */
  async accept(ctx: RequestContext, id: string, input: { name: string; doc?: string | null }, ip?: string | null, ua?: string | null) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin da empresa", 403);
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.platformContract.findFirst({ where: { id, organizationId: ctx.orgId! } }));
    if (!c) throw new AppError(ErrorCode.NotFound, "Contrato não encontrado", 404);
    if (c.status === "accepted") throw new AppError(ErrorCode.Conflict, "Contrato já aceito", 409);
    if (c.status === "canceled") throw new AppError(ErrorCode.Forbidden, "Contrato cancelado", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.platformContract.update({
        where: { id },
        data: {
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: ctx.userId ?? null,
          acceptedByName: input.name,
          acceptedByDoc: input.doc ?? null,
          signerIp: ip ?? null,
          signerUserAgent: ua ?? null,
        },
      }),
    );
  }
}

// ============================== render helpers ==============================
// rótulos dos módulos (espelha apps/web/lib/modules.ts) p/ o aditivo à la carte
const MODULE_LABELS: Record<string, string> = {
  agenda: "Agenda", leads: "Leads", disparador: "Disparador", vendas: "Vendas (PDV)",
  caixa: "Caixa", producao: "Produção / Pedidos", orcamentos: "Orçamentos", clientes: "Clientes",
  atendimento: "Call Center / Atendimento (IA)", chamados: "Chamados / Ordens de serviço",
  mala_direta: "Mala direta", produtos: "Produtos", catalogo: "Catálogo online", comissoes: "Comissões",
  pesquisas: "Pesquisas (NPS)", fornecedores: "Fornecedores", pedidos_lente: "Pedidos de lente",
  repasses: "Repasses", crediario: "Crediário", pagamentos: "Pagamentos", cobranca: "Cobrança",
  relatorios: "Relatórios", contratos: "Contratos", modelos: "Mensagens", rh: "RH & Funcionários",
};
function brlCents(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDoc(doc?: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return doc ?? "—";
}

/** Substitui {{contratante.*}} e converte markdown simples → HTML. */
function renderContractHtml(
  md: string,
  org: { name: string; legalName: string | null; document: string | null; contactEmail: string | null; contactPhone: string | null },
  extra?: Record<string, string>,
): string {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const map: Record<string, string> = {
    "contratante.razao_social": org.legalName ?? org.name,
    "contratante.nome_fantasia": org.name,
    "contratante.cnpj": fmtDoc(org.document),
    "contratante.email": org.contactEmail ?? "—",
    "contratante.telefone": org.contactPhone ?? "—",
    "data.hoje": hoje,
    // aliases curtos
    "razao_social": org.legalName ?? org.name,
    "nome_fantasia": org.name,
    "cnpj": fmtDoc(org.document),
    ...(extra ?? {}),
  };
  let body = md;
  for (const [k, v] of Object.entries(map)) {
    body = body.replace(new RegExp(`\\{\\{\\s*${k.replace(/\./g, "\\.")}\\s*\\}\\}`, "g"), v);
  }
  return markdownToHtml(body);
}

/** Remove o perigoso (script/style/iframe/handlers/js:) deixando o layout passar. */
function sanitizeHtml(s: string): string {
  // mantém <style> (o autor pode trazer @media print/@page/.no-break no modelo);
  // remove apenas o que é vetor de XSS/execução.
  return String(s ?? "")
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/** Aceita HTML (sanitizado) E Markdown: linhas HTML passam direto; o resto vira título/negrito/lista. */
function markdownToHtml(md: string): string {
  const src = sanitizeHtml(md);
  // HTML autoral (traz <style>, tabelas, blocos de layout, tags multi-linha como
  // <img ...>) NÃO pode ser processado linha-a-linha — quebraria o CSS e os
  // atributos das tags. Passa o HTML já sanitizado direto.
  if (/<\s*(style|table|img|!doctype|html|head|body|section|article|main|div)\b/i.test(src)) {
    return src;
  }
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  const inline = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  const looksHtml = (l: string) => /^<\/?[a-zA-Z]/.test(l.trim());
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (looksHtml(line)) { closeList(); out.push(line); }
    else if (/^#{1,6}\s+/.test(line)) { closeList(); const lvl = line.match(/^#+/)![0].length; out.push(`<h${lvl}>${inline(line.replace(/^#{1,6}\s+/, ""))}</h${lvl}>`); }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join("\n");
}

function wrapContractDocument(c: any): string {
  const color = "#7c3aed";
  const seal = c.status === "accepted"
    ? `<div class="seal">
        <div class="seal-badge">✓ ACEITO DIGITALMENTE</div>
        <div class="seal-info">
          ${c.acceptedAt ? `<p>Data/hora: <strong>${new Date(c.acceptedAt).toLocaleString("pt-BR")}</strong></p>` : ""}
          ${c.acceptedByName ? `<p>Assinante: <strong>${esc(c.acceptedByName)}</strong>${c.acceptedByDoc ? ` · ${esc(c.acceptedByDoc)}` : ""}</p>` : ""}
          <p>Código de verificação: <strong>${esc(String(c.bodyHash ?? "").slice(0, 16).toUpperCase())}</strong></p>
          ${c.signerIp ? `<p>IP de origem: <strong>${esc(c.signerIp)}</strong></p>` : ""}
          <p class="seal-legal">Aceite eletrônico (clickwrap) com validade legal (Lei 14.063/2020 / MP 2.200-2/2001).</p>
        </div>
      </div>`
    : `<p class="pending">Contrato pendente de aceite.</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${esc(c.title ?? "Contrato")}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.6;margin:0;background:#f5f5f5}
  .page{max-width:760px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  h1,h2,h3{color:${color};font-family:Arial,sans-serif}
  h1{font-size:20px}h2{font-size:16px}
  .meta{font-family:Arial,sans-serif;font-size:12px;color:#666;border-bottom:2px solid ${color};padding-bottom:8px;margin-bottom:16px}
  .seal{font-family:Arial,sans-serif;margin-top:40px;border:2px dashed ${color};border-radius:12px;padding:14px 18px;background:rgba(124,58,237,.04)}
  .seal-badge{display:inline-block;font-size:12px;font-weight:700;color:#fff;background:${color};padding:4px 12px;border-radius:999px}
  .seal-info{margin-top:8px;font-size:12px;color:#444}.seal-info p{margin:2px 0}.seal-legal{font-style:italic;color:#777}
  .pending{font-family:Arial,sans-serif;color:#b45309;margin-top:32px}
  .toolbar{font-family:Arial,sans-serif;text-align:center;padding:12px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <p class="meta">${esc(c.title ?? "Contrato")}${c.version ? ` · v${esc(c.version)}` : ""}</p>
    <article>${c.bodyHtml ?? ""}</article>
    ${seal}
  </div>
</body></html>`;
}
