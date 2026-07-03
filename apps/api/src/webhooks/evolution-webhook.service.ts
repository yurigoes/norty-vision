import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NluService } from "../nlu/nlu.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { InboxService } from "../inbox/inbox.service";
import { StorageService } from "../storage/storage.service";
import { ProductionService } from "../production/production.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";
import { IntegrationsService } from "../integrations/integrations.service";
import { CrmService } from "../crm/crm.service";

/**
 * Payload normalizado do Evolution API.
 *
 * Eventos relevantes:
 * - messages.upsert: mensagem recebida (ou enviada por nos)
 * - connection.update: status da sessao WhatsApp (qr, connected, disconnected)
 * - send.message: confirmacao de envio bem-sucedido
 */
export interface EvolutionPayload {
  event: string;
  instance?: string;
  data?: any;
  date_time?: string;
  server_url?: string;
  apikey?: string;
  destination?: string;
}

@Injectable()
export class EvolutionWebhookService {
  private readonly logger = new Logger("EvolutionWebhook");

  constructor(
    private readonly prisma: PrismaService,
    private readonly nlu: NluService,
    private readonly appointments: AppointmentsService,
    private readonly inbox: InboxService,
    private readonly storage: StorageService,
    private readonly production: ProductionService,
    private readonly integrations: IntegrationsService,
    private readonly crm: CrmService,
  ) {}

  /**
   * Entry point. Roteia para handlers especificos.
   */
  async handle(instanceName: string, payload: EvolutionPayload): Promise<void> {
    const event = (payload.event || "").toLowerCase();
    this.logger.log(`event=${event} instance=${instanceName}`);

    // Segurança (opt-in): se EVOLUTION_WEBHOOK_APIKEY estiver setada, mensagens
    // de entrada (messages.upsert) só são aceitas com a apikey correta — evita
    // injeção de mensagens falsas no webhook público. Outros eventos (status/QR)
    // não são bloqueados pra não atrapalhar a conexão.
    if (event === "messages.upsert") {
      const expected = process.env.EVOLUTION_WEBHOOK_APIKEY;
      if (expected && payload.apikey !== expected) {
        this.logger.warn(`messages.upsert rejeitado: apikey inválida (instance=${instanceName})`);
        return;
      }
    }

    // a instancia = slug da org. Resolve org + (uma) store pra logar mensagens.
    const target = await this.resolveByInstance(instanceName);
    if (!target) {
      this.logger.warn(`org nao encontrada pra instance=${instanceName}`);
      return;
    }

    switch (event) {
      case "messages.upsert":
        if (target.storeId) await this.handleMessageUpsert({ id: target.storeId, organization_id: target.organizationId, evolution_instance_name: instanceName }, payload.data, { url: payload.server_url, key: payload.apikey });
        break;
      case "connection.update":
        await this.handleConnectionUpdate(instanceName, target.organizationId, payload.data);
        break;
      case "qrcode.updated":
        await this.handleQrUpdated(instanceName, target.organizationId, payload.data);
        break;
      case "send.message":
        if (target.storeId) await this.handleSendMessage({ id: target.storeId, organization_id: target.organizationId, evolution_instance_name: instanceName }, payload.data);
        break;
      default:
        this.logger.debug(`event ignorado: ${event}`);
    }
  }

