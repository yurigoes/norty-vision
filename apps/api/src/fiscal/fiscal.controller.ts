import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { FiscalService } from "./fiscal.service";
import { NfceService } from "./nfce.service";
import { NfseService } from "./nfse.service";
import { FiscalRefService } from "./fiscal-ref.service";

@Controller("fiscal")
export class FiscalController {
  constructor(private readonly svc: FiscalService, private readonly nfce: NfceService, private readonly nfse: NfseService, private readonly ref: FiscalRefService) {}

  @Get("config")
  @RequirePermission("fiscal.config")
  config(@CurrentContext() ctx: RequestContext) { return this.svc.getConfig(ctx); }
  @Post("config")
  @HttpCode(200)
  @RequirePermission("fiscal.config")
  updateConfig(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.updateConfig(ctx, b ?? {}); }

  /** Sobe o certificado A1 (e-CNPJ) que assina os XMLs fiscais. */
  @Post("cert")
  @HttpCode(200)
  @RequirePermission("fiscal.config")
  uploadCert(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.uploadCert(ctx, b?.pfx ?? "", b?.password ?? ""); }

  @Get("documentos")
  @RequirePermission("sales.view")
  async docs(@CurrentContext() ctx: RequestContext) { return this.svc.listDocuments(ctx); }

  /** Emite a NFC-e de uma venda do PDV (homologação por padrão). */
  @Post("nfce/emitir")
  @HttpCode(200)
  @RequirePermission("fiscal.nfce.emit")
  emitir(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.nfce.emitFromSale(ctx, b?.saleId ?? ""); }

  /** Cancela uma NFC-e/NF-e autorizada (evento 110111). Justificativa de 15 a 255 caracteres. */
  @Post("nfce/:id/cancelar")
  @HttpCode(200)
  @RequirePermission("fiscal.nfce.cancel")
  cancelar(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.nfce.cancelNfce(ctx, id, b?.justificativa ?? ""); }

  /** Emite NF-e modelo 55 (com destinatário) de uma venda. */
  @Post("nfe/emitir")
  @HttpCode(200)
  @RequirePermission("fiscal.nfe.emit")
  emitirNfe(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.nfce.emitNfe55(ctx, { saleId: b?.saleId ?? "", dest: b?.dest ?? {}, natOp: b?.natOp, indPres: b?.indPres }); }

  /** Carta de Correção (CC-e, evento 110110). Texto de 15 a 1000 caracteres. */
  @Post("nfce/:id/correcao")
  @HttpCode(200)
  @RequirePermission("fiscal.nfce.emit")
  correcao(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.nfce.correcaoNfe(ctx, id, b?.correcao ?? "", b?.nSeq); }

  /** Envia o DANFE/DANFCe (PDF) + XML ao cliente por WhatsApp e/ou e-mail. */
  @Post("nfce/:id/enviar")
  @HttpCode(200)
  @RequirePermission("fiscal.nfce.emit")
  enviar(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.nfce.sendToCustomer(ctx, id, { email: b?.email, whatsapp: b?.whatsapp }); }

