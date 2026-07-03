import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";

function brl(cents: number | bigint): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const DEFAULT_RULES = [
  { name: "Lembrete 3 dias antes", daysAfterDue: -3, channel: "whatsapp",
    template: "Olá {{nome}}! Sua parcela {{parcela}} de {{valor}} vence em {{vencimento}}. Pague pelo painel pra ficar em dia 💙" },
  { name: "Vencimento hoje", daysAfterDue: 0, channel: "whatsapp",
    template: "Olá {{nome}}, sua parcela {{parcela}} de {{valor}} vence hoje ({{vencimento}}). Acesse seu painel pra pagar via Pix ou cartão." },
  { name: "1 dia de atraso", daysAfterDue: 1, channel: "both",
    template: "Olá {{nome}}, identificamos que a parcela {{parcela}} de {{valor}} venceu ontem. Regularize pelo painel pra evitar juros." },
  { name: "3 dias de atraso", daysAfterDue: 3, channel: "both",
    template: "{{nome}}, sua parcela {{parcela}} está {{dias}} dias em atraso ({{valor}} + encargos). Acesse o painel e regularize, por favor." },
  { name: "7 dias de atraso", daysAfterDue: 7, channel: "both",
    template: "{{nome}}, a parcela {{parcela}} segue em aberto há {{dias}} dias. Evite restrições no seu crediário — regularize hoje pelo painel." },
  { name: "15 dias de atraso", daysAfterDue: 15, channel: "both",
    template: "{{nome}}, sua parcela {{parcela}} está com {{dias}} dias de atraso. Entre em contato ou acesse o painel pra negociar e evitar bloqueio." },
];

