import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

interface FieldSchema {
  name: string;
  label: string;
  type: "text" | "email" | "cpf" | "cnpj" | "phone" | "date" | "select" | "textarea";
  required: boolean;
  options?: string[];
}

interface CreateTemplateInput {
  organizationId?: string | null;
  slug: string;
  title: string;
  description?: string | null;
  bodyMarkdown: string;
  fieldsSchema: FieldSchema[];
  signatureMode?: "click" | "draw";
  requiresSignature?: boolean;
  kind?: "generic" | "credit";
  biometricRequired?: boolean;
}

interface UpdateTemplateInput {
  title?: string;
  description?: string | null;
  bodyMarkdown?: string;
  fieldsSchema?: FieldSchema[];
  signatureMode?: "click" | "draw";
  requiresSignature?: boolean;
  isActive?: boolean;
  kind?: "generic" | "credit";
  biometricRequired?: boolean;
}

interface CreateContractInput {
  templateId: string;
  organizationId?: string;
  storeId?: string | null;
  signerEmail?: string;
  signerName?: string;
  signerDocument?: string;
  signerPhone?: string;
  fieldValues?: Record<string, unknown>;
  expiresInDays?: number;
  customerId?: string | null;
}

interface SignContractInput {
  token: string;
  fieldValues: Record<string, unknown>;
  signerName: string;
  signerEmail: string;
  signerDocument?: string;
  signerPhone?: string;
  signatureImageUrl?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ============================== TEMPLATES ==============================