  /** DANFCe (cupom) em PDF de um documento fiscal. */
  @Get("nfce/:id/danfce")
  @RequirePermission("sales.view")
  async danfce(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.nfce.danfce(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ===================== NFS-e (Sistema Nacional) =====================
  @Get("nfse/config")
  @RequirePermission("fiscal.config")
  nfseConfig(@CurrentContext() ctx: RequestContext) { return this.nfse.getConfigSafe(ctx); }
  @Post("nfse/config")
  @HttpCode(200)
  @RequirePermission("fiscal.config")
  nfseUpdateConfig(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.nfse.updateConfig(ctx, b ?? {}); }
  @Get("nfse")
  @RequirePermission("sales.view")
  nfseList(@CurrentContext() ctx: RequestContext) { return this.nfse.list(ctx); }
  /** Emite uma NFS-e (DPS) — homologação (produção restrita) por padrão. */
  @Post("nfse/emitir")
  @HttpCode(200)
  @RequirePermission("fiscal.nfse.emit")
  nfseEmitir(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.nfse.emitir(ctx, { saleId: b?.saleId ?? null, storeId: b?.storeId ?? null, tomador: b?.tomador ?? null, codServico: b?.codServico ?? null, descricaoServico: b?.descricaoServico ?? "", aliqIss: b?.aliqIss ?? null, valorCents: Math.round(Number(b?.valorCents) || 0), competencia: b?.competencia ?? null });
  }
  @Get("nfse/:chave/consultar")
  @RequirePermission("sales.view")
  nfseConsultar(@CurrentContext() ctx: RequestContext, @Param("chave") chave: string) { return this.nfse.consultar(ctx, chave); }
  @Get("nfse/parametros/:municipio")
  @RequirePermission("fiscal.config")
  nfseParametros(@CurrentContext() ctx: RequestContext, @Param("municipio") municipio: string) { return this.nfse.parametrosMunicipais(ctx, municipio); }
  /** Gera a NFS-e a partir de um pedido de produção (gráfica) e envia ao cliente. */
  @Post("nfse/from-order/:orderId")
  @HttpCode(200)
  @RequirePermission("fiscal.nfse.emit")
  nfseFromOrder(@CurrentContext() ctx: RequestContext, @Param("orderId") orderId: string, @Body() b: any) { return this.nfse.emitFromProductionOrder(ctx, orderId, { authRequestId: b?.authRequestId ?? null, authCode: b?.authCode ?? null }); }
  /** Lista admin/gerente/supervisor (com WhatsApp) p/ autorizar NFS-e sem pagamento total. */
  @Get("nfse/auth-admins")
  @RequirePermission("fiscal.nfse.emit")
  nfseAuthAdmins(@CurrentContext() ctx: RequestContext) { return this.nfse.listAuthAdmins(ctx); }
  /** Envia código de 4 dígitos ao autorizador escolhido (NFS-e sem pagamento total). */
  @Post("nfse/from-order/:orderId/request-auth")
  @HttpCode(200)
  @RequirePermission("fiscal.nfse.emit")
  nfseRequestAuth(@CurrentContext() ctx: RequestContext, @Param("orderId") orderId: string, @Body() b: any) { return this.nfse.requestNfseAuth(ctx, orderId, b?.adminMembershipId ?? ""); }
  /** Reenvia a NFS-e ao cliente (PDF por WhatsApp/e-mail). */
  @Post("nfse/:id/enviar")
  @HttpCode(200)
  @RequirePermission("fiscal.nfse.emit")
  nfseEnviar(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.nfse.sendNfse(ctx, id, { email: b?.email ?? null, whatsapp: b?.whatsapp ?? null }); }
  /** Cancela a NFS-e (evento de cancelamento do Sistema Nacional). */
  @Post("nfse/:id/cancelar")
  @HttpCode(200)
  @RequirePermission("fiscal.nfse.cancel")
  nfseCancelar(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.nfse.cancelarNfse(ctx, id, b?.justificativa ?? ""); }
  /** PDF (DANFSe) da NFS-e. */
  @Get("nfse/:id/danfse")
  @RequirePermission("sales.view")
  async nfseDanfse(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.nfse.danfsePdf(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ===================== Referência fiscal (NCM/CEST/LC116) =====================
  @Get("ref/counts")
  refCounts(@CurrentContext() ctx: RequestContext) { return this.ref.counts(ctx); }
  /** Importa a tabela NCM oficial (JSON Siscomex) — master. */
  @Post("ref/ncm")
  @HttpCode(200)
  refImportNcm(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.ref.importNcm(ctx, typeof b?.json === "string" ? b.json : JSON.stringify(b ?? {})); }
  /** Semeia CEST + LC116 das tabelas oficiais embutidas — master. */
  @Post("ref/seed")
  @HttpCode(200)
  refSeed(@CurrentContext() ctx: RequestContext) { return this.ref.seedCestLc116(ctx); }
  @Get("ref/ncm")
  refNcm(@CurrentContext() ctx: RequestContext, @Query("q") q?: string) { return this.ref.searchNcm(ctx, q ?? ""); }
  @Get("ref/cest")
  refCest(@CurrentContext() ctx: RequestContext, @Query("ncm") ncm?: string) { return this.ref.cestForNcm(ctx, ncm ?? ""); }
  @Get("ref/servicos")
  refServicos(@CurrentContext() ctx: RequestContext, @Query("q") q?: string) { return this.ref.searchServicos(ctx, q ?? ""); }
}
