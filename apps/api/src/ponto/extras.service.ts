import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EmployerService } from "./employer.service";
import { ctxCan } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Extras/diaristas: funcionário escalado avulso pra um dia específico, fora
 * da escala oficial (ex.: está de folga na escala normal, mas vai trabalhar
 * de extra e receber em dinheiro no mesmo dia). O recibo (2 vias, A4) é
 * gerado NA HORA em que o DP escala + define o valor - antes do dia
 * trabalhado - pra já descer impresso pro supervisor guardar. No dia, a
 * batida do funcionário cai em PontoExtraPunch (nunca em PontoPunch/AFD).
 * Depois, com o papel assinado em mãos, o DP fecha o status final de cada
 * escalação: pago / trabalhou mas não recebeu ainda / não compareceu.
 */
@Injectable()
export class ExtrasService {
  private readonly logger = new Logger("PontoExtras");
  constructor(private readonly prisma: PrismaService, private readonly employer: EmployerService) {}

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin }; }
  /**
   * Porteiro deste service. No RH era `isOrgAdmin` cru — tela aberta por
   * permissão respondia 403, vazia. Piso `ponto.adjust` (escalar alguém num
   * extra muda o que ela deve trabalhar); as LEITURAS passam `ponto.view`, e
   * CONFIRMAR O PAGAMENTO passa `ponto.close` — ali sai dinheiro, e é a mesma
   * barra do fechamento de folha.
   */
  private requireAdmin(ctx: RequestContext, chave: string = "ponto.adjust") {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctxCan(ctx, chave)) throw new AppError(ErrorCode.Forbidden, `Seu perfil nao tem a permissao: ${chave}`, 403);
  }
  private fmtCnpj(d: string) { const s = (d || "").replace(/\D/g, ""); return s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : d; }

  /** Cria as escalações de extra em lote (mesmo valor pra todos, ou um valor
   *  por funcionário) e já devolve o PDF do recibo (2 vias por pessoa). */
  async create(ctx: RequestContext, input: { workDate: string; storeId?: string | null; note?: string | null; items: Array<{ employeeId: string; valueCents: number }> }): Promise<{ buffer: Buffer; filename: string; created: number; skipped: string[] }> {
    this.requireAdmin(ctx);
    const day = new Date(`${input.workDate}T00:00:00.000Z`);
    if (isNaN(day.getTime())) throw new AppError(ErrorCode.ValidationFailed, "Data inválida", 400);
    if (!input.items?.length) throw new AppError(ErrorCode.ValidationFailed, "Selecione ao menos um funcionário", 400);

    const empIds = input.items.map((i) => i.employeeId);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, cpf: true, employerId: true } }));
    const empMap = new Map(emps.map((e) => [e.id, e] as const));

    const skipped: string[] = [];
    const rows: Array<{ employeeId: string; valueCents: number; name: string; cpf: string | null; employerId: string | null }> = [];
    for (const it of input.items) {
      const emp = empMap.get(it.employeeId);
      if (!emp) { skipped.push(it.employeeId); continue; }
      rows.push({ employeeId: it.employeeId, valueCents: Math.max(0, Math.round(it.valueCents || 0)), name: emp.name, cpf: emp.cpf, employerId: emp.employerId ?? null });
    }

    const now = new Date();
    const shiftIds: string[] = [];
    for (const r of rows) {
      const shift = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoExtraShift.upsert({
        where: { organizationId_pontoEmployeeId_workDate: { organizationId: ctx.orgId!, pontoEmployeeId: r.employeeId, workDate: day as any } },
        create: { organizationId: ctx.orgId!, pontoEmployeeId: r.employeeId, storeId: input.storeId || null, workDate: day as any, dailyValueCents: BigInt(r.valueCents), note: input.note || null, status: "escalado", documentGeneratedAt: now, createdBy: ctx.userId ?? null },
        update: { storeId: input.storeId || null, dailyValueCents: BigInt(r.valueCents), note: input.note || null, documentGeneratedAt: now },
      }));
      shiftIds.push(shift.id);
    }

    // cada funcionário pode ter um empregador diferente — resolve a marca POR
    // EMPREGADOR (cacheado), não uma vez só pro lote inteiro.
    const brandCache = new Map<string, Awaited<ReturnType<ExtrasService["brand"]>>>();
    const brandFor = async (employerId: string | null) => {
      const key = employerId ?? "__default__";
      if (!brandCache.has(key)) brandCache.set(key, await this.brand(ctx, employerId));
      return brandCache.get(key)!;
    };
    const rowsWithBrand = await Promise.all(rows.map(async (r) => ({ name: r.name, cpf: r.cpf, valueCents: r.valueCents, workDate: day, brand: await brandFor(r.employerId) })));
    const buffer = await this.renderReceipts(rowsWithBrand);
    return { buffer, filename: `extra-${input.workDate}.pdf`, created: rows.length, skipped };
  }

  /** Lista pro painel do DP, já separada nas 4 categorias (escalado/pago/nao_pago/nao_compareceu). */
  async list(ctx: RequestContext, filters: { from?: string; to?: string }) {
    this.requireAdmin(ctx, "ponto.view");
    const where: any = { organizationId: ctx.orgId! };
    if (filters.from || filters.to) {
      where.workDate = {};
      if (filters.from) where.workDate.gte = new Date(`${filters.from}T00:00:00.000Z`);
      if (filters.to) where.workDate.lte = new Date(`${filters.to}T23:59:59.999Z`);
    }
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoExtraShift.findMany({ where, orderBy: { workDate: "desc" } }));
    const empIds = [...new Set(rows.map((r) => r.pontoEmployeeId))];
    const emps = empIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name] as const));
    const shiftIds = rows.map((r) => r.id);
    const punches = shiftIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoExtraPunch.findMany({ where: { extraShiftId: { in: shiftIds } }, select: { extraShiftId: true, punchedAt: true } })) : [];
    const punchedSet = new Set(punches.map((p) => p.extraShiftId));
    const items = rows.map((r) => ({
      id: r.id, employeeId: r.pontoEmployeeId, employeeName: nm.get(r.pontoEmployeeId) ?? "—",
      workDate: r.workDate, valueCents: Number(r.dailyValueCents), status: r.status,
      attended: punchedSet.has(r.id), note: r.note,
    }));
    return {
      escalados: items.filter((i) => i.status === "escalado"),
      pagos: items.filter((i) => i.status === "pago"),
      trabalharamNaoPagos: items.filter((i) => i.status === "nao_pago"),
      naoCompareceram: items.filter((i) => i.status === "nao_compareceu"),
    };
  }

  /** DP fecha o status final (depois de ver o papel assinado, ou não, em mãos). */
  async setStatus(ctx: RequestContext, id: string, status: "pago" | "nao_pago" | "nao_compareceu" | "escalado") {
    this.requireAdmin(ctx, "ponto.close");
    if (!["pago", "nao_pago", "nao_compareceu", "escalado"].includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoExtraShift.update({
      where: { id },
      data: { status, statusConfirmedAt: status === "escalado" ? null : new Date(), statusConfirmedBy: status === "escalado" ? null : (ctx.userId ?? null) },
    }));
    return { ok: true };
  }

  /** Reimprime o recibo de uma escalação já existente (papel perdido, etc). */
  async reprint(ctx: RequestContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireAdmin(ctx, "ponto.view");
    const shift = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoExtraShift.findFirst({ where: { id } }));
    if (!shift) throw new AppError(ErrorCode.NotFound, "Escalação não encontrada", 404);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: shift.pontoEmployeeId }, select: { name: true, cpf: true, employerId: true } }));
    const brand = await this.brand(ctx, emp?.employerId ?? null);
    const buffer = await this.renderReceipts([{ name: emp?.name ?? "—", cpf: emp?.cpf ?? null, valueCents: Number(shift.dailyValueCents), workDate: shift.workDate, brand }]);
    return { buffer, filename: `extra-${shift.workDate.toISOString().slice(0, 10)}-reimpressao.pdf` };
  }

  // ---------------- Ponte com o kiosk (chamado pelo ponto-pwa.service.ts) ----------------

  /** Existe escalação de extra pra esse funcionário HOJE? Usado pelo punch/facePunch
   *  do kiosk pra decidir se desvia a batida pro registro paralelo. */
  async findTodayShift(organizationId: string, pontoEmployeeId: string) {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoExtraShift.findFirst({
      where: { organizationId, pontoEmployeeId, workDate: today as any },
    })).catch(() => null);
  }

  /**
   * Grava a batida no registro paralelo — NUNCA em PontoPunch.
   *
   * No RH este `create` não tinha proteção: se ele estourasse, a pessoa levava
   * um 500 genérico no terminal e a batida não existia em lugar NENHUM — nem
   * aqui nem na tabela oficial. Mesma classe do bug da selfie que derrubava a
   * batida inteira.
   *
   * Aqui NÃO dá pra cair na tabela oficial como plano B: extra em `ponto_punch`
   * entra no AFD/eSocial, e o desenho inteiro existe pra impedir isso. Então o
   * que se faz é falhar com uma mensagem que diz o que a pessoa tem que fazer —
   * o recibo assinado em papel é o registro primário do extra de qualquer
   * forma, e é com ele em mãos que o DP confirma o status.
   */
  async registerPunch(extraShiftId: string, organizationId: string, photoUrl: string | null, deviceId: string | null) {
    try {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoExtraPunch.create({
        data: { extraShiftId, organizationId, photoUrl, deviceId },
      }));
    } catch (e) {
      this.logger.error(`extra: nao consegui gravar a batida do extra ${extraShiftId}: ${String((e as any)?.message ?? e)}`);
      throw new AppError(
        ErrorCode.Internal,
        "Nao consegui registrar sua batida de extra. Avise o DP e guarde o recibo assinado — o pagamento e confirmado por ele.",
        500,
      );
    }
  }

  // ---------------- PDF (2 vias por folha A4) ----------------

  /** Marca (nome/CNPJ/cidade) pro cabeçalho do recibo — TEM que ser o empregador
   *  do funcionário (employerId), não o nome comercial da conta: o recibo diz
   *  "recebi de <brand.name>", e precisa bater com o CNPJ que de fato paga/
   *  emprega essa pessoa quando a conta tem mais de um empregador cadastrado. */
  private async brand(ctx: RequestContext, employerId?: string | null): Promise<{ name: string; color: string | null; logoBuf: Buffer | null; cnpj: string | null; city: string | null }> {
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, logoUrl: true, primaryColor: true } })).catch(() => null);
    let logoBuf: Buffer | null = null;
    if (org?.logoUrl) { try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000); const res = await fetch(org.logoUrl, { signal: ctl.signal }); clearTimeout(t); if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); if ((b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8)) logoBuf = b; } } catch { /* ignore */ } }
    const empr = await this.employer.resolveBrand(ctx, employerId).catch(() => null);
    // o `resolveBrand` desta base devolve `{name, cnpj}` — sem `city`. A cidade
    // vem do `localPrestacao` do ponto_config, que é o campo equivalente aqui.
    if (empr) {
      const loc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { localPrestacao: true } })).catch(() => null);
      return { name: empr.name, color: org?.primaryColor ?? null, logoBuf, cnpj: empr.cnpj, city: loc?.localPrestacao || null };
    }
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true, idtEmpregador: true, localPrestacao: true } })).catch(() => null);
    return { name: cfg?.razaoOuNome || org?.name || "Empresa", color: org?.primaryColor ?? null, logoBuf, cnpj: cfg?.idtEmpregador ? this.fmtCnpj(cfg.idtEmpregador) : null, city: cfg?.localPrestacao || null };
  }

  /** 4 vias por folha A4 (2 pessoas por página, 2 vias cada) - bem menos
   *  desperdício de papel que 1 pessoa por folha. Corta em 4: funcionário
   *  assina e leva 1, a empresa fica com a outra - por pessoa. */
  private renderReceipts(rows: Array<{ name: string; cpf: string | null; valueCents: number; workDate: Date; brand: { name: string; color: string | null; logoBuf: Buffer | null; cnpj: string | null; city: string | null } }>): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 28 }); const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 28, W = pdf.page.width - M * 2; const blockH = (pdf.page.height - M * 2) / 4;
      rows.forEach((r, i) => {
        const slot = i % 2; if (i > 0 && slot === 0) pdf.addPage();
        const top = M + slot * (blockH * 2);
        this.drawReceipt(pdf, M, top, W, blockH - 8, r.brand, r, "VIA DO FUNCIONÁRIO");
        this.drawReceipt(pdf, M, top + blockH, W, blockH - 8, r.brand, r, "VIA DA EMPRESA");
      });
      pdf.end();
    });
  }

  private drawReceipt(pdf: any, x: number, y: number, w: number, h: number, brand: { name: string; color: string | null; logoBuf: Buffer | null; cnpj: string | null; city: string | null }, r: { name: string; cpf: string | null; valueCents: number; workDate: Date }, viaLabel: string) {
    const accent = brand.color && /^#[0-9a-fA-F]{6}$/.test(brand.color) ? brand.color : "#111827";
    pdf.save(); pdf.rect(x, y, w, h).lineWidth(1).strokeColor("#999").stroke();
    const pad = 16;
    // logo (se houver) + valor na mesma linha, sem dividir espaço com o
    // título — evita elemento sobrepondo elemento. Título ganha a linha
    // de baixo, sozinho, com folga.
    if (brand.logoBuf) { try { pdf.image(brand.logoBuf, x + pad, y + 10, { fit: [70, 16] }); } catch { /* ignore */ } }
    pdf.font("Helvetica-Bold").fontSize(15).fillColor(accent).text(`R$ ${(r.valueCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, x + w - pad - 150, y + 8, { width: 150, align: "right" });
    pdf.font("Helvetica-Bold").fontSize(13).fillColor("#111").text("RECIBO DE DIÁRIA (EXTRA)", x + pad, y + 32, { width: w - pad * 2, lineBreak: false });
    pdf.font("Helvetica").fontSize(9.5).fillColor("#777").text(viaLabel, x + pad, y + 50, { width: w - pad * 2 });
    const dataStr = r.workDate.toLocaleDateString("pt-BR", { timeZone: "UTC" });
    const texto = `Recebi de ${brand.name}${brand.cnpj ? ` (CNPJ ${brand.cnpj})` : ""} a importância de R$ ${(r.valueCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, referente a trabalho extra (diária) prestado em ${dataStr}, fora da escala regular.`;
    pdf.font("Helvetica").fontSize(10.5).fillColor("#222").text(texto, x + pad, y + 66, { width: w - pad * 2, lineGap: 2 });
    pdf.font("Helvetica").fontSize(9.5).fillColor("#333").text(`${brand.city ? brand.city + ", " : ""}______ de ____________ de ${new Date().getFullYear()}.`, x + pad, y + h - 46, { width: w - pad * 2 });
    const sy = y + h - 26; const cx = x + w / 2;
    pdf.moveTo(cx - 140, sy).lineTo(cx + 140, sy).strokeColor("#333").stroke();
    pdf.font("Helvetica-Bold").fontSize(10.5).fillColor("#111").text(r.name.toUpperCase(), x, sy + 4, { width: w, align: "center", lineBreak: false });
    if (r.cpf) pdf.font("Helvetica").fontSize(9).fillColor("#333").text(`CPF ${r.cpf}`, x, sy + 17, { width: w, align: "center", lineBreak: false });
    pdf.restore();
  }
}
