import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { InboxService } from "./inbox.service";

@Controller("inbox")
export class InboxController {
  constructor(private readonly svc: InboxService) {}

  // ---- config ----
  @Get("inboxes")
  async inboxes(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listInboxes(ctx) };
  }
  @Post("inboxes")
  @HttpCode(200)
  upsertInbox(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertInbox(ctx, b);
  }
  @Get("inboxes/:id/agents")
  async inboxAgents(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.getInboxAgents(ctx, id) };
  }
  @Post("inboxes/:id/agents")
  @HttpCode(200)
  setAgents(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { membershipIds: string[] }) {
    return this.svc.setInboxAgents(ctx, id, b?.membershipIds ?? []);
  }

  // ---- configurações do call center ----
  @Get("settings")
  settings(@CurrentContext() ctx: RequestContext) {
    return this.svc.getSettings(ctx);
  }
  @Post("settings")
  @HttpCode(200)
  updateSettings(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.updateSettings(ctx, b ?? {});
  }
  @Get("settings/display-name")
  myDisplayName(@CurrentContext() ctx: RequestContext) {
    return this.svc.getMyDisplayName(ctx);
  }
  @Post("settings/display-name")
  @HttpCode(200)
  setMyDisplayName(@CurrentContext() ctx: RequestContext, @Body() b: { name: string }) {
    return this.svc.setMyDisplayName(ctx, b?.name ?? "");
  }
  @Get("teams/detailed")
  async teamsDetailed(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTeamsDetailed(ctx) };
  }
  @Post("teams")
  @HttpCode(200)
  upsertTeam(@CurrentContext() ctx: RequestContext, @Body() b: { id?: string; name: string; description?: string; memberMembershipIds?: string[] }) {
    return this.svc.upsertTeam(ctx, b);
  }
  @Post("teams/:id/delete")
  @HttpCode(200)
  deleteTeam(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteTeam(ctx, id);
  }

  @Get("labels")
  async labels(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listLabels(ctx) };
  }
  @Post("labels")
  @HttpCode(200)
  upsertLabel(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertLabel(ctx, b);
  }

  @Get("canned")
  async canned(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listCanned(ctx) };
  }
  @Post("canned")
  @HttpCode(200)
  upsertCanned(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertCanned(ctx, b);
  }
  @Post("canned/:id/delete")
  @HttpCode(200)
  deleteCanned(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteCanned(ctx, id);
  }

  // ---- conversas ----
  @Get("conversations")
  async conversations(@CurrentContext() ctx: RequestContext, @Query() q: any) {
    return { items: await this.svc.listConversations(ctx, q ?? {}) };
  }
  @Get("counts")
  counts(@CurrentContext() ctx: RequestContext) {
    return this.svc.getCounts(ctx);
  }
  @Get("top-questions")
  topQuestions(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) {
    return this.svc.topQuestions(ctx, q ?? {});
  }
  @Post("suggest-answer")
  @HttpCode(200)
  suggestAnswer(@CurrentContext() ctx: RequestContext, @Body() b: { topic: string; samples?: string[] }) {
    return this.svc.suggestCannedAnswer(ctx, b?.topic ?? "", b?.samples ?? []);
  }
  @Get("protocols/search")
  async searchProtocols(@CurrentContext() ctx: RequestContext, @Query("q") q: string) {
    return { items: await this.svc.searchProtocols(ctx, q ?? "") };
  }
  @Post("conversations/start")
  @HttpCode(200)
  startConversation(@CurrentContext() ctx: RequestContext, @Body() b: { customerId?: string | null; phone?: string | null; name?: string | null; message?: string }) {
    return this.svc.startConversation(ctx, b ?? {});
  }
  @Get("conversations/:id")
  conversation(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.getConversation(ctx, id);
  }
  /** Renomeia o contato/cliente desta conversa. Atualiza tanto a Conversation
   *  quanto o Customer linkado (se houver). Operador edita pra corrigir nomes
   *  errados que o WhatsApp puxou (pushName genérico ou diferente do real). */
  @Post("conversations/:id/rename-contact")
  @HttpCode(200)
  renameContact(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { name: string }) {
    return this.svc.renameContact(ctx, id, String(b?.name ?? ""));
  }
  @Post("conversations/:id/messages")
  @HttpCode(200)
  send(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { body: string; isPrivate?: boolean }) {
    return this.svc.sendMessage(ctx, id, b);
  }
  @Post("conversations/:id/link-customer")
  @HttpCode(200)
  linkCustomer(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { name?: string; phone?: string }) {
    return this.svc.linkCustomer(ctx, id, b ?? {});
  }
  @Get("agents")
  async agents(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listAgents(ctx) };
  }

  // ---- presença / supervisor ----
  @Get("presence/me")
  presenceMe(@CurrentContext() ctx: RequestContext) {
    return this.svc.getMyPresence(ctx);
  }
  @Post("presence")
  @HttpCode(200)
  setPresence(@CurrentContext() ctx: RequestContext, @Body() b: { status: "online" | "paused" | "offline"; maxConcurrent?: number }) {
    return this.svc.setPresence(ctx, b?.status, b?.maxConcurrent);
  }
  @Post("presence/heartbeat")
  @HttpCode(200)
  heartbeat(@CurrentContext() ctx: RequestContext) {
    return this.svc.heartbeat(ctx);
  }
  @Get("presence")
  async presenceList(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listPresence(ctx) };
  }
  @Get("teams")
  async teams(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTeams(ctx) };
  }

  @Post("conversations/:id/assign")
  @HttpCode(200)
  assign(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { membershipId: string | null }) {
    return this.svc.assign(ctx, id, b?.membershipId ?? null);
  }
  @Post("conversations/:id/transfer")
  @HttpCode(200)
  transfer(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { toMembershipId?: string | null; toTeamId?: string | null }) {
    return this.svc.transfer(ctx, id, b ?? {});
  }
  @Post("conversations/:id/status")
  @HttpCode(200)
  status(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string; reason?: string }) {
    return this.svc.setStatus(ctx, id, b?.status, b?.reason);
  }
  @Post("conversations/:id/transcript")
  @HttpCode(200)
  transcript(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { email?: string }) {
    return this.svc.emailTranscript(ctx, id, b?.email);
  }

  // ---- conversa interna entre atendentes ----
  @Get("internal")
  async internalPeers(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listInternalPeers(ctx) };
  }
  @Get("internal/unread")
  internalUnread(@CurrentContext() ctx: RequestContext) {
    return this.svc.internalUnreadCount(ctx);
  }
  @Get("internal/:peerId")
  async internalThread(@CurrentContext() ctx: RequestContext, @Param("peerId") peerId: string) {
    return { items: await this.svc.listInternalThread(ctx, peerId) };
  }
  @Post("internal/:peerId")
  @HttpCode(200)
  sendInternal(@CurrentContext() ctx: RequestContext, @Param("peerId") peerId: string, @Body() b: { body: string }) {
    return this.svc.sendInternal(ctx, peerId, b?.body ?? "");
  }

  // tabulação + protocolo + relatórios
  @Get("tabulations")
  async tabulations(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTabulations(ctx) };
  }
  @Post("tabulations")
  @HttpCode(200)
  upsertTabulation(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertTabulation(ctx, b);
  }
  @Post("conversations/:id/resolve")
  @HttpCode(200)
  resolve(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { tabulationId?: string | null; note?: string }) {
    return this.svc.resolve(ctx, id, b ?? {});
  }

  // ========== PR1: variáveis em canned + bulk actions + marcar não-lida ==========

  /** Renderiza o body da resposta rápida substituindo as variáveis com o
   *  contexto desta conversa (cliente, loja, operador, empresa). */
  @Post("conversations/:id/render-canned")
  @HttpCode(200)
  async renderCanned(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { body: string }) {
    return { rendered: await this.svc.interpolateForConversation(ctx, id, b?.body ?? "") };
  }

  /** Marca a conversa como não-lida pelo agente (volta pra fila visual dele). */
  @Post("conversations/:id/mark-unread")
  @HttpCode(200)
  async markUnread(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.markUnread(ctx, id);
  }

  /** Ações em lote sobre várias conversas (atribuir/transferir/resolver/labelar). */
  @Post("conversations/bulk")
  @HttpCode(200)
  async bulk(@CurrentContext() ctx: RequestContext, @Body() b: { ids: string[]; action: string; assigneeMembershipId?: string | null; teamId?: string | null; labelId?: string; remove?: boolean }) {
    return this.svc.bulkAction(ctx, b ?? ({} as any));
  }

  // ========== PR3: macros + auto-assign com limite ==========

  /** Lista as macros disponíveis (ativas) — operador escolhe e executa. */
  @Get("macros")
  async listMacros(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listMacros(ctx) };
  }

  /** Cria/edita macro. Admin only. */
  @Post("macros")
  @HttpCode(200)
  async upsertMacro(@CurrentContext() ctx: RequestContext, @Body() b: { id?: string; name: string; description?: string | null; actions: any[]; isActive?: boolean }) {
    return { macro: await this.svc.upsertMacro(ctx, b ?? ({} as any)) };
  }

  /** Desativa macro. */
  @Post("macros/:id/delete")
  @HttpCode(200)
  async deleteMacro(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteMacro(ctx, id);
  }

  /** Executa macro sobre uma conversa: envia mensagem + atribui + labela etc. */
  @Post("conversations/:id/run-macro/:macroId")
  @HttpCode(200)
  async runMacro(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("macroId") macroId: string) {
    return this.svc.runMacro(ctx, id, macroId);
  }

  /** Pega próximo agente disponível respeitando maxConcurrent (load-balanced). */
  @Get("next-agent")
  async nextAgent(@CurrentContext() ctx: RequestContext, @Query("teamId") teamId?: string) {
    return { membershipId: await this.svc.pickNextAgent(ctx, { teamId: teamId ?? null }) };
  }

  /** Lista operadores pra autocomplete de @ em notas internas. */
  @Get("mentionables")
  async mentionables(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listMentionables(ctx) };
  }

  // webhooks out
  @Get("webhooks")
  async listWebhooks(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listWebhooks(ctx) };
  }
  @Post("webhooks")
  @HttpCode(200)
  async upsertWebhook(@CurrentContext() ctx: RequestContext, @Body() b: { id?: string; name: string; url: string; secret?: string | null; events: string[]; isActive?: boolean }) {
    return { webhook: await this.svc.upsertWebhook(ctx, b ?? ({} as any)) };
  }
  @Post("webhooks/:id/delete")
  @HttpCode(200)
  async deleteWebhook(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteWebhook(ctx, id);
  }

  /** Relatórios do atendimento — visão geral do período. */
  @Get("reports/overview")
  async reportsOverview(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.reportsOverview(ctx, { from, to });
  }

  /** Ranking de operadores no período. */
  @Get("reports/by-agent")
  async reportsByAgent(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.reportsByAgent(ctx, { from, to });
  }

  /** Volume de mensagens recebidas (hora do dia ou dia). */
  @Get("reports/volume")
  async reportsVolume(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string, @Query("groupBy") groupBy?: string) {
    return this.svc.reportsVolume(ctx, { from, to, groupBy: groupBy === "day" ? "day" : "hour" });
  }

  /** Adia conversa: "1h" | "4h" | "tomorrow_9am" | "next_monday_9am" | ISO. */
  @Post("conversations/:id/snooze")
  @HttpCode(200)
  async snooze(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { until: string }) {
    return this.svc.snoozeConversation(ctx, id, b ?? ({} as any));
  }

  /** Tira do snooze e devolve pra "open" imediatamente. */
  @Post("conversations/:id/unsnooze")
  @HttpCode(200)
  async unsnooze(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.unsnoozeConversation(ctx, id);
  }
  @Get("reports/tabulations")
  async reportTabulations(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) {
    return this.svc.reportTabulations(ctx, q ?? {});
  }

  // vender pelo chat
  @Get("conversations/:id/orders")
  async orders(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.listOrders(ctx, id) };
  }
  @Post("conversations/:id/orders")
  @HttpCode(200)
  createOrder(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { items: Array<{ name: string; qty: number; unitCents: number }>; method: "pix" | "card" }) {
    return this.svc.createOrder(ctx, id, b);
  }
  @Post("orders/:orderId/check")
  @HttpCode(200)
  checkOrder(@CurrentContext() ctx: RequestContext, @Param("orderId") orderId: string) {
    return this.svc.checkOrder(ctx, orderId);
  }
  @Post("orders/:orderId/cancel")
  @HttpCode(200)
  cancelOrder(@CurrentContext() ctx: RequestContext, @Param("orderId") orderId: string) {
    return this.svc.cancelOrder(ctx, orderId);
  }

  // token de verificação (4 dígitos)
  @Post("conversations/:id/token/request")
  @HttpCode(200)
  requestToken(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.requestToken(ctx, id);
  }
  @Post("conversations/:id/token/validate")
  @HttpCode(200)
  validateToken(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { code: string }) {
    return this.svc.validateToken(ctx, id, b?.code ?? "");
  }
  @Post("conversations/:id/labels")
  @HttpCode(200)
  addLabel(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { labelId: string }) {
    return this.svc.addLabel(ctx, id, b?.labelId);
  }
  @Post("conversations/:id/labels/remove")
  @HttpCode(200)
  rmLabel(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { labelId: string }) {
    return this.svc.removeLabel(ctx, id, b?.labelId);
  }
}