  async listTemplates(ctx: RequestContext) {
    // master ve todos (de todas as empresas + os globais yugochat).
    // usuario de empresa ve SO os modelos da propria empresa — o contrato
    // yugochat (global, organization_id null) e exclusivo do master.
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId ?? undefined, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.contractTemplate.findMany({
          where: ctx.isPlatformAdmin
            ? { isActive: true }
            : { isActive: true, organizationId: ctx.orgId ?? "__none__" },
          orderBy: [{ organizationId: "asc" }, { title: "asc" }],
        }),
    );
  }

  async getTemplate(ctx: RequestContext, id: string) {
    const t = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId ?? undefined, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) => tx.contractTemplate.findUnique({ where: { id } }),
    );
    if (!t) throw new AppError(ErrorCode.NotFound, "Template nao encontrado", 404);
    // empresa nao acessa modelo global (yugochat) nem de outra empresa
    if (!ctx.isPlatformAdmin && t.organizationId !== ctx.orgId) {
      throw new AppError(ErrorCode.NotFound, "Template nao encontrado", 404);
    }
    return t;
  }

  async createTemplate(ctx: RequestContext, input: CreateTemplateInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode criar template", 403);
    }
    if (!/^[a-z0-9-]{3,60}$/.test(input.slug)) {
      throw new AppError(ErrorCode.ValidationFailed, "Slug invalido", 400);
    }
    const orgId = ctx.isPlatformAdmin ? (input.organizationId ?? null) : ctx.orgId;
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      (tx) =>
        tx.contractTemplate.create({
          data: {
            organizationId: orgId,
            slug: input.slug,
            title: input.title,
            description: input.description ?? null,
            bodyMarkdown: input.bodyMarkdown,
            fieldsSchema: input.fieldsSchema as any,
            signatureMode: input.signatureMode ?? "click",
            requiresSignature: input.requiresSignature ?? true,
            kind: input.kind ?? "generic",
            biometricRequired: input.biometricRequired ?? false,
            createdByPlatformUserId: ctx.platformUserId ?? null,
            createdByUserId: ctx.userId ?? null,
          },
        }),
    );
  }

  async updateTemplate(ctx: RequestContext, id: string, input: UpdateTemplateInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode editar template", 403);
    }
    // o contrato yugochat (template global, organizationId = null) so o master
    // edita; empresa so mexe nos proprios modelos.
    const existing = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.contractTemplate.findUnique({ where: { id }, select: { organizationId: true } }),
    );
    if (!existing) throw new AppError(ErrorCode.NotFound, "Template nao encontrado", 404);
    if (!ctx.isPlatformAdmin) {
      if (existing.organizationId === null) {
        throw new AppError(ErrorCode.Forbidden, "Modelo do sistema — apenas o master edita", 403);
      }
      if (existing.organizationId !== ctx.orgId) {
        throw new AppError(ErrorCode.Forbidden, "Modelo fora da sua empresa", 403);
      }
    }
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.bodyMarkdown !== undefined) data.bodyMarkdown = input.bodyMarkdown;
    if (input.fieldsSchema !== undefined) data.fieldsSchema = input.fieldsSchema;
    if (input.signatureMode !== undefined) data.signatureMode = input.signatureMode;
    if (input.requiresSignature !== undefined) data.requiresSignature = input.requiresSignature;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.biometricRequired !== undefined) data.biometricRequired = input.biometricRequired;

    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      (tx) => tx.contractTemplate.update({ where: { id }, data }),
    );
  }

  // ============================== CREDIARIO ==============================
  /** Cria contrato vinculado a uma conta de crediario (assinado no portal). */
  async createForAccount(
    ctx: RequestContext,
    opts: { creditAccountId: string; templateId?: string },
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const acc = await tx.creditAccount.findFirst({ where: { id: opts.creditAccountId } });
        if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);

        // template: o informado, ou o de crediario (org-specific ou global)
        const template = opts.templateId
          ? await tx.contractTemplate.findUnique({ where: { id: opts.templateId } })
          : await tx.contractTemplate.findFirst({
              where: {
                kind: "credit",
                isActive: true,
                OR: [{ organizationId: acc.organizationId }, { organizationId: null }],
              },
              orderBy: { organizationId: "desc" }, // org-specific antes do global
            });
        if (!template) throw new AppError(ErrorCode.NotFound, "Template de crediario nao existe", 404);

        // ja existe contrato ativo/assinado pra essa conta?
        const existing = await tx.contract.findFirst({
          where: {
            creditAccountId: acc.id,
            status: { in: ["sent", "signed"] },
          },
        });
        if (existing) return existing;

        const created = await tx.contract.create({
          data: {
            templateId: template.id,
            organizationId: acc.organizationId,
            creditAccountId: acc.id,
            customerId: acc.primaryCustomerId ?? null,
            signerName: acc.holderName,
            signerDocument: acc.document,
            status: "sent",
            sentAt: new Date(),
            fieldValues: {
              nome_completo: acc.holderName,
              cpf: acc.document,
            } as any,
            createdByUserId: ctx.userId ?? null,
          },
        });

        // avisa o cliente que há um contrato pra assinar no portal (best-effort)
        if (acc.primaryCustomerId) {
          const cust = await tx.customer.findFirst({
            where: { id: acc.primaryCustomerId },
            select: { storeId: true, name: true, phone: true, whatsappPhone: true, email: true },
          });
          if (cust) {
            const env = loadEnv();
            // link com o slug da empresa → o cliente cai no login com a marca dela
            const org = await tx.organization.findUnique({
              where: { id: acc.organizationId },
              select: { slug: true },
            });
            const link = org?.slug
              ? `${env.APP_PUBLIC_URL}/c/${org.slug}/login`
              : `${env.APP_PUBLIC_URL}/c/contratos`;
            const firstName = (cust.name ?? "Cliente").split(" ")[0];
            await this.notifications.notify({
              organizationId: acc.organizationId,
              storeId: cust.storeId,
              customerId: acc.primaryCustomerId,
              whatsappPhone: cust.whatsappPhone ?? cust.phone ?? null,
              email: cust.email ?? null,
              subject: "Contrato para assinatura",
              text: `Olá ${firstName}! Você tem um contrato para assinar. Acesse seu portal: ${link}`,
              templateCode: "contrato_assinatura",
            }).catch(() => undefined);
          }
        }
        return created;
      },
    );
  }

  /** Lista contratos de uma conta de crediario (usado pelo portal + admin). */
  async listByAccount(creditAccountId: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.contract.findMany({
        where: { creditAccountId },
        orderBy: { createdAt: "desc" },
        include: { template: true },
      }),
    );
  }

  /**
   * Todos os contratos visíveis pro cliente no portal: ligados ao customerId
   * OU à conta de crediário dele (cobre avulsos + crediário).
   */
  async listForCustomer(customerId: string | null, creditAccountId: string | null) {
    const or: any[] = [];
    if (customerId) or.push({ customerId });
    if (creditAccountId) or.push({ creditAccountId });
    if (or.length === 0) return [];
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.contract.findMany({
        where: { OR: or },
        orderBy: { createdAt: "desc" },
        include: { template: true },
      }),
    );
  }

  /** Assinatura biometrica pelo portal do cliente. */
  async signBiometric(opts: {
    contractId: string;
    creditAccountId?: string | null;
    customerId?: string | null;
    signatureImageUrl: string;
    selfieUrl?: string | null;
    fieldValues?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const c = await tx.contract.findFirst({
        where: { id: opts.contractId },
        include: { template: true },
      });
      if (!c) throw new AppError(ErrorCode.NotFound, "Contrato nao encontrado", 404);
      // o contrato precisa pertencer ao cliente (pela conta OU pelo customerId)
      const owns =
        (opts.creditAccountId && c.creditAccountId === opts.creditAccountId) ||
        (opts.customerId && c.customerId === opts.customerId);
      if (!owns) throw new AppError(ErrorCode.Forbidden, "Contrato de outro cliente", 403);
      if (c.status === "signed") {
        throw new AppError(ErrorCode.Conflict, "Contrato ja assinado", 409);
      }
      if (c.template.biometricRequired && !opts.selfieUrl) {
        throw new AppError(ErrorCode.ValidationFailed, "Selfie obrigatoria", 400);
      }

      // variáveis do sistema (empresa/cliente/crediário/data) — campos do
      // formulário têm precedência sobre elas
      const acc = c.creditAccountId
        ? await tx.creditAccount.findUnique({ where: { id: c.creditAccountId } })
        : null;
      const org = acc ? await tx.organization.findUnique({ where: { id: acc.organizationId }, select: { name: true, document: true } }) : null;
      const cust = acc?.primaryCustomerId
        ? await tx.customer.findUnique({ where: { id: acc.primaryCustomerId } })
        : null;
      const sv = {
        "empresa.nome": org?.name ?? "",
        "empresa.documento": fmtDoc(org?.document),
        "cliente.nome": cust?.name ?? acc?.holderName ?? "",
        "cliente.cpf": fmtDoc(acc?.document ?? cust?.document),
        "cliente.endereco": [cust?.addressLine, cust?.addressNumber, cust?.neighborhood, cust?.city, cust?.state]
          .filter(Boolean).join(", "),
        "cliente.telefone": cust?.whatsappPhone ?? cust?.phone ?? "",
        "cliente.email": cust?.email ?? "",
        "crediario.limite": brlCents(acc?.limitCents),
        "data.hoje": new Date().toLocaleDateString("pt-BR"),
      };
      const merged = { ...sv, ...((c.fieldValues as any) ?? {}), ...(opts.fieldValues ?? {}) };
      const rendered = renderMarkdown(c.template.bodyMarkdown, merged);

      return tx.contract.update({
        where: { id: c.id },
        data: {
          status: "signed",
          signedAt: new Date(),
          signedVia: "portal",
          signatureImageUrl: opts.signatureImageUrl,
          selfieUrl: opts.selfieUrl ?? null,
          fieldValues: merged as any,
          renderedBodyMarkdown: rendered,
          signerIp: opts.ip ?? null,
          signerUserAgent: opts.userAgent ?? null,
        },
      });
    });
  }

  /** True se a conta tem contrato de crediario assinado. */
  async hasSignedCreditContract(creditAccountId: string): Promise<boolean> {
    const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.contract.findFirst({
        where: { creditAccountId, status: "signed" },
        include: { template: true },
      }),
    );
    return !!c && c.template.kind === "credit";
  }

  // ============================== CONTRACTS ==============================

  async listContracts(ctx: RequestContext) {
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.contract.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            template: { select: { id: true, slug: true, title: true, signatureMode: true } },
          },
        }),
    );
  }

  async getContract(ctx: RequestContext, id: string) {
    const c = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.contract.findUnique({
          where: { id },
          include: { template: true },
        }),
    );
    if (!c) throw new AppError(ErrorCode.NotFound, "Contrato nao encontrado", 404);
    return c;
  }

  async createContract(ctx: RequestContext, input: CreateContractInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode criar contrato", 403);
    }
    const orgId = ctx.isPlatformAdmin
      ? (input.organizationId ?? null)
      : ctx.orgId;
    if (!ctx.isPlatformAdmin && !orgId) {
      throw new AppError(ErrorCode.ValidationFailed, "Sem org no contexto", 400);
    }

    const template = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.contractTemplate.findUnique({ where: { id: input.templateId } }),
    );
    if (!template) {
      throw new AppError(ErrorCode.NotFound, "Template nao existe", 404);
    }
    if (
      template.organizationId !== null &&
      template.organizationId !== orgId &&
      !ctx.isPlatformAdmin
    ) {
      throw new AppError(ErrorCode.Forbidden, "Template fora da sua org", 403);
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86400_000)
      : new Date(Date.now() + 30 * 86400_000); // padrao 30 dias

    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        // vincula ao cliente: explícito ou casando pelo documento do signatário
        // (assim QUALQUER contrato do cliente aparece no portal dele)
        let customerId = input.customerId ?? null;
        if (!customerId && orgId && input.signerDocument) {
          const doc = input.signerDocument.replace(/\D/g, "");
          if (doc.length >= 11) {
            const m = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM customers
               WHERE organization_id = ${orgId}::uuid AND deleted_at IS NULL
                 AND regexp_replace(coalesce(document,''), '[^0-9]', '', 'g') = ${doc}
               ORDER BY created_at ASC LIMIT 1`;
            customerId = m[0]?.id ?? null;
          }
        }
        return tx.contract.create({
          data: {
            templateId: input.templateId,
            organizationId: orgId,
            storeId: input.storeId ?? null,
            customerId,
            signerEmail: input.signerEmail ?? null,
            signerName: input.signerName ?? null,
            signerDocument: input.signerDocument ?? null,
            signerPhone: input.signerPhone ?? null,
            fieldValues: (input.fieldValues ?? {}) as any,
            signerToken: token,
            tokenExpiresAt: expiresAt,
            status: "sent",
            sentAt: new Date(),
            createdByPlatformUserId: ctx.platformUserId ?? null,
            createdByUserId: ctx.userId ?? null,
          },
        });
      },
    );
  }

  // ====== publico: ler por token (sem auth) e assinar ======

  async getByToken(token: string) {
    const c = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.contract.findUnique({
          where: { signerToken: token },
          include: { template: true },
        }),
    );
    if (!c) throw new AppError(ErrorCode.NotFound, "Token invalido", 404);
    if (c.tokenExpiresAt && c.tokenExpiresAt < new Date()) {
      throw new AppError(ErrorCode.Forbidden, "Token expirado", 403);
    }
    return c;
  }

  async sign(input: SignContractInput) {
    const c = await this.getByToken(input.token);
    if (c.status === "signed") {
      throw new AppError(ErrorCode.Conflict, "Contrato ja assinado", 409);
    }
    if (c.status === "cancelled" || c.status === "expired") {
      throw new AppError(ErrorCode.Forbidden, `Contrato ${c.status}`, 403);
    }

    const org = c.organizationId
      ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.organization.findUnique({ where: { id: c.organizationId! }, select: { name: true, document: true } }))
      : null;
    const sv = {
      "empresa.nome": org?.name ?? "",
      "empresa.documento": fmtDoc(org?.document),
      "cliente.nome": input.signerName ?? c.signerName ?? "",
      "cliente.cpf": fmtDoc(input.signerDocument ?? c.signerDocument),
      "cliente.email": input.signerEmail ?? c.signerEmail ?? "",
      "cliente.telefone": input.signerPhone ?? c.signerPhone ?? "",
      "data.hoje": new Date().toLocaleDateString("pt-BR"),
    };
    const merged = { ...sv, ...((c.fieldValues as any) ?? {}), ...input.fieldValues };
    const rendered = renderMarkdown(c.template.bodyMarkdown, merged);

    return this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.contract.update({
          where: { id: c.id },
          data: {
            fieldValues: merged as any,
            renderedBodyMarkdown: rendered,
            signerName: input.signerName,
            signerEmail: input.signerEmail,
            signerDocument: input.signerDocument ?? c.signerDocument,
            signerPhone: input.signerPhone ?? c.signerPhone,
            signatureImageUrl: input.signatureImageUrl ?? null,
            signerIp: input.ip ?? null,
            signerUserAgent: input.userAgent ?? null,
            signedAt: new Date(),
            status: "signed",
            signerToken: null, // queima o token apos assinatura
          },
        }),
    );
  }

  /**
   * Gera o HTML standalone do contrato, com o branding da empresa
   * (logo + cor principal), pronto pra imprimir/baixar preservando o design.
   */
  async renderHtml(ctx: RequestContext, id: string): Promise<string> {
    const c = await this.getContract(ctx, id);
    const body =
      c.renderedBodyMarkdown ??
      renderMarkdown(c.template.bodyMarkdown, (c.fieldValues as any) ?? {});

    // branding da empresa dona do contrato (se houver)
    let brand: { name: string; logoUrl: string | null; primaryColor: string | null } = {
      name: c.template.title,
      logoUrl: null,
      primaryColor: null,
    };
    if (c.organizationId) {
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findUnique({
          where: { id: c.organizationId! },
          select: { name: true, logoUrl: true, primaryColor: true },
        }),
      );
      if (org) {
        brand = {
          name: org.name,
          logoUrl: org.logoUrl,
          primaryColor: org.primaryColor,
        };
      }
    }

    return buildContractHtml({
      contractId: c.id,
      title: c.template.title,
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      primaryColor: brand.primaryColor ?? "#7c3aed",
      bodyHtml: markdownToHtml(body),
      signerName: c.signerName,
      signerDocument: c.signerDocument,
      signedAt: c.signedAt,
      signatureImageUrl: c.signatureImageUrl,
      signerIp: (c as any).signerIp ?? null,
      status: c.status,
    });
  }

  /**
   * Renderiza o HTML do contrato pro próprio cliente baixar/imprimir do portal.
   * Valida que o contrato pertence ao cliente (ou à sua conta de crediário).
   */
  async renderHtmlForCustomer(
    customerId: string | null,
    creditAccountId: string | null,
    contractId: string,
  ): Promise<string> {
    const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.contract.findFirst({
        where: {
          id: contractId,
          OR: [
            ...(customerId ? [{ customerId }] : []),
            ...(creditAccountId ? [{ creditAccountId }] : []),
          ],
        },
        include: { template: true },
      }),
    );
    if (!c) throw new AppError(ErrorCode.NotFound, "Contrato não encontrado", 404);

    const body =
      c.renderedBodyMarkdown ??
      renderMarkdown(c.template.bodyMarkdown, (c.fieldValues as any) ?? {});

    let brand: { name: string; logoUrl: string | null; primaryColor: string | null } = {
      name: c.template.title, logoUrl: null, primaryColor: null,
    };
    if (c.organizationId) {
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findUnique({
          where: { id: c.organizationId! },
          select: { name: true, logoUrl: true, primaryColor: true },
        }),
      );
      if (org) brand = { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor };
    }

    return buildContractHtml({
      contractId: c.id,
      title: c.template.title,
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      primaryColor: brand.primaryColor ?? "#7c3aed",
      bodyHtml: markdownToHtml(body),
      signerName: c.signerName,
      signerDocument: c.signerDocument,
      signedAt: c.signedAt,
      signatureImageUrl: c.signatureImageUrl,
      signerIp: (c as any).signerIp ?? null,
      status: c.status,
    });
  }

  /** HTML do contrato pra página pública de assinatura (preview formatado). */
  async renderHtmlByToken(token: string): Promise<string> {
    const c = await this.getByToken(token);
    const body =
      c.renderedBodyMarkdown ??
      renderMarkdown(c.template.bodyMarkdown, (c.fieldValues as any) ?? {});

    let brand: { name: string; logoUrl: string | null; primaryColor: string | null } = {
      name: c.template.title, logoUrl: null, primaryColor: null,
    };
    if (c.organizationId) {
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findUnique({
          where: { id: c.organizationId! },
          select: { name: true, logoUrl: true, primaryColor: true },
        }),
      );
      if (org) brand = { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor };
    }

    return buildContractHtml({
      contractId: c.id,
      title: c.template.title,
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      primaryColor: brand.primaryColor ?? "#7c3aed",
      bodyHtml: markdownToHtml(body),
      signerName: c.signerName,
      signerDocument: c.signerDocument,
      signedAt: c.signedAt,
      signatureImageUrl: c.signatureImageUrl,
      signerIp: (c as any).signerIp ?? null,
      status: c.status,
    });
  }

  async cancel(ctx: RequestContext, id: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      (tx) =>
        tx.contract.update({
          where: { id },
          data: { status: "cancelled", signerToken: null },
        }),
    );
  }
}

function renderMarkdown(body: string, values: Record<string, unknown>): string {
  // aceita chaves com ponto (ex.: cliente.nome, empresa.documento)
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const v = values[key];
    if (v === undefined || v === null || v === "") return `{{${key}}}`;
    return String(v);
  });
}

/** Formata documento (CPF/CNPJ) com máscara a partir dos dígitos. */
function fmtDoc(doc?: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc ?? "";
}
function brlCents(c: unknown): string {
  return (Number(c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Conversor markdown -> HTML minimalista e seguro (sem libs): titulos,
 * negrito, italico, listas e paragrafos. Tudo escapado antes de aplicar
 * a formatacao inline.
 */
/**
 * Remove o que é perigoso de um HTML autoral (script/style/iframe/handlers/js:),
 * deixando passar formatação e layout (tabelas, divs, imagens, etc.). Usado pra
 * permitir HTML no corpo do modelo sem abrir brecha de XSS no documento servido.
 */
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

/**
 * Renderiza o corpo do modelo: aceita HTML (sanitizado) E Markdown.
 * - Linhas que já são HTML (começam com <tag>) passam direto.
 * - Senão, aplica Markdown: # títulos, **negrito**, *itálico*, - listas.
 */
function markdownToHtml(md: string): string {
  const src = sanitizeHtml(md);
  // Se o modelo é HTML autoral (traz <style>, tabelas, blocos de layout ou
  // documento completo), NÃO processa linha-a-linha — isso quebraria o CSS
  // dentro de <style> (cada regra viraria <p>). Passa o HTML já sanitizado.
  if (/<\s*(style|table|img|!doctype|html|head|body|section|article|main|div)\b/i.test(src)) {
    return src;
  }
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  // NÃO escapa: deixa o HTML do autor passar (já foi sanitizado acima).
  const inline = (t: string) =>
    t
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>");
  const looksHtml = (l: string) => /^<\/?[a-zA-Z]/.test(l.trim());

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (looksHtml(line)) {
      // a linha já é HTML (tabela, div, img...) → passa como está (sanitizado)
      closeList();
      out.push(line);
    } else if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#{1,6}\s+/, "");
      out.push(`<h${level}>${inline(text)}</h${level}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

function buildContractHtml(opts: {
  contractId?: string;
  title: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  bodyHtml: string;
  signerName: string | null;
  signerDocument: string | null;
  signedAt: Date | null;
  signatureImageUrl: string | null;
  signerIp?: string | null;
  status: string;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.primaryColor) ? opts.primaryColor : "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.brandName)}" class="logo" />`
    : `<div class="brand-name">${escapeHtml(opts.brandName)}</div>`;

  // código de verificação curto a partir do id do contrato
  const verifyCode = opts.contractId
    ? opts.contractId.replace(/-/g, "").slice(0, 12).toUpperCase()
    : null;

  const signatureBlock =
    opts.status === "signed"
      ? `<div class="signature">
          ${opts.signatureImageUrl ? `<img src="${escapeHtml(opts.signatureImageUrl)}" alt="assinatura" class="sig-img" />` : ""}
          <div class="sig-line"></div>
          <p class="sig-name">${escapeHtml(opts.signerName ?? "")}</p>
          ${opts.signerDocument ? `<p class="sig-doc">Doc.: ${escapeHtml(opts.signerDocument)}</p>` : ""}
          ${opts.signedAt ? `<p class="sig-date">Assinado em ${new Date(opts.signedAt).toLocaleString("pt-BR")}</p>` : ""}
        </div>`
      : `<div class="signature">
          <div class="sig-line"></div>
          <p class="sig-name">${escapeHtml(opts.signerName ?? "Assinatura")}</p>
          ${opts.signerDocument ? `<p class="sig-doc">Doc.: ${escapeHtml(opts.signerDocument)}</p>` : ""}
        </div>`;

  // selo de assinatura digital (só quando assinado)
  const sealBlock =
    opts.status === "signed"
      ? `<div class="seal">
          <div class="seal-badge">✓ ASSINADO DIGITALMENTE</div>
          <div class="seal-info">
            ${opts.signedAt ? `<p>Data/hora: <strong>${new Date(opts.signedAt).toLocaleString("pt-BR")}</strong></p>` : ""}
            ${verifyCode ? `<p>Código de verificação: <strong>${verifyCode}</strong></p>` : ""}
            ${opts.signerIp ? `<p>IP de origem: <strong>${escapeHtml(opts.signerIp)}</strong></p>` : ""}
            <p class="seal-legal">Assinatura eletrônica com validade legal (Lei 14.063/2020 / MP 2.200-2/2001).</p>
          </div>
        </div>`
      : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { --c: ${color}; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; line-height: 1.6; margin: 0; background: #f5f5f5; }
  .page { max-width: 760px; margin: 24px auto; background: #fff; padding: 56px 64px; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
  header.brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid var(--c); padding-bottom: 16px; margin-bottom: 32px; }
  .logo { max-height: 56px; max-width: 240px; object-fit: contain; }
  .brand-name { font-size: 22px; font-weight: 700; color: var(--c); }
  .status-tag { font-family: Arial, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #fff; background: var(--c); padding: 4px 10px; border-radius: 999px; }
  h1,h2,h3,h4 { color: var(--c); font-family: Arial, sans-serif; }
  h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 15px; }
  p { margin: 0 0 12px; }
  ul { margin: 0 0 12px 20px; }
  .signature { margin-top: 64px; }
  .sig-img { max-height: 90px; display: block; margin-bottom: 4px; }
  .sig-line { border-top: 1px solid #333; width: 320px; margin-top: 8px; }
  .sig-name { font-weight: 700; margin: 6px 0 0; }
  .sig-doc, .sig-date { font-family: Arial, sans-serif; font-size: 12px; color: #555; margin: 2px 0 0; }
  .seal { font-family: Arial, sans-serif; margin-top: 40px; border: 2px dashed var(--c); border-radius: 12px; padding: 14px 18px; background: rgba(124,58,237,.04); }
  .seal-badge { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #fff; background: var(--c); padding: 4px 12px; border-radius: 999px; }
  .seal-info { margin-top: 8px; font-size: 12px; color: #444; }
  .seal-info p { margin: 2px 0; }
  .seal-legal { margin-top: 6px !important; font-style: italic; color: #777; }
  .toolbar { font-family: Arial, sans-serif; text-align: center; padding: 12px; }
  .toolbar button { background: var(--c); color: #fff; border: 0; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; padding: 24px 32px; } .toolbar { display: none; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header class="brand">
      ${header}
      <span class="status-tag">${escapeHtml(opts.status)}</span>
    </header>
    <article>${opts.bodyHtml}</article>
    ${signatureBlock}
    ${sealBlock}
  </div>
</body>
</html>`;
}
