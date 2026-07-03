// ==============================================================================
// production-import.service.ts
//
// Importação em massa de planilhas Excel legadas de pedidos de produção
// (gráfica). Caso de uso real: VR Sports — 5 abas (Janeiro a Maio), ~750
// linhas cada com header repetido por aba.
//
// Estrutura esperada (detectada por procurar a linha "NOME / CONTATO / Peças"):
//   NOME | CONTATO | Peças | Pedido | Tecido | Fechamento | Data Entrega |
//   Costureira | Status | Valor | Pagamento | Forma | Valor Pago | A pagar |
//   Pgto Final | Forma final | Foto Entrada | Foto Saída | NFCe
//
// Cada linha vira:
//   1. Customer (find-or-create por nome + telefone normalizado)
//   2. Supplier type=costureira (find-or-create por nome — costureiras
//      conhecidas: JUSSARA, LU, IRIS, ECI). Datas tipo "10/04" ignoradas.
//   3. ProductionOrder com items, totalCents, paymentStatus, paymentMethod,
//      assignedSupplierId, status mapeado, producedAt se já passou.
//   4. Files (foto entrada/saída) anexados como url externa.
//
// IDEMPOTENTE: hash(contato + fechamento + valor) único por org. Re-rodar
// não duplica. Retorna { imported, skippedDup, errors[] }.
//
// SECURITY: requer permission "production.create"; admin/owner liberados.
// ==============================================================================
import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeBRPhone } from "../customers/customers.service";
import type { RequestContext } from "../auth/session.middleware";

// linha "padrão" do que detectamos numa linha de header da planilha
const HEADER_HINTS = ["NOME", "CONTATO", "PEÇAS", "PEDIDO", "STATUS"];

// Status na planilha → status do nosso production_orders.
// "Costureira" = em produção pela costureira
// "Loja"       = pronto pra retirada na loja
// "Finalizado" = entregue ao cliente
const STATUS_MAP: Record<string, { status: string; produced: boolean; finalized: boolean }> = {
  costureira: { status: "costura", produced: false, finalized: false },
  loja:       { status: "pronto",  produced: true,  finalized: false },
  finalizado: { status: "finalizado", produced: true, finalized: true },
  entregue:   { status: "finalizado", produced: true, finalized: true },
};

export interface RawRow {
  nome: string;                   // garantido não-vazio pelo parser
  contato: string | null;
  pecas: number | null;
  tipo: string | null;
  tecido: string | null;
  fechamento: string | null;
  entrega: string | null;
  costureira: string | null;
  status: string;                 // garantido não-vazio
  valorPedido: number;            // garantido não-null
  pagamento: string | null;       // PARCIAL | TOTAL | …
  formaPgto: string | null;       // PIX | CARTÃO | DINHEIRO | BONUS
  valorPago: number | null;
  aPagar: number | null;
  fotoEntrada: string | null;
  fotoSaida: string | null;
  nfce: string | null;
  // origem (rastreabilidade)
  _aba: string;
  _linhaOriginal: number;
}

export interface ImportSummary {
  totalRowsParsed: number;
  imported: number;
  skippedDup: number;
  errors: Array<{ aba: string; linha: number; motivo: string; nome?: string | null }>;
  costureirasCriadas: string[];
  clientesCriados: number;
}

