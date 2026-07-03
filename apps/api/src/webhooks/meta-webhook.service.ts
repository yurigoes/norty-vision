import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InboxService } from "../inbox/inbox.service";
import { CrmService } from "../crm/crm.service";
import { MetaAdapter } from "../integrations/adapters/meta.adapter";

/**
 * Webhook do WhatsApp Cloud API (Meta). Lado de ENTRADA da central de leads.
 *
 * Fluxo:
 *  GET  /api/webhooks/meta  -> verificação (hub.challenge) na hora de assinar.
 *  POST /api/webhooks/meta  -> mensagens. Valida a assinatura (App Secret),
 *    resolve a loja pelo phone_number_id, e alimenta o MESMO captureInbound()
 *    do CRM (migration 172) + a inbox omnichannel — igual ao canal Evolution.
 *
 * A IA de auto-resposta NÃO age aqui ainda (chave META_AI_AUTOREPLY, default OFF):
 * primeiro garantimos a captação confiável; a qualificação automática entra
 * num próximo passo, testada, usando OrgAiService + MetaAdapter.sendText.
 */
@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger("MetaWebhook");

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly crm: CrmService,
    private readonly meta: MetaAdapter,
  ) {}

  /** Verificação do webhook (Meta chama com GET ao assinar). Devolve o desafio
   *  se o token bater, senão null (controller responde 403). */
  verifyChallenge(query: Record<string, any>): string | null {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];
    const expected = process.env.META_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected) {
      return String(challenge ?? "");
    }
    this.logger.warn("verify token inválido no webhook Meta");
    return null;
  }

  /** Processa o POST do webhook. Best-effort: nunca lança (não quebra o callback). */
  async handle(raw: Buffer, signature?: string | null): Promise<void> {
    try {
      if (!MetaAdapter.verifySignature(raw, signature)) {
        this.logger.warn("POST Meta rejeitado: assinatura inválida");
        return;
      }
      const body = JSON.parse(raw.toString("utf8"));
      if (body?.object !== "whatsapp_business_account") return;

      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== "messages") continue;
          const value = change.value ?? {};
          const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
          const store = await this.resolveStore(phoneNumberId);
          if (!store) {
            this.logger.warn(`sem loja pro phone_number_id=${phoneNumberId}`);
            continue;
          }
          const contactName: string | null = value?.contacts?.[0]?.profile?.name ?? null;

          for (const msg of value.messages ?? []) {
            // só mensagens recebidas do cliente (statuses são tratados à parte)
            const from: string = msg?.from ?? "";
            const waMessageId: string = msg?.id ?? "";
            if (!from || !waMessageId) continue;
            const text = this.extractText(msg);

            // inbox omnichannel (conversa) — channelRef = phone_number_id
            await this.inbox
              .ingestInbound({
                organizationId: store.organizationId,
                storeId: store.id,
                channel: "whatsapp",
                channelRef: phoneNumberId ?? "",
                contact: { phone: from, name: contactName },
                externalKey: from,
                msgExternalId: waMessageId,
                content: text,
                contentType: "text",
              })
              .catch(() => null);

            // CRM: cria/atualiza o lead (source = whatsapp). Nunca quebra o webhook.
            void this.crm
              .captureInbound({
                organizationId: store.organizationId,
                storeId: store.id,
                phone: from,
                name: contactName,
                channel: "whatsapp",
                protocol: waMessageId,
              })
              .catch(() => undefined);

            // TODO (próximo passo): se META_AI_AUTOREPLY=true, chamar o
            // qualificador IA aqui (saudação + perguntas) via MetaAdapter.sendText.
          }

          // statuses (sent/delivered/read) — só log por enquanto
          if ((value.statuses ?? []).length) {
            this.logger.debug(`statuses recebidos: ${value.statuses.length}`);
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`handle Meta falhou: ${e?.message}`);
    }
  }

  /** Resolve a loja dona do número. MVP: env (1 número). Multi-tenant: mapear
   *  phone_number_id -> store numa tabela. */
  private async resolveStore(
    phoneNumberId?: string,
  ): Promise<{ id: string; organizationId: string } | null> {
    if (!phoneNumberId) return null;
    const expected = process.env.META_PHONE_NUMBER_ID;
    const storeId = process.env.META_STORE_ID;
    if (!expected || !storeId || phoneNumberId !== expected) return null;
    return this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.store.findFirst({ where: { id: storeId }, select: { id: true, organizationId: true } }),
      )
      .catch(() => null);
  }

  /** Extrai texto da mensagem (texto / botão / lista interativa). */
  private extractText(msg: any): string {
    switch (msg?.type) {
      case "text":
        return msg?.text?.body ?? "";
      case "button":
        return msg?.button?.text ?? "";
      case "interactive":
        return (
          msg?.interactive?.button_reply?.title ??
          msg?.interactive?.list_reply?.title ??
          ""
        );
      case "image":
        return msg?.image?.caption ? `[imagem] ${msg.image.caption}` : "[imagem]";
      case "document":
        return "[documento]";
      case "audio":
        return "[áudio]";
      default:
        return msg?.type ? `[${msg.type}]` : "";
    }
  }
}