  // ==========================================================================
  // messages.upsert  -> grava em message_log
  // ==========================================================================
  private async handleMessageUpsert(store: StoreRow, data: any, evo?: { url?: string; key?: string }): Promise<void> {
    if (!data) return;

    const fromMe = Boolean(data?.key?.fromMe);
    const remoteJid: string = data?.key?.remoteJid ?? "";
    const channelMessageId: string = data?.key?.id ?? "";

    // mensagem de SAÍDA (fromMe): ou é eco de um envio nosso (bot/atendente pelo
    // sistema) — ignoramos —, ou é o dono respondendo DIRETO no celular (fora do
    // sistema). No 2º caso, registramos e PAUSAMOS a IA pra não conflitar.
    if (fromMe) {
      if (!remoteJid) return;
      const outText = extractMessageText(data) ?? "";
      await this.inbox
        .noteOutboundWhatsapp({ organizationId: store.organization_id, externalKey: remoteJid, channelMessageId, text: outText })
        .catch(() => undefined);
      return;
    }
    if (!remoteJid || !channelMessageId) return;

    // Extrai o TELEFONE REAL. No WhatsApp novo (LID), o remoteJid vem como
    // "<id>@lid" — um ID interno que NÃO é o telefone. Nesse caso o Evolution
    // manda o telefone em senderPn/participantPn. Pegamos o primeiro campo que
    // seja um JID de telefone (@s.whatsapp.net) ou número puro; nunca o @lid.
    const phone = extractSenderPhone(data);
    // chave de match tolerante: últimos 8 dígitos (parte única do assinante),
    // ignorando 55 (país) e o 9º dígito que o WhatsApp às vezes inclui.
    const phoneTail = phone.slice(-8);
    const pushName: string = data?.pushName ?? "";

    // extrai texto (pode estar em varios formatos dependendo do tipo)
    const text = extractMessageText(data);
    const messageType: string = data?.messageType ?? "unknown";

    // tenta resolver customer existente — match por sufixo (últimos 8 dígitos)
    // pra tolerar 55 (país) e o 9º dígito divergente entre o salvo e o WhatsApp.
    const customer = phoneTail.length >= 8
      ? await this.prisma.runWithContext(
          { isPlatformAdmin: true },
          (tx) =>
            tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM customers
               WHERE organization_id = ${store.organization_id}::uuid
                 AND deleted_at IS NULL
                 AND (
                   right(regexp_replace(coalesce(whatsapp_phone,''), '[^0-9]', '', 'g'), 8) = ${phoneTail}
                   OR right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 8) = ${phoneTail}
                 )
               ORDER BY (store_id = ${store.id}::uuid) DESC
               LIMIT 1
            `,
        )
      : [];
    const customerId = customer[0]?.id ?? null;
    this.logger.log(
      `inbound match: org=${store.organization_id} remoteJid=${remoteJid} phone=${phone} phoneTail=${phoneTail} customerId=${customerId ?? "NENHUM"} text="${(text ?? "").slice(0, 40)}"`,
    );

    // se nao existe, opcionalmente cria um stub (com tag inbound_wpp)
    // - decisao: nao cria automaticamente; deixa a app/UI mostrar como
    //   'desconhecido' e oferecer botao 'cadastrar'.

    // dedup: ignora se já registramos esse channel_message_id (best-effort).
    const dup = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM message_log
         WHERE channel = 'whatsapp' AND channel_message_id = ${channelMessageId}
         LIMIT 1
      `,
    );
    if (dup.length > 0) {
      this.logger.debug(`mensagem duplicada ignorada: ${channelMessageId}`);
      return;
    }
    // INSERT com ON CONFLICT DO NOTHING SEM alvo de coluna: funciona com OU sem o
    // índice único (não depende da migration 078). A exatidão de "agir só 1x" é
    // garantida pelo CLAIM atômico no appointment, abaixo.
    const inserted = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO message_log (
          organization_id, store_id, direction, channel, channel_message_id,
          customer_id, from_address, body, payload, status
        ) VALUES (
          ${store.organization_id}::uuid,
          ${store.id}::uuid,
          'inbound',
          'whatsapp',
          ${channelMessageId},
          ${customerId}::uuid,
          ${phone},
          ${text},
          ${JSON.stringify({ messageType, pushName, raw: data })}::jsonb,
          'received'
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
    );
    const messageId = inserted[0]?.id ?? null;
    if (!messageId) {
      this.logger.debug(`mensagem duplicada ignorada (conflict): ${channelMessageId}`);
      return;
    }

