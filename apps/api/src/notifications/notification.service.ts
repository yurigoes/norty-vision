import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";
import { normalizeWhatsappBR } from "../common/phone";
import { EmailService } from "./email.service";
import { renderTemplate, buildBrandedEmail, type TemplateCategory } from "./template-render";

/**
 * NotificationService — dispara mensagens ao cliente final por WhatsApp
 * (Evolution, instance da loja) e Email (SMTP). Usado pelo modulo de
 * pagamentos: toda transacao/tentativa notifica o cliente.
 *
 * Best-effort: falha de canal nao quebra o fluxo (so loga). Toda mensagem
 * enviada e gravada em message_log pra auditoria.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger("Notification");

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Notifica por WhatsApp + Email. Pelo menos um destino deve existir.
   */
  async notify(opts: {
    organizationId: string;
    storeId: string;
    customerId?: string | null;
    whatsappPhone?: string | null;
    email?: string | null;
    subject: string;
    text: string;          // texto plano (WhatsApp + fallback email)
    html?: string;         // html do email (opcional)
    templateCode?: string;
    // variáveis pra substituir {{chave}} no modelo da empresa (se houver modelo p/ o templateCode)
    variables?: Record<string, string | number | null | undefined>;
    // instância Evolution específica (call center multi-número). Se ausente, usa
    // a PRINCIPAL = slug da org (que faz todas as notificações).
    instanceName?: string | null;
    // anexo opcional (ex.: nota fiscal). No WhatsApp vai como documento/imagem;
    // no email entra como link no corpo (best-effort).
    media?: { url: string; fileName?: string; mediatype?: "image" | "video" | "document" | "audio" };
  }): Promise<{ whatsapp: boolean; email: boolean }> {
    const result = { whatsapp: false, email: false };

    // ---- Modelo editável da empresa (aba Mensagens): se houver para o templateCode,
    // sobrepõe o texto/HTML padrão (que vira o fallback). E-mail sai com branding.
    const vars = opts.variables ?? {};
    let waText = opts.text;
    let emailSubject = opts.subject;
    let emailHtml = opts.html ?? null;
    let emailCategory: TemplateCategory = "info";
    let usedEmailTemplate = false;
    let brand: { name: string; logoUrl: string | null } = { name: "", logoUrl: null };
    try {
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findFirst({ where: { id: opts.organizationId }, select: { name: true, logoUrl: true } }),
      );
      brand = { name: org?.name ?? "Empresa", logoUrl: org?.logoUrl ?? null };
      if (opts.templateCode) {
        const tpls = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.messageTemplate.findMany({ where: { organizationId: opts.organizationId, code: opts.templateCode!, isActive: true } }),
        );
        const wa = tpls.find((t) => t.channel === "whatsapp");
        if (wa) waText = renderTemplate(wa.body, vars);
        const em = tpls.find((t) => t.channel === "email");
        if (em) {
          usedEmailTemplate = true;
          emailSubject = renderTemplate(em.subject || em.name, vars) || opts.subject;
          emailCategory = (em.category as TemplateCategory) ?? "info";
          emailHtml = buildBrandedEmail({ bodyHtml: renderTemplate(escapeHtml(em.body), vars).replace(/\n/g, "<br/>"), category: emailCategory, brandName: brand.name, logoUrl: brand.logoUrl });
        }
      }
    } catch (e: any) { this.logger.warn(`template resolve falhou: ${e?.message}`); }

    // ---- WhatsApp via Evolution (instance da loja) ----
    if (opts.whatsappPhone) {
      try {
        const phone = normalizeWhatsappBR(opts.whatsappPhone);
        // a instancia Evolution e por EMPRESA = slug da org
        const orgRows = await this.prisma.runWithContext(
          { isPlatformAdmin: true },
          (tx) =>
            tx.$queryRaw<Array<{ slug: string }>>`
              SELECT slug FROM organizations WHERE id = ${opts.organizationId}::uuid LIMIT 1
            `,
        );
        // instância específica (multi-número do call center) ou a principal (slug)
        const instanceName = (opts.instanceName && opts.instanceName.trim()) || orgRows[0]?.slug;
        const evo = await this.integrations.getByProvider({
          isPlatformAdmin: true,
          provider: "evolution",
        });
        if (instanceName && evo?.baseUrl && evo.apiKey) {
          const adapter = new EvolutionAdapter({
            baseUrl: evo.baseUrl,
            apiKey: evo.apiKey,
          });
          const r = await adapter.sendText({ instanceName, number: phone, text: waText });
          result.whatsapp = r.ok;
          if (!r.ok) {
            // Em produção esse warn era a única pista do "não envia": antes o erro
            // do Evolution sumia silenciosamente porque só observávamos `r.ok`.
            const detail = typeof r.rawBody === "string" ? r.rawBody.slice(0, 300) : JSON.stringify(r.rawBody).slice(0, 300);
            this.logger.warn(`evolution sendText falhou instance=${instanceName} phone=${phone} status=${r.status} err=${r.error} body=${detail}`);
          }
          // anexo: ÁUDIO/voz vai pelo endpoint próprio (sendMedia falha p/ voz);
          // imagem/vídeo/documento vão pelo sendMedia.
          if (opts.media?.url) {
            if (opts.media.mediatype === "audio") {
              await adapter.sendWhatsAppAudio({ instanceName, number: phone, audioUrl: opts.media.url }).catch(() => undefined);
            } else {
              await adapter.sendMedia({
                instanceName,
                number: phone,
                mediaUrl: opts.media.url,
                mediatype: (opts.media.mediatype as any) ?? "document",
                fileName: opts.media.fileName,
                caption: "",
              }).catch(() => undefined);
            }
          }
          await this.logMessage({
            organizationId: opts.organizationId,
            storeId: opts.storeId,
            customerId: opts.customerId,
            channel: "whatsapp",
            toAddress: phone,
            body: waText,
            templateCode: opts.templateCode,
            status: r.ok ? "sent" : "failed",
          });
        }
      } catch (e: any) {
        this.logger.warn(`whatsapp falhou: ${e?.message}`);
      }
    }

    // ---- Email via SMTP ----
    if (opts.email) {
      try {
        // envia pelo SMTP da propria empresa (fallback master, em nome da empresa)
        const mediaLink = opts.media?.url
          ? `<p style="margin-top:12px"><a href="${opts.media.url}" target="_blank" rel="noopener">Baixar arquivo${opts.media.fileName ? ` (${escapeHtml(opts.media.fileName)})` : ""}</a></p>`
          : "";
        // HTML final: modelo da empresa (já branded) > html cru do chamador > texto plano embrulhado no branding.
        const baseHtml = usedEmailTemplate
          ? emailHtml!
          : (emailHtml ?? buildBrandedEmail({ bodyHtml: `<p>${escapeHtml(opts.text).replace(/\n/g, "<br/>")}</p>`, category: emailCategory, brandName: brand.name, logoUrl: brand.logoUrl }));
        await this.email.sendForOrg(opts.organizationId, {
          to: opts.email,
          subject: emailSubject,
          html: baseHtml + mediaLink,
          text: opts.text + (opts.media?.url ? `\n\nBaixar: ${opts.media.url}` : ""),
        });
        result.email = true;
        await this.logMessage({
          organizationId: opts.organizationId,
          storeId: opts.storeId,
          customerId: opts.customerId,
          channel: "email",
          toAddress: opts.email,
          body: opts.text,
          templateCode: opts.templateCode,
          status: "sent",
        });
      } catch (e: any) {
        this.logger.warn(`email falhou: ${e?.message}`);
      }
    }

    return result;
  }

  private async logMessage(opts: {
    organizationId: string;
    storeId: string;
    customerId?: string | null;
    channel: string;
    toAddress: string;
    body: string;
    templateCode?: string;
    status: string;
  }) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        INSERT INTO message_log (
          organization_id, store_id, direction, channel, customer_id,
          to_address, template_code, body, status, sent_at
        ) VALUES (
          ${opts.organizationId}::uuid, ${opts.storeId}::uuid, 'outbound',
          ${opts.channel}, ${opts.customerId ?? null}::uuid,
          ${opts.toAddress}, ${opts.templateCode ?? null}, ${opts.body},
          ${opts.status}, now()
        )
      `,
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
