import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email.service";
import type { RequestContext } from "../auth/session.middleware";

const ADMIN = { isPlatformAdmin: true as const };

@Injectable()
export class ContactService {
  private readonly logger = new Logger("Contact");
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Submissão pública do formulário da landing. */
  async submit(input: { name: string; email: string; phone?: string | null; company?: string | null; segment?: string | null; message?: string | null }, ip?: string | null, ua?: string | null) {
    const lead = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.landingContact.create({
        data: {
          name: input.name.trim(), email: input.email.trim().toLowerCase(),
          phone: input.phone ?? null, company: input.company ?? null,
          segment: input.segment ?? null, message: input.message ?? null,
          ip: ip ?? null, userAgent: ua ?? null,
        },
      }),
    );
    // best-effort: avisa o e-mail do dono do SaaS (platform settings)
    try {
      const settings = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.platformSettings.findUnique({ where: { id: 1 }, select: { salesEmail: true, supportEmail: true } }),
      ).catch(() => null);
      const to = settings?.salesEmail || settings?.supportEmail;
      if (to) {
        await this.email.send({
          to,
          subject: `📨 Novo contato no site — ${input.name}`,
          html: `<h2>Novo contato</h2>
            <p><strong>Nome:</strong> ${esc(input.name)}</p>
            <p><strong>Email:</strong> ${esc(input.email)}</p>
            <p><strong>WhatsApp:</strong> ${esc(input.phone ?? "—")}</p>
            <p><strong>Empresa:</strong> ${esc(input.company ?? "—")}</p>
            <p><strong>Segmento:</strong> ${esc(input.segment ?? "—")}</p>
            <p><strong>Mensagem:</strong></p><blockquote>${esc(input.message ?? "").replace(/\n/g, "<br>")}</blockquote>`,
        });
      }
    } catch (e: any) { this.logger.warn(`falha ao notificar contato: ${e?.message}`); }
    return { ok: true, id: lead.id };
  }

  // ---- master ----
  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
  }

  async list(ctx: RequestContext, status?: string) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.landingContact.findMany({ where: { ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 500 }),
    );
  }

  async update(ctx: RequestContext, id: string, input: { status?: string; notes?: string | null }) {
    this.requireMaster(ctx);
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes;
    return this.prisma.runWithContext(ADMIN, (tx) => tx.landingContact.update({ where: { id }, data }));
  }
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