    // === mídia recebida (imagem/áudio/vídeo/documento) ===
    // WhatsApp guarda a mídia criptografada; pedimos o base64 pro Evolution e
    // subimos no nosso bucket público pra o operador conseguir ver/baixar.
    const mediaInfo = extractMediaInfo(data);
    let inboundMediaUrl: string | null = null;
    let inboundMediaMime: string | null = null;
    let inboundContentType = "text";
    // credenciais p/ baixar a mídia: usa as do payload e, se faltarem (algumas
    // versões do Evolution não mandam server_url/apikey), cai pra integração configurada.
    let evoUrl = evo?.url; let evoKey = evo?.key;
    if (mediaInfo && (!evoUrl || !evoKey)) {
      const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "evolution" }).catch(() => null);
      evoUrl = evoUrl || (cfg as any)?.baseUrl; evoKey = evoKey || (cfg as any)?.apiKey;
    }
    if (mediaInfo && evoUrl && evoKey) {
      try {
        const adapter = new EvolutionAdapter({ baseUrl: evoUrl, apiKey: evoKey });
        const r = await adapter.getBase64FromMediaMessage({ instanceName: store.evolution_instance_name ?? "", message: data });
        const b64 = r.body?.base64;
        if (b64) {
          const mime = r.body?.mimetype || mediaInfo.mime || "application/octet-stream";
          const buf = Buffer.from(b64, "base64");
          const up = await this.storage.putPublic({ keyPrefix: `inbox/${store.organization_id}`, contentType: mime, body: buf, originalName: mediaInfo.fileName });
          inboundMediaUrl = up.url;
          inboundMediaMime = mime;
          inboundContentType = mediaInfo.kind;
        }
      } catch (e: any) {
        this.logger.warn(`mídia inbound falhou: ${e?.message}`);
      }
    }
    const inboundContent = mediaInfo ? (mediaInfo.caption || mediaInfo.fileName || text || "") : (text ?? "");

    // === Inbox omnichannel: ingere a mensagem na conversa de WhatsApp ===
    // Aditivo (só visibilidade); o bot de triagem só age se a inbox tiver bot
    // ligado (default desligado), então não conflita com a confirmação da agenda.
    const ingest = await this.inbox
      .ingestInbound({
        organizationId: store.organization_id,
        storeId: store.id,
        channel: "whatsapp",
        channelRef: store.evolution_instance_name ?? "",
        contact: { phone, name: pushName || null, customerId },
        externalKey: remoteJid,
        msgExternalId: channelMessageId,
        content: inboundContent,
        contentType: inboundContentType,
        mediaUrl: inboundMediaUrl,
        mediaMime: inboundMediaMime,
      })
      .catch(() => null);
    // CRM: cria/atualiza o lead a partir do contato (best-effort; nunca quebra o webhook).
    void this.crm.captureInbound({ organizationId: store.organization_id, storeId: store.id, phone, name: pushName || null, customerId, channel: "whatsapp" }).catch(() => undefined);
    // gráfica: comprovante (imagem/PDF) do cliente → anexa ao pedido aberto e confirma.
    // Se casou, encerra aqui (não passa pelo bot/NLU pra não responder em duplicidade).
    if (inboundMediaUrl) {
      const captured = await this.production.capturePaymentProofFromWhatsapp({
        organizationId: store.organization_id, storeId: store.id, customerId,
        mediaUrl: inboundMediaUrl, mediaMime: inboundMediaMime, fileName: mediaInfo?.fileName ?? null,
      }).catch(() => false);
      if (captured) return;
    }
    // PROTEÇÕES CONTRA SPAM DA IA:
    //
    // (1) Mensagem antiga (backlog de reconexão): quando o WhatsApp reconecta,
    //     o Evolution despeja TODAS as mensagens não-entregues. Se a gente
    //     respondesse cada uma, encheria a caixa do cliente. Pulamos a IA pra
    //     mensagens com mais de 2 min de idade — ainda registramos no log mas
    //     não chamamos a IA.
    //
    // (2) Conversa que já existia antes da inbox ter conectado: se a primeira
    //     interação rastreada é mais antiga que esta mensagem, deve ser
    //     conversa em andamento — a IA não deve "começar" a atender no meio
    //     do papo. Em conversas novas (`ingest.isNew`), a IA age normal.
    //
    // (3) Debounce por conversa: cliente que manda 5 msgs em 30s gera 5
    //     respostas. Agendamos a IA pra 5s no futuro; nova mensagem cancela
    //     e reagenda. Junta rajadas em UMA resposta só.
    const msgTsSec = Number(data?.messageTimestamp ?? data?.message?.messageContextInfo?.timestamp ?? 0);
    const ageSec = msgTsSec > 0 ? (Date.now() / 1000) - msgTsSec : 0;
    const TOO_OLD_SEC = 120; // 2 min — qualquer msg mais antiga é backlog
    const isBacklog = ageSec > TOO_OLD_SEC;

    // Decide quem trata a mensagem. Estados possíveis da conversa:
    //  - inbox com bot de IA LIGADO + sem humano → o BOT (scheduleBotTurn) trata;
    //    suprime a NLU legada (senão "sim" agenda E confirma de uma vez).
    //  - inbox SEM bot de IA (ótica usa "responda 1/2/3") → a NLU legada trata
    //    a confirmação do agendamento.
    //  - HUMANO atendendo (operador atribuído, ou dono respondeu direto pelo
    //    celular = botPausedUntil) → NINGUÉM automático age. Nem bot nem NLU.
    //    Mesma lógica da gráfica: a IA não fala por cima do operador.
    let botWillHandle = false;
    let humanActive = false;
    if (ingest) {
      // conversa nova → roteia direto pra quem está disponível (ou fila + aviso de posição)
      if (ingest.isNew) await this.inbox.routeConversation(ingest.conversationId).catch(() => undefined);
      const st = await this.inbox.conversationHandlingState(ingest.conversationId).catch(() => null);
      humanActive = !!st?.humanActive;
      if (text && isBacklog) {
        this.logger.log(`bot pulado: mensagem antiga (${Math.round(ageSec)}s) — backlog de reconexão. conv=${ingest.conversationId}`);
      } else if (text && humanActive) {
        // Operador está cuidando (ou dono respondeu direto). Não interferimos.
        this.logger.log(`automação suprimida: humano atendendo conv=${ingest.conversationId}`);
        botWillHandle = true; // suprime a NLU; o humano responde
      } else if (text && st?.botEnabled) {
        // Bot de IA ligado e ninguém humano → debounce + IA trata
        this.inbox.scheduleBotTurn(ingest.conversationId, text);
        botWillHandle = true;
      }
      // senão (bot desligado e sem humano) → deixa a NLU legada de confirmação rodar
    }

    this.logger.log(
      `inbound whatsapp gravada: store=${store.id} from=${phone} text="${text?.slice(0, 60)}"`,
    );

    if (!text || text.trim().length === 0) return;

    // Bot de IA tratando OU humano atendendo → NÃO deixa a NLU legada agir por cima.
    if (botWillHandle || humanActive) return;

    // ====== classificacao NLU ======
    const result = await this.nlu.classify({
      organizationId: store.organization_id,
      storeId: store.id,
      text,
    });

    // atualiza classified_*
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        UPDATE message_log
           SET classified_intent = ${result.intent},
               classified_score = ${result.score},
               classified_by = ${result.classifiedBy},
               classified_at = now()
         WHERE id = ${messageId}::uuid
      `,
    );

    // se ambiguo (entre threshold de revisao e auto), joga em unresolved_replies
    if (this.nlu.isAmbiguous(result)) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.unresolvedReply.create({
          data: {
            organizationId: store.organization_id,
            storeId: store.id,
            messageId,
            customerId,
            rawText: text,
            candidates: result.candidates as any,
            status: "pending",
          },
        }),
      );
      this.logger.log(`unresolved gravado pra revisao: msg=${messageId}`);
      return;
    }

    if (result.intent === "unknown") return;

    if (!customerId) {
      this.logger.log(
        `classificado ${result.intent} mas sem customer_id — nao aplica acao`,
      );
      return;
    }

    // opt_out independe de sessão de agendamento (sempre vale "pare/sair").
    if (result.intent === "opt_out") {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`
          UPDATE customers SET opt_out_marketing = true, opt_out_at = now()
           WHERE id = ${customerId}::uuid
        `,
      );
      this.logger.log(`opt_out aplicado customer=${customerId}`);
      return;
    }

    // ===== SESSÃO DE RESPOSTA =====
    // A resposta age no agendamento ativo mais próximo enquanto o cliente AINDA
    // NÃO respondeu (customer_responded_at IS NULL). Depois de responder uma vez,
    // ignoramos respostas seguintes até um novo lembrete reabrir a sessão (o
    // lembrete zera customer_responded_at). Não exigimos reply_open_at — assim o
    // fluxo funciona mesmo sem ter passado por um lembrete.
    const baseWhere = {
      customerId,
      deletedAt: null,
      status: { in: ["pending", "confirmed", "rescheduled"] },
      startsAt: { gte: new Date(Date.now() - 86400_000) },
    };
    let apt: { id: string; organizationId: string; storeId: string; slotId: string; customerId: string; startsAt: Date } | null;
    try {
      apt = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.findFirst({ where: { ...baseWhere, customerRespondedAt: null }, orderBy: { startsAt: "asc" } }),
      ) as any;
    } catch {
      // colunas de sessão (migration 078) ainda não aplicadas → fallback legado
      apt = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.findFirst({ where: baseWhere, orderBy: { startsAt: "asc" } }),
      ) as any;
    }
    if (!apt) {
      this.logger.log(
        `sem agendamento aguardando resposta pra customer=${customerId} (intent=${result.intent} ignorado)`,
      );
      return;
    }

    // CLAIM atômico: mata a sessão. Só UM processo vence — evita ação/notif 2x.
    // Se a coluna ainda não existe (sem migration 078), segue no modo legado.
    let claimed = 1;
    try {
      claimed = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`
          UPDATE appointments
             SET customer_responded_at = now(), customer_response = ${result.intent}
           WHERE id = ${apt!.id}::uuid AND customer_responded_at IS NULL
        `,
      );
    } catch {
      claimed = 1; // coluna inexistente → não bloqueia a ação (legado)
    }
    if (!claimed) {
      this.logger.debug(`sessão já resolvida (claim perdeu) appt=${apt.id}`);
      return;
    }

    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      if (result.intent === "confirm") {
        await tx.appointment.update({
          where: { id: apt.id },
          data: { status: "confirmed" },
        });
        await tx.appointmentEvent.create({
          data: {
            organizationId: apt.organizationId,
            storeId: apt.storeId,
            appointmentId: apt.id,
            eventType: "confirmed",
            actorType: "customer",
            actorLabel: `WhatsApp +${phone}`,
            payload: { source: "nlu", score: result.score } as any,
          },
        });
      } else if (result.intent === "cancel") {
        await tx.appointment.update({
          where: { id: apt.id },
          data: {
            status: "canceled",
            canceledAt: new Date(),
            canceledBy: "customer",
            canceledReason: "Resposta WhatsApp",
          },
        });
        await tx.scheduleSlot.update({
          where: { id: apt.slotId },
          data: { used: { decrement: 1 } },
        });
        await tx.appointmentEvent.create({
          data: {
            organizationId: apt.organizationId,
            storeId: apt.storeId,
            appointmentId: apt.id,
            eventType: "canceled",
            actorType: "customer",
            actorLabel: `WhatsApp +${phone}`,
            payload: { source: "nlu", score: result.score } as any,
          },
        });
      } else if (result.intent === "reschedule") {
        // nao reagenda automaticamente — abre evento pra recepcao tratar
        await tx.appointmentEvent.create({
          data: {
            organizationId: apt.organizationId,
            storeId: apt.storeId,
            appointmentId: apt.id,
            eventType: "reschedule_requested",
            actorType: "customer",
            actorLabel: `WhatsApp +${phone}`,
            payload: { source: "nlu", text } as any,
          },
        });
      }
    });

    // notificações pós-ação (best-effort, fora da tx). Como o claim é atômico,
    // isto roda no máximo uma vez por resposta.
    if (result.intent === "confirm") {
      await this.appointments.notifyAppointment(apt.id, "confirmed").catch(() => undefined);
    } else if (result.intent === "cancel") {
      await this.appointments
        .createCancelFollowup(
          { id: apt.id, organizationId: apt.organizationId, storeId: apt.storeId, customerId: apt.customerId },
          `Cliente cancelou pelo WhatsApp o exame de ${apt.startsAt.toLocaleDateString("pt-BR", { timeZone: "UTC" })}.`,
        )
        .catch(() => undefined);
      await this.appointments.notifyAppointment(apt.id, "canceled").catch(() => undefined);
    } else if (result.intent === "reschedule") {
      // responde com as próximas datas + o link de autoatendimento
      await this.appointments.sendRescheduleOptions(apt.id).catch(() => undefined);
    }

    // a resposta de confirmação foi tratada pela automação → tira do painel de
    // atendimento (não fica como conversa nova/não lida).
    if (ingest?.conversationId) {
      const note =
        result.intent === "confirm" ? "Cliente confirmou o agendamento pelo WhatsApp (tratado automaticamente)."
        : result.intent === "cancel" ? "Cliente cancelou o agendamento pelo WhatsApp (tratado automaticamente)."
        : "Cliente pediu reagendamento pelo WhatsApp (tratado automaticamente).";
      await this.inbox.handleAutomatedReply(ingest.conversationId, note).catch(() => undefined);
    }

    this.logger.log(
      `nlu apply: intent=${result.intent} score=${result.score.toFixed(2)} appt=${apt.id}`,
    );
  }

  // ==========================================================================
  // connection.update -> atualiza stores.evolution_instance_status
  // ==========================================================================
  private async handleConnectionUpdate(
    instanceName: string,
    organizationId: string,
    data: any,
  ): Promise<void> {
    const state: string = data?.state ?? "";
    const map: Record<string, string> = {
      open: "connected",
      connecting: "qr_required",
      close: "disconnected",
    };
    const status = map[state] ?? "qr_required";

    // instância EXTRA → atualiza a própria linha; senão, a principal (organizations)
    const isExtra = await this.isExtraInstance(instanceName);
    if (isExtra) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`
          UPDATE evolution_instances
             SET status = ${status},
                 qr = CASE WHEN ${status} = 'connected' THEN NULL ELSE qr END
           WHERE name = ${instanceName}
        `,
      );
    } else {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`
          UPDATE organizations
             SET evolution_status = ${status},
                 evolution_qr = CASE WHEN ${status} = 'connected' THEN NULL ELSE evolution_qr END
           WHERE id = ${organizationId}::uuid
        `,
      );
    }
    this.logger.log(`connection.update instance=${instanceName} org=${organizationId} -> ${status}`);
  }

  /** A instância é EXTRA (call center) e não a principal (= slug)? */
  private async isExtraInstance(instanceName: string): Promise<boolean> {
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM evolution_instances WHERE name = ${instanceName} LIMIT 1`,
    );
    return rows.length > 0;
  }

  // ==========================================================================
  // qrcode.updated -> guarda o QR (base64) na org pra o painel exibir
  // ==========================================================================
  private async handleQrUpdated(instanceName: string, organizationId: string, data: any): Promise<void> {
    const base64: string | null =
      data?.qrcode?.base64 ?? data?.base64 ?? data?.qrcode ?? null;
    if (!base64 || typeof base64 !== "string") return;
    const qr = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
    const isExtra = await this.isExtraInstance(instanceName);
    if (isExtra) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`UPDATE evolution_instances SET qr = ${qr}, status = 'qr_required' WHERE name = ${instanceName}`,
      );
    } else {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`UPDATE organizations SET evolution_qr = ${qr} WHERE id = ${organizationId}::uuid`,
      );
    }
    this.logger.log(`qrcode.updated instance=${instanceName} org=${organizationId} (QR guardado)`);
  }

  // ==========================================================================
  // send.message -> marca outbound como sent/delivered
  // ==========================================================================
  private async handleSendMessage(store: StoreRow, data: any): Promise<void> {
    const channelMessageId: string = data?.key?.id ?? "";
    if (!channelMessageId) return;

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        UPDATE message_log
           SET status = 'sent',
               sent_at = COALESCE(sent_at, now())
         WHERE store_id = ${store.id}::uuid
           AND channel = 'whatsapp'
           AND channel_message_id = ${channelMessageId}
      `,
    );
  }

  // ==========================================================================
  // Helper - busca store pelo nome da instance
  // ==========================================================================
  /**
   * Resolve a org pelo slug (= nome da instancia) e uma store da org pra logar
   * mensagens. Mantem compat com instancias antigas (store.evolution_instance_name).
   */
  private async resolveByInstance(
    instanceName: string,
  ): Promise<{ organizationId: string; storeId: string | null } | null> {
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ organization_id: string; store_id: string | null }>>`
        SELECT o.id AS organization_id,
               (SELECT s.id FROM stores s
                  WHERE s.organization_id = o.id AND s.deleted_at IS NULL
                  ORDER BY s.created_at ASC LIMIT 1) AS store_id
          FROM organizations o
         WHERE o.slug = ${instanceName} AND o.deleted_at IS NULL
         LIMIT 1
      `,
    );
    if (rows[0]) return { organizationId: rows[0].organization_id, storeId: rows[0].store_id };
    // instância EXTRA do call center (multi-número): resolve org pelo nome
    const extra = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ organization_id: string }>>`
        SELECT organization_id FROM evolution_instances
         WHERE name = ${instanceName} LIMIT 1
      `,
    );
    if (extra[0]) {
      const storeRows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM stores WHERE organization_id = ${extra[0]!.organization_id}::uuid AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1
        `,
      );
      return { organizationId: extra[0].organization_id, storeId: storeRows[0]?.id ?? null };
    }
    // fallback: instancia antiga por loja
    const legacy = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ organization_id: string; id: string }>>`
        SELECT organization_id, id FROM stores
         WHERE evolution_instance_name = ${instanceName} AND deleted_at IS NULL LIMIT 1
      `,
    );
    if (legacy[0]) return { organizationId: legacy[0].organization_id, storeId: legacy[0].id };
    return null;
  }
}