@Injectable()
export class ProductionImportService {
  private readonly logger = new Logger(ProductionImportService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Faz o parse de buffer xlsx em RawRow[] descartando linhas inválidas. */
  parseBuffer(buffer: Buffer): RawRow[] {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const all: RawRow[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as any[][];
      // detecta a linha de header procurando "NOME", "CONTATO" e "Peças" próximos
      let headerRow = -1;
      let headerCols: string[] = [];
      // Detecta a linha de header por SUBSTRING (não match exato): "STATUS"
      // bate em "STATUS DO PEDIDO", "Peças" bate em "PEÇAS", etc.
      // Procura nas primeiras 20 linhas pra tolerar ofício/título/totais.
      for (let i = 0; i < Math.min(20, aoa.length); i++) {
        const cells = (aoa[i] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
        if (HEADER_HINTS.every((h) => cells.some((c) => c.includes(h.toUpperCase())))) {
          headerRow = i;
          headerCols = cells;
          break;
        }
      }
      if (headerRow < 0) continue; // aba sem dados úteis
      // mapeamento coluna → índice (tolerante a variações de nome)
      const ix = (name: string, alt?: string[]): number => {
        const candidates = [name, ...(alt ?? [])].map((s) => s.toUpperCase());
        for (let i = 0; i < headerCols.length; i++) {
          const cell = headerCols[i] ?? "";
          if (candidates.some((c) => cell.includes(c))) return i;
        }
        return -1;
      };
      const COL = {
        nome: ix("NOME"),
        contato: ix("CONTATO"),
        pecas: ix("PEÇAS", ["PECAS"]),
        tipo: ix("PEDIDO"),
        tecido: ix("TECIDO"),
        fechamento: ix("FECHAMENTO"),
        entrega: ix("DATA DA ENTREGA", ["ENTREGA"]),
        costureira: ix("COSTUREIRA"),
        status: ix("STATUS DO PEDIDO", ["STATUS"]),
        valor: ix("VALOR DO PEDIDO", ["VALOR"]),
        pagamento: ix("PAGAMENTO"),
        forma: ix("FORMA PAGAMENTO", ["FORMA"]),
        valorPago: ix("VALOR PAGO"),
        aPagar: ix("A PAGAR"),
        fotoEntrada: ix("FOTO ENTRADA"),
        fotoSaida: ix("FOTO SAÍDA", ["FOTO SAIDA"]),
        nfce: ix("NFCE", ["NFC-E"]),
      };
      // ATENÇÃO: nem todas as colunas precisam existir. As essenciais são nome+status+valor.
      for (let i = headerRow + 1; i < aoa.length; i++) {
        const row = aoa[i] ?? [];
        const get = (col: number): string | null => {
          if (col < 0) return null;
          const v = row[col];
          if (v == null) return null;
          const s = String(v).trim();
          return s === "" ? null : s;
        };
        const getNum = (col: number): number | null => {
          const s = get(col);
          if (!s) return null;
          // remove "R$", espaços, milhar (,), troca vírgula decimal por ponto
          const cleaned = s.replace(/R\$/i, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
          const n = Number(cleaned);
          return Number.isFinite(n) ? n : null;
        };
        const nome = get(COL.nome);
        const status = get(COL.status);
        const valorPedido = getNum(COL.valor);
        // descarta linhas sem nome OU sem status OU sem valor (vazias, sub-totais, etc)
        if (!nome || !status || valorPedido == null) continue;
        // descarta linhas onde o nome é tipo "Total", "Valor Total", "MAIO" (header de seção)
        if (/^(total|valor total|m[êe]s|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(nome)) continue;
        all.push({
          nome,
          contato: get(COL.contato),
          pecas: getNum(COL.pecas),
          tipo: get(COL.tipo),
          tecido: get(COL.tecido),
          fechamento: get(COL.fechamento),
          entrega: get(COL.entrega),
          costureira: get(COL.costureira),
          status,
          valorPedido,
          pagamento: get(COL.pagamento),
          formaPgto: get(COL.forma),
          valorPago: getNum(COL.valorPago),
          aPagar: getNum(COL.aPagar),
          fotoEntrada: get(COL.fotoEntrada),
          fotoSaida: get(COL.fotoSaida),
          nfce: get(COL.nfce),
          _aba: sheetName,
          _linhaOriginal: i + 1,
        });
      }
    }
    return all;
  }

  /** Apenas faz o parse sem persistir. Útil pra dry-run / preview. */
  preview(buffer: Buffer, limit = 10) {
    const rows = this.parseBuffer(buffer);
    return { totalRows: rows.length, preview: rows.slice(0, limit) };
  }

  /** Importa as linhas resolvendo cliente + costureira + pedido. Idempotente. */
  async importBuffer(ctx: RequestContext, buffer: Buffer, opts?: { createCostureiraIfMissing?: boolean }): Promise<ImportSummary> {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId;
    const createMissing = opts?.createCostureiraIfMissing ?? true;
    const rows = this.parseBuffer(buffer);
    const summary: ImportSummary = {
      totalRowsParsed: rows.length,
      imported: 0,
      skippedDup: 0,
      errors: [],
      costureirasCriadas: [],
      clientesCriados: 0,
    };

    // Cache de supplier por nome canonical (upper, sem espaços extras)
    const supplierCache = new Map<string, string>(); // nameUpper → supplierId
    // Cache de customer por (nome+telefone)
    const customerCache = new Map<string, string>();

    // Loja default da org (precisa pra storeId em customer/supplier)
    const defaultStore = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.store.findFirst({ where: { organizationId: orgId, deletedAt: null }, select: { id: true } }),
    );
    if (!defaultStore) throw new AppError(ErrorCode.ValidationFailed, "Org sem loja cadastrada", 400);
    const storeId = defaultStore.id;

    // CATÁLOGO da gráfica (GraficaPriceItem): carrega todos os ativos da org pra fazer
    // fuzzy match com o "tipo" + "tecido" da planilha. Ex: tipo="CAMISA" e tecido=
    // "PREMIUM ARROZ" tenta achar item do catálogo cujo name OU category contém
    // "camisa". Se acha, a descrição do production_order_item usa o name canônico
    // do catálogo em vez do texto cru.
    const catalogItems = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.graficaPriceItem.findMany({
        where: { organizationId: orgId, active: true },
        select: { id: true, name: true, category: true },
      }),
    ).catch(() => [] as Array<{ id: string; name: string; category: string | null }>);
    // pre-normaliza pra busca rápida
    const catalogIndex = catalogItems.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      nameNorm: this.normalizeText(c.name),
      categoryNorm: this.normalizeText(c.category ?? ""),
    }));

