import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { orgBaseUrl } from "../common/org-url";

const ADM = { isPlatformAdmin: true as const };

export interface CreateLicenseInput {
  externalRef: string;
  plan?: string | null;
  cycle?: "monthly" | "annual" | "trial" | null;
  customer: { fullName: string; email?: string | null; phone?: string | null; document?: string | null };
  seller?: { name?: string | null; email?: string | null } | null;
}

@Injectable()
export class NortyLicenseService {
  private readonly logger = new Logger("NortyLicense");
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly subs: SubscriptionsService,
  ) {}

  me() {
    return { system: process.env.NORTY_SYSTEM_NAME || "Norty Vision", ok: true };
  }

  private slugify(s: string): string {
    return (s || "")
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "empresa";
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name).slice(0, 28);
    for (let i = 0; i < 30; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`.slice(0, 40);
      const ex = await this.prisma.runWithContext(ADM, (tx) => tx.organization.findUnique({ where: { slug }, select: { id: true } })).catch(() => null);
      if (!ex) return slug;
    }
    return `${base}-${randomBytes(2).toString("hex")}`;
  }

  /** Código de licença legível (mostrado ao cliente): NV-XXXX-XXXX-XXXX.
   *  Alfabeto sem caracteres ambíguos (0/O, 1/I). */
  private licenseCode(): string {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const b = randomBytes(12);
    let s = "";
    for (let i = 0; i < 12; i++) s += A[b[i] % A.length];
    return `NV-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  }

  private expiryFor(cycle?: string | null): Date | null {
    const now = Date.now();
    if (cycle === "trial") return new Date(now + 7 * 86400_000);
    if (cycle === "annual") return new Date(now + 365 * 86400_000);
    if (cycle === "monthly") return new Date(now + 31 * 86400_000);
    return null;
  }

  private resp(l: any) {
    return { licenseId: l.id, licenseKey: l.licenseKey, accessUrl: l.accessUrl, status: l.status, expiresAt: l.expiresAt };
  }

  /** Cria/ativa licença. Idempotente por externalRef. Provisiona a empresa
   *  (tenant) reaproveitando o fluxo de criação de org + plano. */
  async createLicense(input: CreateLicenseInput) {
    if (!input.externalRef?.trim()) throw new AppError(ErrorCode.ValidationFailed, "externalRef obrigatório", 400);
    if (!input.customer?.fullName?.trim()) throw new AppError(ErrorCode.ValidationFailed, "customer.fullName obrigatório", 400);

    const externalRef = input.externalRef.trim();
    const found = await this.prisma.runWithContext(ADM, (tx) => tx.nortyLicense.findUnique({ where: { externalRef } })).catch(() => null);
    if (found) return this.resp(found);

    const slug = await this.uniqueSlug(input.customer.fullName);
    const email = (input.customer.email || `${slug}@vision.norty.com.br`).toLowerCase().trim();
    const tempPass = "Nv" + randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) + "9x";
    const licenseKey = this.licenseCode();
    const accessUrl = orgBaseUrl(slug);
    const expiresAt = this.expiryFor(input.cycle);

    let organizationId: string | null = null;
    let lastError: string | null = null;
    try {
      const created = await this.orgs.create({
        platformUserId: "norty-license",
        input: {
          slug,
          name: input.customer.fullName.trim(),
          contactEmail: input.customer.email ?? email,
          contactPhone: input.customer.phone ?? null,
          firstUser: { email, name: input.customer.fullName.trim(), password: tempPass },
          firstStore: { slug: "matriz", name: input.customer.fullName.trim(), city: null, state: null },
          autoProvision: false,
        } as any,
      });
      organizationId = created.organization.id;
      if (input.plan) {
        await this.subs.assignPlan({ organizationId, planSlug: input.plan }).catch((e: any) => this.logger.warn(`assignPlan falhou: ${e?.message}`));
      }
    } catch (e: any) {
      lastError = String(e?.message ?? e).slice(0, 500);
      this.logger.error(`provisionamento da licença ${externalRef} falhou: ${lastError}`);
    }

    const lic = await this.prisma.runWithContext(ADM, (tx) => tx.nortyLicense.create({
      data: {
        externalRef, organizationId, licenseKey, status: organizationId ? "ACTIVE" : "PENDING",
        planKey: input.plan ?? null, cycle: input.cycle ?? null, accessUrl,
        customerName: input.customer.fullName.trim(), customerEmail: input.customer.email ?? null,
        customerPhone: input.customer.phone ?? null, customerDocument: input.customer.document ?? null,
        sellerName: input.seller?.name ?? null, sellerEmail: input.seller?.email ?? null,
        expiresAt, lastError,
      },
    }));
    return this.resp(lic);
  }

  async getLicense(id: string) {
    const l = await this.prisma.runWithContext(ADM, (tx) => tx.nortyLicense.findFirst({ where: { OR: [{ id }, { externalRef: id }] } })).catch(() => null);
    if (!l) throw new AppError(ErrorCode.NotFound, "Licença não encontrada", 404);
    return { licenseId: l.id, status: l.status };
  }

  /** SUSPENDED (inadimplência) | ACTIVE (reativa) | CANCELED (fim de contrato).
   *  Bloqueia/reativa o acesso da empresa sem apagar dados. */
  async setStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "CANCELED") {
    const l = await this.prisma.runWithContext(ADM, (tx) => tx.nortyLicense.findFirst({ where: { OR: [{ id }, { externalRef: id }] } })).catch(() => null);
    if (!l) throw new AppError(ErrorCode.NotFound, "Licença não encontrada", 404);
    const orgStatus = status === "ACTIVE" ? "active" : "suspended"; // canceled/suspended → bloqueia acesso, mantém dados
    if (l.organizationId) {
      await this.prisma.runWithContext(ADM, (tx) => tx.organization.update({ where: { id: l.organizationId! }, data: { status: orgStatus } })).catch((e: any) => this.logger.warn(`update org status: ${e?.message}`));
    }
    const updated = await this.prisma.runWithContext(ADM, (tx) => tx.nortyLicense.update({ where: { id: l.id }, data: { status } }));
    return { licenseId: updated.id, status: updated.status };
  }

  /** Catálogo de planos que o Norty revende (planos ativos do sistema). */
  async plans() {
    const rows = await this.prisma.runWithContext(ADM, (tx) => tx.plan.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } })).catch(() => [] as any[]);
    const iv = (interval: string): string => {
      const v = (interval || "").toLowerCase();
      if (v.startsWith("year") || v === "annual" || v === "anual") return "YEARLY";
      if (v.startsWith("quarter") || v === "trimestral") return "QUARTERLY";
      return "MONTHLY";
    };
    return rows.map((p) => ({ key: p.slug, name: p.name, price: Math.round((p.priceCents ?? 0)) / 100, interval: iv(p.interval), active: p.isActive }));
  }
}