interface StoreRow {
  id: string;
  organization_id: string;
  evolution_instance_name: string;
}

/**
 * Extrai o telefone REAL do remetente. Trata o caso do WhatsApp LID
 * (remoteJid = "<id>@lid"), em que o telefone vem em senderPn/participantPn.
 * Retorna só os dígitos; ignora JIDs @lid e @g.us (grupo).
 */
function extractSenderPhone(data: any): string {
  const k = data?.key ?? {};
  // ordem de preferência: campos que carregam o telefone (não o LID)
  const candidates: Array<string | undefined> = [
    k.senderPn,            // Evolution/Baileys: telefone quando remoteJid é LID
    k.participantPn,
    k.remoteJidAlt,        // algumas versões expõem o jid alternativo (telefone)
    data?.senderPn,
    k.remoteJid,           // só vale se for @s.whatsapp.net (tratado abaixo)
    k.participant,
    data?.participant,
  ];
  // tira "@dominio" E o sufixo de aparelho ":NN" (ex.: 557199952268:62@... → 557199952268)
  const onlyPhone = (jid: string) => jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  for (const c of candidates) {
    if (!c || typeof c !== "string") continue;
    if (c.includes("@lid") || c.includes("@g.us")) continue; // LID/grupo: não é telefone
    const digits = onlyPhone(c);
    // telefone BR válido tem ao menos 10 dígitos (DDD + número); evita IDs curtos
    if (digits.length >= 10) return digits;
  }
  // último recurso: dígitos do remoteJid (sem device suffix)
  return onlyPhone(data?.key?.remoteJid ?? "");
}