    for (const r of rows) {
      try {
        // dedupe via hash estável
        const hash = this.hashRow(r);
        const dup = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.productionOrder.findFirst({ where: { organizationId: orgId, importHash: hash }, select: { id: true } }),
        );
        if (dup) { summary.skippedDup++; continue; }

        // 1) Resolve costureira (se houver nome válido)
        let assignedSupplierId: string | null = null;
        const costNameRaw = r.costureira ?? "";
        // descarta datas / vazios
        if (costNameRaw && !/^\d{1,2}[\/\-]\d{1,2}/.test(costNameRaw) && costNameRaw.length >= 2) {
          const key = costNameRaw.trim().toUpperCase();
          if (supplierCache.has(key)) {
            assignedSupplierId = supplierCache.get(key)!;
          } else {
            const existing = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
              tx.supplier.findFirst({
                where: { organizationId: orgId, type: "costureira", deletedAt: null, name: { equals: costNameRaw.trim(), mode: "insensitive" } },
                select: { id: true },
              }),
            );
            if (existing) { assignedSupplierId = existing.id; supplierCache.set(key, existing.id); }
            else if (createMissing) {
              const created = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
                tx.supplier.create({
                  data: { organizationId: orgId, type: "costureira", name: costNameRaw.trim(), status: "active" },
                  select: { id: true },
                }),
              );
              assignedSupplierId = created.id;
              supplierCache.set(key, created.id);
              summary.costureirasCriadas.push(costNameRaw.trim());
            }
          }
        }

        // 2) Resolve cliente (find-or-create)
        const customerKey = (r.nome.toUpperCase() + "|" + (r.contato ?? ""));
        let customerId: string | null = customerCache.get(customerKey) ?? null;
        if (!customerId) {
          const phone = r.contato ? normalizeBRPhone(r.contato) ?? null : null;
          const orConds: any[] = [{ name: { equals: r.nome, mode: "insensitive" as const } }];
          if (phone) orConds.push({ phone });
          const found = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.customer.findFirst({
              where: { organizationId: orgId, deletedAt: null, OR: orConds },
              select: { id: true },
            }),
          );
          if (found) { customerId = found.id; }
          else {
            const created = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
              tx.customer.create({
                data: { organizationId: orgId, storeId, name: r.nome, phone: phone ?? undefined },
                select: { id: true },
              }),
            );
            customerId = created.id;
            summary.clientesCriados++;
          }
          customerCache.set(customerKey, customerId);
        }

        // 3) Cria pedido
        const statusKey = (r.status ?? "").trim().toLowerCase();
        const statusInfo = STATUS_MAP[statusKey] ?? { status: "novo", produced: false, finalized: false };
        const totalCents = Math.round(r.valorPedido! * 100);
        const downPaymentCents = r.valorPago != null ? Math.round(r.valorPago * 100) : 0;
        const paymentStatus =
          (r.pagamento ?? "").toLowerCase().includes("total") || downPaymentCents >= totalCents ? "paid"
          : downPaymentCents > 0 ? "partial"
          : "none";
        const paymentMethod = this.mapPgto(r.formaPgto);
        const dueDate = this.parseDateBR(r.entrega);
        const producedAt = statusInfo.produced ? (this.parseDateBR(r.entrega) ?? this.parseDateBR(r.fechamento) ?? new Date()) : null;
        const tipo = (r.tipo ?? "ITEM").trim();
        const qty = Math.max(1, r.pecas ?? 1);
        const unitPriceCents = Math.round(totalCents / qty);
        // Match com catálogo: procura item cujo NAME contém o tipo ou
        // categoria bate. Usa o nome canônico do catálogo na descrição.
        const tipoNorm = this.normalizeText(tipo);
        const tecidoNorm = this.normalizeText(r.tecido ?? "");
        const catalogMatch = catalogIndex.find((c) =>
          c.nameNorm && tipoNorm && (c.nameNorm.includes(tipoNorm) || tipoNorm.includes(c.nameNorm) || c.categoryNorm === tipoNorm)
        );
        // Constrói descrição: "Nome do catálogo (TECIDO)" se achou; senão fallback
        const itemDescription = catalogMatch
          ? `${catalogMatch.name}${r.tecido ? ` (${r.tecido})` : ""}`
          : `${tipo}${r.tecido ? ` (${r.tecido})` : ""}`;

        let shortCode = this.genShortCode();
        const order = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (!(await tx.productionOrder.findFirst({ where: { shortCode }, select: { id: true } }))) break;
            shortCode = this.genShortCode();
          }
          const o = await tx.productionOrder.create({
            data: {
              organizationId: orgId,
              storeId,
              customerId,
              shortCode,
              contactName: r.nome,
              contactPhone: r.contato ?? null,
              status: statusInfo.status,
              artStatus: "aprovada",
              dueDate,
              totalCents: BigInt(totalCents),
              downPaymentCents: BigInt(downPaymentCents),
              paymentStatus,
              paymentMethod,
              nfUrl: r.nfce && /^https?:\/\//i.test(r.nfce) ? r.nfce : null,
              notes: `Importado da planilha (${r._aba}, linha ${r._linhaOriginal})${r.tecido ? ` · Tecido: ${r.tecido}` : ""}`,
              assignedSupplierId,
              producedAt,
              importHash: hash,
              items: { create: [{ organizationId: orgId, description: itemDescription, qty, unitPriceCents: BigInt(unitPriceCents), lineTotalCents: BigInt(qty * unitPriceCents) }] },
            },
          });
          // anexa fotos como files
          const files: any[] = [];
          if (r.fotoEntrada && /^https?:\/\//i.test(r.fotoEntrada)) {
            files.push({ organizationId: orgId, orderId: o.id, kind: "art", url: r.fotoEntrada, name: "foto-entrada" });
          }
          if (r.fotoSaida && /^https?:\/\//i.test(r.fotoSaida)) {
            files.push({ organizationId: orgId, orderId: o.id, kind: "delivery", url: r.fotoSaida, name: "foto-saida" });
          }
          if (files.length) await tx.productionOrderFile.createMany({ data: files });
          return o;
        });
        summary.imported++;
      } catch (e: any) {
        summary.errors.push({ aba: r._aba, linha: r._linhaOriginal, nome: r.nome, motivo: e?.message ?? String(e) });
      }
    }
    this.logger.log(`importBuffer org=${orgId}: ${summary.imported} importadas, ${summary.skippedDup} dup, ${summary.errors.length} erros`);
    return summary;
  }

  private hashRow(r: RawRow): string {
    const key = [r.nome.trim().toUpperCase(), (r.contato ?? "").replace(/\D/g, ""), r.fechamento ?? "", String(Math.round((r.valorPedido ?? 0) * 100))].join("|");
    return createHash("sha256").update(key).digest("hex").slice(0, 32);
  }

  private mapPgto(s: string | null): string | null {
    if (!s) return null;
    const u = s.toUpperCase();
    if (u.includes("PIX")) return "pix";
    if (u.includes("CARTÃO") || u.includes("CARTAO") || u.includes("CARD")) return "card";
    if (u.includes("DINHEIRO") || u.includes("CASH")) return "cash";
    if (u.includes("BONUS") || u.includes("BÔNUS")) return "bonus";
    return s.toLowerCase();
  }

  /** Parse de "14/05" ou "12-May-26" ou "2026-05-14". Retorna null se inválido. */
  private parseDateBR(s: string | null): Date | null {
    if (!s) return null;
    const v = s.trim();
    // 14/05 (assume ano atual) ou 14/05/26
    let m = v.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    if (m && m[1] && m[2]) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    // 12-May-26
    m = v.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m && m[1] && m[2] && m[3]) {
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const month = months[m[2].toLowerCase()];
      if (month == null) return null;
      const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      const d = new Date(year, month, parseInt(m[1], 10));
      return isNaN(d.getTime()) ? null : d;
    }
    // ISO
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Normaliza texto pra match fuzzy: remove acentos, lowercase, trim. */
  private normalizeText(s: string | null | undefined): string {
    if (!s) return "";
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  private genShortCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
}