@Injectable()
export class DunningService {
  private readonly logger = new Logger("Dunning");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ============================== RULES ==============================
  async listRules(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      let rules = await tx.dunningRule.findMany({
        where: {},
        orderBy: { daysAfterDue: "asc" },
      });
      if (rules.length === 0 && ctx.orgId) {
        // seed defaults na primeira vez
        for (let i = 0; i < DEFAULT_RULES.length; i++) {
          const r = DEFAULT_RULES[i]!;
          await tx.dunningRule.create({
            data: {
              organizationId: ctx.orgId,
              name: r.name,
              daysAfterDue: r.daysAfterDue,
              channel: r.channel,
              templateText: r.template,
              displayOrder: i,
            },
          });
        }
        rules = await tx.dunningRule.findMany({ orderBy: { daysAfterDue: "asc" } });
      }
      return rules;
    });
  }

  async upsertRule(ctx: RequestContext, input: {
    id?: string; name: string; daysAfterDue: number; channel: string; templateText: string; isActive?: boolean;
  }) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id
        ? tx.dunningRule.update({
            where: { id: input.id },
            data: { name: input.name, daysAfterDue: input.daysAfterDue, channel: input.channel, templateText: input.templateText, isActive: input.isActive ?? true },
          })
        : tx.dunningRule.create({
            data: {
              organizationId: ctx.orgId!,
              name: input.name, daysAfterDue: input.daysAfterDue,
              channel: input.channel, templateText: input.templateText,
              isActive: input.isActive ?? true,
            },
          }),
    );
  }

  async timeline(ctx: RequestContext, creditAccountId: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.dunningEvent.findMany({
        where: { creditAccountId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  }

  // ============================== CRON: DUNNING ==============================
  /** Roda pra todas as orgs com parcelas vencidas. Idempotente. */
  async runDailyDunningAllOrgs() {
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ organization_id: string }>>`
        SELECT DISTINCT organization_id FROM credit_installments
         WHERE status IN ('pending','late')
      `,
    );
    for (const o of orgs) {
      try {
        await this.runDailyDunning(o.organization_id);
      } catch (e: any) {
        this.logger.error(`dunning org=${o.organization_id} falhou: ${e?.message}`);
      }
    }
  }

  async runDailyDunning(organizationId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const ctx = { isPlatformAdmin: true as const };

    // regras ativas da org
    const rules = await this.prisma.runWithContext(ctx, (tx) =>
      tx.dunningRule.findMany({ where: { organizationId, isActive: true } }),
    );
    if (rules.length === 0) return;

    // parcelas em aberto (pending/late) com vencimento <= hoje + janela de lembrete
    const horizon = new Date(today.getTime() + 7 * 86400_000); // pega ate +7 pra lembretes
    const installments = await this.prisma.runWithContext(ctx, (tx) =>
      tx.creditInstallment.findMany({
        where: {
          organizationId,
          status: { in: ["pending", "late"] },
          dueDate: { lte: horizon },
        },
        include: { creditAccount: true },
        take: 5000,
      }),
    );

    const cfg = await this.prisma.runWithContext(ctx, (tx) =>
      tx.orgCreditConfig.findUnique({ where: { organizationId } }),
    );
    const autoBlock = cfg?.autoBlockAfterOverdueCount ?? 3;

    const overdueCountByAccount: Record<string, number> = {};

    for (const inst of installments) {
      const due = new Date(inst.dueDate);
      due.setUTCHours(0, 0, 0, 0);
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400_000);

      // marca late se ja venceu e ainda pending
      if (daysOverdue > 0 && inst.status === "pending") {
        await this.prisma.runWithContext(ctx, (tx) =>
          tx.creditInstallment.update({ where: { id: inst.id }, data: { status: "late" } }),
        );
      }
      if (daysOverdue > 0) {
        overdueCountByAccount[inst.creditAccountId] =
          (overdueCountByAccount[inst.creditAccountId] ?? 0) + 1;
      }

      // acha regras que devem disparar: days_after_due == daysOverdue (exato pra
      // lembretes antes; pra atraso, dispara quando cruza o limiar e ainda nao enviou)
      for (const rule of rules) {
        const shouldFire =
          rule.daysAfterDue < 0
            ? daysOverdue === rule.daysAfterDue   // lembrete: dia exato antes
            : daysOverdue >= rule.daysAfterDue;    // atraso: a partir do limiar
        if (!shouldFire) continue;

        // idempotencia: ja enviou essa regra pra essa parcela?
        const already = await this.prisma.runWithContext(ctx, (tx) =>
          tx.dunningEvent.count({ where: { installmentId: inst.id, ruleId: rule.id } }),
        );
        if (already > 0) continue;

        await this.fireRule(organizationId, inst, rule, daysOverdue);
      }
    }

    // bloqueio automatico + status defaulted + notifica admin
    for (const [accountId, count] of Object.entries(overdueCountByAccount)) {
      if (count >= autoBlock) {
        const acc = await this.prisma.runWithContext(ctx, (tx) =>
          tx.creditAccount.findFirst({ where: { id: accountId } }),
        );
        if (acc && acc.status !== "defaulted") {
          await this.prisma.runWithContext(ctx, (tx) =>
            tx.creditAccount.update({ where: { id: accountId }, data: { status: "defaulted" } }),
          );
          await this.prisma.runWithContext(ctx, (tx) =>
            tx.creditAccountEvent.create({
              data: {
                organizationId, creditAccountId: accountId,
                eventType: "defaulted",
                payload: { overdue_count: count } as any,
                actorType: "system",
              },
            }),
          );
          this.logger.warn(`conta ${accountId} marcada defaulted (${count} parcelas vencidas)`);
        }
      }
    }
  }

  private async fireRule(orgId: string, inst: any, rule: any, daysOverdue: number) {
    const ctx = { isPlatformAdmin: true as const };
    const acc = inst.creditAccount;
    // resolve contato
    let contact: any = null;
    const pcId: string | null = acc.primaryCustomerId;
    if (pcId) {
      contact = await this.prisma.runWithContext(ctx, (tx) =>
        tx.customer.findFirst({
          where: { id: pcId },
          select: { id: true, storeId: true, email: true, whatsappPhone: true, phone: true },
        }),
      );
    }

    const msg = rule.templateText
      .replace(/\{\{nome\}\}/g, acc.holderName.split(" ")[0])
      .replace(/\{\{parcela\}\}/g, String(inst.number))
      .replace(/\{\{valor\}\}/g, brl(inst.amountCents))
      .replace(/\{\{vencimento\}\}/g, new Date(inst.dueDate).toLocaleDateString("pt-BR"))
      .replace(/\{\{dias\}\}/g, String(Math.max(0, daysOverdue)));

    let status = "skipped";
    let detail: string | null = "sem contato";
    if (contact?.storeId && (contact.whatsappPhone || contact.phone || contact.email)) {
      const r = await this.notifications.notify({
        organizationId: orgId,
        storeId: contact.storeId,
        customerId: contact.id,
        whatsappPhone: rule.channel !== "email" ? (contact.whatsappPhone ?? contact.phone) : null,
        email: rule.channel !== "whatsapp" ? contact.email : null,
        subject: "Lembrete de parcela",
        text: msg,
        templateCode: "dunning",
      });
      status = r.whatsapp || r.email ? "sent" : "failed";
      detail = `wpp=${r.whatsapp} email=${r.email}`;
    }

    await this.prisma.runWithContext(ctx, (tx) =>
      tx.dunningEvent.create({
        data: {
          organizationId: orgId,
          creditAccountId: acc.id,
          installmentId: inst.id,
          ruleId: rule.id,
          daysOverdue,
          channel: rule.channel,
          message: msg,
          status,
          detail,
        },
      }),
    );
  }

  // ============================== CRON: CARD RETRY ==============================
  /**
   * Reprocessa tentativas de cartao recorrente rejeitadas. Como o retry real
   * acontece no MP (preapproval), aqui notificamos o cliente e escalonamos
   * conforme card_retry_max_attempts / intervals.
   */
  async runCardRetryAllOrgs() {
    const now = new Date();
    const due = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.paymentAttempt.findMany({
        where: { status: "rejected", method: "card_recurring", nextRetryAt: { lte: now } },
        take: 1000,
      }),
    );
    for (const att of due) {
      try {
        await this.processRetry(att);
      } catch (e: any) {
        this.logger.error(`retry attempt=${att.id} falhou: ${e?.message}`);
      }
    }
  }

  private async processRetry(att: any) {
    const ctx = { isPlatformAdmin: true as const };
    const cfg = await this.prisma.runWithContext(ctx, (tx) =>
      tx.orgCreditConfig.findUnique({ where: { organizationId: att.organizationId } }),
    );
    const maxAttempts = cfg?.cardRetryMaxAttempts ?? 3;
    const intervals = (cfg?.cardRetryIntervalsHours as number[]) ?? [1, 24, 72];

    const inst = await this.prisma.runWithContext(ctx, (tx) =>
      tx.creditInstallment.findFirst({
        where: { id: att.installmentId },
        include: { creditAccount: true },
      }),
    );
    if (!inst || inst.status === "paid") {
      // nada a fazer
      await this.prisma.runWithContext(ctx, (tx) =>
        tx.paymentAttempt.update({ where: { id: att.id }, data: { status: "cancelled", nextRetryAt: null } }),
      );
      return;
    }

    const nextNumber = att.attemptNumber + 1;
    const exhausted = nextNumber > maxAttempts;

    // notifica cliente
    const acc = inst.creditAccount;
    let contact: any = null;
    const pcId: string | null = acc.primaryCustomerId;
    if (pcId) {
      contact = await this.prisma.runWithContext(ctx, (tx) =>
        tx.customer.findFirst({
          where: { id: pcId },
          select: { id: true, storeId: true, email: true, whatsappPhone: true, phone: true },
        }),
      );
    }
    if (contact?.storeId) {
      const text = exhausted
        ? `${acc.holderName.split(" ")[0]}, não conseguimos cobrar a parcela ${inst.number} no cartão após ${maxAttempts} tentativas. Acesse seu painel para pagar via Pix ou trocar o cartão.`
        : `${acc.holderName.split(" ")[0]}, a cobrança da parcela ${inst.number} no cartão não foi aprovada. Vamos tentar de novo, mas você já pode regularizar no painel.`;
      await this.notifications.notify({
        organizationId: att.organizationId,
        storeId: contact.storeId,
        customerId: contact.id,
        whatsappPhone: contact.whatsappPhone ?? contact.phone,
        email: contact.email,
        subject: "Pagamento no cartão",
        text,
        templateCode: "card_retry",
      });
    }

    if (exhausted) {
      await this.prisma.runWithContext(ctx, (tx) =>
        tx.paymentAttempt.update({
          where: { id: att.id },
          data: { status: "failed", nextRetryAt: null },
        }),
      );
    } else {
      const hours = intervals[Math.min(nextNumber - 1, intervals.length - 1)] ?? 72;
      await this.prisma.runWithContext(ctx, (tx) =>
        tx.paymentAttempt.update({
          where: { id: att.id },
          data: {
            attemptNumber: nextNumber,
            nextRetryAt: new Date(Date.now() + hours * 3600_000),
          },
        }),
      );
    }
  }
}