/**
 * Detecta mídia (imagem/áudio/vídeo/documento) numa mensagem do WhatsApp.
 * Retorna o tipo normalizado (kind), o mimetype declarado, legenda e nome do
 * arquivo quando houver. null se for mensagem só de texto.
 */
function extractMediaInfo(data: any): { kind: "image" | "audio" | "video" | "file"; mime?: string; caption?: string; fileName?: string } | null {
  const m = data?.message;
  if (!m) return null;
  if (m.imageMessage) return { kind: "image", mime: m.imageMessage.mimetype, caption: m.imageMessage.caption };
  if (m.stickerMessage) return { kind: "image", mime: m.stickerMessage.mimetype };
  if (m.audioMessage) return { kind: "audio", mime: m.audioMessage.mimetype };
  if (m.videoMessage) return { kind: "video", mime: m.videoMessage.mimetype, caption: m.videoMessage.caption };
  if (m.documentMessage) return { kind: "file", mime: m.documentMessage.mimetype, caption: m.documentMessage.caption, fileName: m.documentMessage.fileName };
  if (m.documentWithCaptionMessage?.message?.documentMessage) {
    const d = m.documentWithCaptionMessage.message.documentMessage;
    return { kind: "file", mime: d.mimetype, caption: d.caption, fileName: d.fileName };
  }
  return null;
}

/**
 * Extrai texto da mensagem WhatsApp em diferentes formatos.
 */
function extractMessageText(data: any): string {
  if (!data?.message) return "";
  const m = data.message;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    ""
  );
}
