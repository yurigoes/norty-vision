import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

/**
 * Normaliza telefone BR pra E.164 sem '+': 55 + DDD + numero.
 * Aceita o usuario digitando so DDD + numero (com ou sem mascara).
 * - Se ja vier com 55 (12-13 digitos), mantem.
 * - Se vier 10 (fixo) ou 11 (celular 9 digitos), prefixa 55.
 * Nao adiciona/remove o 9o digito automaticamente (regra varia por DDD).
 */
export function normalizeBRPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d; // best-effort (numero internacional ou incompleto)
}

interface UpsertCustomerInput {
  storeId?: string | null;
  name: string;
  displayName?: string | null;
  document?: string | null;
  documentType?: "cpf" | "cnpj" | "passport" | "other" | null;
  birthDate?: string | null; // ISO date
  gender?: "male" | "female" | "other" | "unspecified" | null;
  email?: string | null;
  phone?: string | null;
  phoneSecondary?: string | null;
  whatsappPhone?: string | null;
  prefersChannel?: "whatsapp" | "sms" | "email" | "phone" | "none" | null;
  optOutMarketing?: boolean;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tags?: string[];
  source?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  avatarUrl?: string | null;
  incomeCents?: number | null;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private requireOrg(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
  }

  /**
   * Resolve a loja: usa a informada, senao a do contexto, senao a unica loja
   * ativa da org. So erra se houver ambiguidade real (multiplas lojas sem
   * escolha) ou nenhuma loja.
   */
  private async resolveStoreId(ctx: RequestContext, given?: string | null): Promise<string> {
    if (given) return given;
    if (ctx.storeId) return ctx.storeId;
    const stores = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.store.findMany({
        where: { organizationId: ctx.orgId!, deletedAt: null, status: "active" },
        select: { id: true },
        take: 2,
      }),
    );
    if (stores.length === 1) return stores[0]!.id;
    if (stores.length === 0) {
      throw new AppError(ErrorCode.ValidationFailed, "Crie uma loja antes de cadastrar clientes", 400);
    }
    throw new AppError(ErrorCode.ValidationFailed, "Selecione a loja (mais de uma disponivel)", 400);
  }

  private rlsCtx(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : {
          orgId: ctx.orgId!,
          userId: ctx.userId ?? undefined,
          storeId: ctx.storeId ?? undefined,
          isOrgAdmin: ctx.isOrgAdmin,
        };
  }

  async list(
    ctx: RequestContext,
    opts?: { storeId?: string; search?: string; limit?: number },
  ) {
    this.requireOrg(ctx);
    const limit = Math.min(opts?.limit ?? 50, 500);
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customer.findMany({
        where: {
          deletedAt: null,
          ...(opts?.storeId ? { storeId: opts.storeId } : {}),
          ...(opts?.search
            ? {
                OR: [
                  { name: { contains: opts.search, mode: "insensitive" } },
                  { phone: { contains: opts.search } },
                  { whatsappPhone: { contains: opts.search } },
                  { document: { contains: opts.search } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        take: limit,
      }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    const c = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customer.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!c) throw new AppError(ErrorCode.NotFound, "Cliente nao encontrado", 404);
    return c;
  }

  /** Busca por telefone ou whatsapp_phone (usado por webhooks). */
  async findByPhone(orgId: string, storeId: string, phone: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.findFirst({
        where: {
          organizationId: orgId,
          storeId,
          deletedAt: null,
          OR: [{ phone }, { whatsappPhone: phone }],
        },
      }),
    );
  }

  /**
   * Cruza paciente↔cliente: procura um cliente existente pelo MESMO documento
   * (CPF/CNPJ) ou telefone/WhatsApp e, se achar, devolve ele (matched=true)
   * pra vincular em vez de duplicar. Se nao achar, cria um novo (matched=false).
   * Usado ao cadastrar paciente na agenda (e em qualquer cadastro rapido).
   */
  async findOrCreate(
    ctx: RequestContext,
    input: UpsertCustomerInput,
  ): Promise<{ customer: any; matched: boolean }> {
    this.requireOrg(ctx);
    const doc = (input.document ?? "").replace(/\D/g, "");
    const phone = normalizeBRPhone(input.whatsappPhone ?? input.phone);

    if (doc || phone) {
      const found = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
        tx.customer.findFirst({
          where: {
            deletedAt: null,
            OR: [
              ...(doc ? [{ document: { contains: doc.slice(0, 11) } }] : []),
              ...(phone ? [{ whatsappPhone: phone }, { phone }] : []),
            ],
          },
          orderBy: { createdAt: "asc" },
        }),
      );
      // confirma match por documento normalizado (o contains acima e amplo)
      if (found) {
        const fdoc = (found.document ?? "").replace(/\D/g, "");
        const fphone = (found.whatsappPhone ?? found.phone ?? "").replace(/\D/g, "");
        const docMatch = !!doc && fdoc === doc;
        const phoneMatch = !!phone && fphone === phone.replace(/\D/g, "");
        if (docMatch || phoneMatch) return { customer: found, matched: true };
      }
    }

    const customer = await this.create(ctx, input);
    return { customer, matched: false };
  }

  /** Importação em lote (ex.: CSV de clientes). Deduplica por documento/telefone. */
  async importBatch(ctx: RequestContext, rows: UpsertCustomerInput[]): Promise<{ created: number; matched: number; errors: number }> {
    this.requireOrg(ctx);
    let created = 0, matched = 0, errors = 0;
    for (const row of rows.slice(0, 5000)) {
      if (!row?.name || row.name.trim().length < 2) { errors++; continue; }
      try {
        const r = await this.findOrCreate(ctx, { ...row, source: row.source ?? "import" });
        if (r.matched) matched++; else created++;
      } catch { errors++; }
    }
    return { created, matched, errors };
  }

  async create(ctx: RequestContext, input: UpsertCustomerInput) {
    this.requireOrg(ctx);
    const storeId = await this.resolveStoreId(ctx, input.storeId);
    try {
      return await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
        tx.customer.create({
          data: {
            organizationId: ctx.orgId!,
            storeId,
            name: input.name,
            displayName: input.displayName ?? null,
            document: input.document ?? null,
            documentType: input.documentType ?? null,
            birthDate: input.birthDate ? new Date(input.birthDate) : null,
            gender: input.gender ?? "unspecified",
            email: input.email ?? null,
            phone: normalizeBRPhone(input.phone),
            phoneSecondary: normalizeBRPhone(input.phoneSecondary),
            whatsappPhone: normalizeBRPhone(input.whatsappPhone ?? input.phone),
            prefersChannel: input.prefersChannel ?? "whatsapp",
            optOutMarketing: input.optOutMarketing ?? false,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            // Endereço completo + avatar + renda: o form salvava esses campos
            // mas o service ignorava — depois somiam ao recarregar. Agora ficam.
            addressLine: input.addressLine ?? null,
            addressNumber: input.addressNumber ?? null,
            addressComplement: input.addressComplement ?? null,
            neighborhood: input.neighborhood ?? null,
            avatarUrl: input.avatarUrl ?? null,
            incomeCents: input.incomeCents != null ? BigInt(input.incomeCents) : null,
            tags: input.tags ?? [],
            source: input.source ?? "manual",
            createdBy: ctx.userId ?? null,
          },
        }),
      );
    } catch (e: any) {
      // Traduz erros do Prisma em mensagens úteis (antes vinha só
      // "Unique constraint failed on the (not available)" ou um stack cripto)
      if (e?.code === "P2002") {
        const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(", ") : (e?.meta?.target ?? "campo único");
        throw new AppError(ErrorCode.Conflict, `Já existe cliente com esse(s) campo(s) único(s): ${target}`, 409);
      }
      if (e?.code === "P2003") {
        throw new AppError(ErrorCode.ValidationFailed, `Loja informada não existe ou está inativa (storeId=${storeId}).`, 400);
      }
      // Loga input pra diagnóstico (sem expor PII no erro pro cliente)
      // eslint-disable-next-line no-console
      console.warn(`[customer.create] falhou orgId=${ctx.orgId} storeId=${storeId} code=${e?.code} msg=${e?.message?.slice(0, 200)}`);
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertCustomerInput>) {
    this.requireOrg(ctx);
    const data: Record<string, unknown> = {};
    for (const k of [
      "name",
      "displayName",
      "document",
      "documentType",
      "gender",
      "email",
      "phone",
      "phoneSecondary",
      "whatsappPhone",
      "prefersChannel",
      "optOutMarketing",
      "city",
      "state",
      "postalCode",
      "tags",
      "source",
      "addressLine",
      "addressNumber",
      "addressComplement",
      "neighborhood",
      "avatarUrl",
    ] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    if (input.incomeCents !== undefined) {
      data.incomeCents = input.incomeCents != null ? BigInt(input.incomeCents) : null;
    }
    // normaliza telefones quando presentes
    if (input.phone !== undefined) data.phone = normalizeBRPhone(input.phone);
    if (input.phoneSecondary !== undefined) data.phoneSecondary = normalizeBRPhone(input.phoneSecondary);
    if (input.whatsappPhone !== undefined) data.whatsappPhone = normalizeBRPhone(input.whatsappPhone);
    if (input.birthDate !== undefined) {
      data.birthDate = input.birthDate ? new Date(input.birthDate) : null;
    }
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customer.update({ where: { id }, data }),
    );
  }

  async softDelete(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    if (!ctxCan(ctx, "customers.delete")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para excluir cliente", 403);
    }
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customer.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  // ============================== Notas permanentes ==============================
  async listNotes(ctx: RequestContext, customerId: string) {
    await this.getById(ctx, customerId); // garante permissão + existência
    const rows = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customerNote.findMany({
        where: { customerId, OR: [{ isPrivate: false }, { createdBy: ctx.userId ?? "__none__" }] },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 100,
      }),
    );
    // anexa nome do autor
    const userIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))] as string[];
    const users = userIds.length
      ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }))
      : [];
    const um = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, authorName: r.createdBy ? um.get(r.createdBy) ?? null : null }));
  }

  async createNote(ctx: RequestContext, customerId: string, input: { body: string; pinned?: boolean; isPrivate?: boolean }) {
    const c = await this.getById(ctx, customerId);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerNote.create({
        data: {
          organizationId: c.organizationId,
          storeId: c.storeId ?? c.organizationId, // fallback se cliente é org-wide
          customerId,
          body: input.body.trim(),
          pinned: input.pinned ?? false,
          isPrivate: input.isPrivate ?? false,
          createdBy: ctx.userId ?? null,
        },
      }),
    );
  }

  async deleteNote(ctx: RequestContext, customerId: string, noteId: string) {
    const n = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customerNote.findFirst({ where: { id: noteId, customerId } }),
    );
    if (!n) throw new AppError(ErrorCode.NotFound, "Nota não encontrada", 404);
    if (n.createdBy && n.createdBy !== ctx.userId && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Só quem criou ou admin pode apagar", 403);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerNote.delete({ where: { id: noteId } }),
    );
    return { ok: true };
  }

  // ============================== Timeline unificada ==============================
  /**
   * Devolve um feed cronológico de TODOS os pontos de contato com o cliente:
   * conversas (qualquer canal), agendamentos, vendas, pedidos de produção.
   * Útil pro operador entender "quem é esse cliente" em 5 segundos.
   */
  async timeline(ctx: RequestContext, customerId: string) {
    await this.getById(ctx, customerId);
    const [convs, appts, sales, prodOrders] = await Promise.all([
      this.prisma.runWithContext(this.rlsCtx(ctx), (tx) => tx.conversation.findMany({
        where: { customerId },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        select: { id: true, channel: true, status: true, subject: true, lastMessageAt: true, createdAt: true, contactName: true },
      })).catch(() => []),
      this.prisma.runWithContext(this.rlsCtx(ctx), (tx) => tx.appointment.findMany({
        where: { customerId, deletedAt: null },
        orderBy: { startsAt: "desc" },
        take: 50,
        select: { id: true, status: true, startsAt: true, serviceName: true },
      })).catch(() => []),
      this.prisma.runWithContext(this.rlsCtx(ctx), (tx) => tx.sale.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, shortCode: true, totalCents: true, status: true, createdAt: true },
      })).catch(() => []),
      this.prisma.runWithContext(this.rlsCtx(ctx), (tx) => tx.productionOrder.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, shortCode: true, status: true, totalCents: true, createdAt: true },
      })).catch(() => []),
    ]);
    type Event = { kind: string; at: Date; title: string; subtitle: string; refId: string; status: string | null };
    const events: Event[] = [
      ...convs.map((c): Event => ({ kind: "conversation", at: c.lastMessageAt ?? c.createdAt, title: `💬 Conversa ${c.channel}`, subtitle: c.subject ?? c.contactName ?? "—", refId: c.id, status: c.status })),
      ...appts.map((a): Event => ({ kind: "appointment", at: a.startsAt, title: `📅 Agendamento`, subtitle: a.serviceName ?? "Atendimento", refId: a.id, status: a.status })),
      ...sales.map((s): Event => ({ kind: "sale", at: s.createdAt, title: `💰 Venda ${s.shortCode ?? ""}`, subtitle: `R$ ${(Number(s.totalCents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, refId: s.id, status: s.status })),
      ...prodOrders.map((p): Event => ({ kind: "production", at: p.createdAt, title: `🏭 Pedido ${p.shortCode ?? ""}`, subtitle: `R$ ${(Number(p.totalCents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, refId: p.id, status: p.status })),
    ];
    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { items: events.slice(0, 150) };
  }

  /**
   * Reseta a senha do PORTAL do cliente: limpa a senha e marca troca
   * obrigatoria. No proximo acesso a senha inicial volta a ser o CPF/CNPJ.
   * Funciona pra qualquer cliente (com ou sem crediario). Tambem limpa a
   * senha da conta de crediario do mesmo documento, se houver.
   */
  async resetPortalPassword(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    if (!ctxCan(ctx, "customers.edit")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para resetar senha do cliente", 403);
    }
    const c = await this.getById(ctx, id);
    const doc = (c.document ?? "").replace(/\D/g, "");
    if (!doc) throw new AppError(ErrorCode.ValidationFailed, "Cliente sem CPF/CNPJ", 400);

    // posse ja validada por getById(ctx, id); escreve via contexto privilegiado
    // (evita armadilha de RLS store-scoped quando o admin nao tem loja ativa)
    const orgId = ctx.orgId ?? c.organizationId;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.update({
        where: { id },
        data: { portalPasswordHash: null, portalMustReset: true },
      }),
    );
    // tambem reseta a conta de crediario do mesmo documento (legado/compat)
    const r = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.updateMany({
        where: { organizationId: orgId, document: doc },
        data: { passwordHash: null, mustResetPassword: true },
      }),
    );
    return { ok: true, accounts: r.count };
  }

  private fileKind(fileUrl: string): "image" | "pdf" | "other" {
    const u = fileUrl.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/.test(u)) return "image";
    if (/\.pdf(\?|$)/.test(u)) return "pdf";
    return "other";
  }

  /** Lista os documentos enviados por um cliente (KYC + por conta de crediário). */
  async listDocuments(ctx: RequestContext, customerId: string) {
    this.requireOrg(ctx);
    const cust = await this.getById(ctx, customerId); // valida posse/org
    const accounts = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findMany({ where: { primaryCustomerId: customerId }, select: { id: true } }),
    );
    const accIds = accounts.map((a) => a.id);
    const docs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerDocument.findMany({
        where: {
          organizationId: cust.organizationId,
          OR: [{ customerId }, ...(accIds.length ? [{ creditAccountId: { in: accIds } }] : [])],
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    return docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      status: d.status,
      notes: d.notes,
      createdAt: d.createdAt,
      kind: this.fileKind(d.fileUrl),
    }));
  }

  /**
   * Resolve um documento para visualização (org-scoped). Retorna ou a key
   * privada (pra stream) ou a URL pública.
   */
  async resolveDocument(ctx: RequestContext, customerId: string, docId: string): Promise<{ privateKey?: string; publicUrl?: string }> {
    this.requireOrg(ctx);
    const cust = await this.getById(ctx, customerId);
    const doc = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerDocument.findFirst({ where: { id: docId, organizationId: cust.organizationId } }),
    );
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento não encontrado", 404);
    if (doc.fileUrl.startsWith("priv:")) {
      const key = doc.fileUrl.slice(5);
      // garante que a key pertence à org (defesa em profundidade)
      if (!key.startsWith(`kyc/${cust.organizationId}/`)) {
        throw new AppError(ErrorCode.Forbidden, "Acesso negado", 403);
      }
      return { privateKey: key };
    }
    return { publicUrl: doc.fileUrl };
  }
}
