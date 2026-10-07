import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PontoPwaService } from "./ponto-pwa.service";
import { FaceService } from "./face.service";

function clientIp(req: FastifyRequest): string | null {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

@Controller()
export class PontoPwaController {
  constructor(private readonly svc: PontoPwaService, private readonly face: FaceService) {}

  // ----- ADMIN (autenticado) -----
  // NOTA DO PORTE: aqui existiam `@Get("stores")`, `@Get("stores/manage")`,
  // `@Post("stores")` e `@Post("stores/:id")`, vindos do RH. No RH faziam
  // sentido — não havia módulo de lojas. No Vision há: `StoresController`
  // (@Controller("stores")), com `@RequirePermission("stores.manage")`, schema
  // zod e PATCH/DELETE. Declarar as duas coisas não dá rota ambígua: dá API
  // que NÃO SOBE — o Fastify recusa no boot com FST_ERR_DUPLICATED_ROUTE, e
  // tsc/nest build/next build passam todos, porque a colisão só existe quando
  // a rota é REGISTRADA. Foi assim que a produção caiu em laço de reinício.
  //
  // As telas do ponto chamam `GET /api/stores`, que o StoresController já
  // responde no mesmo formato `{ items }`. `stores/manage` não tinha chamador
  // nenhum. Quem cria e edita loja é a tela /app/lojas, pelo módulo de lojas.
  //
  // `apps/api/src/__checks__/rotas.check.mts` passou a cobrir isso.
  @Get("ponto/devices")
  async devices(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listDevices(ctx) }; }
  @Post("ponto/devices")
  @HttpCode(200)
  createDevice(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.createDevice(ctx, b ?? {}); }
  @Post("ponto/devices/:id")
  @HttpCode(200)
  updateDevice(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.updateDevice(ctx, id, b ?? {}); }
  @Get("ponto/devices/:id/rustdesk")
  rustdesk(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deviceRustdesk(ctx, id); }
  @Get("ponto/devices/:id/punches")
  devicePunches(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.terminalPunches(ctx, id); }
  @Get("ponto/devices-report")
  async devicesReport(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.svc.terminalsReportPdf(ctx);
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  /** Cadastra (enrolla) o rosto de referência do funcionário. */
  @Post("ponto/employees/:id/face")
  @HttpCode(200)
  enrollFace(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.face.enroll(ctx, id, b?.selfie ?? ""); }

  /** Sobe a imagem de fundo do painel de marcação (com validade). */
  @Post("ponto/background")
  @HttpCode(200)
  background(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.setBackground(ctx, b?.image ?? "", b?.until); }

  /** Testa o reconhecimento facial (calibração): mostra quem o sistema acha que é, sem bater ponto. */
  @Post("ponto/face-test")
  @HttpCode(200)
  faceTest(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.faceTest(ctx, b?.selfie ?? ""); }

  /** Selfie da marcação (bucket privado) — só admin. */
  @Get("ponto/punches/:id/selfie")
  async selfie(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { body, contentType } = await this.svc.selfie(ctx, id);
    reply.header("Content-Disposition", "inline").type(contentType).send(body);
  }

  // ----- PÚBLICO (token do dispositivo) -----
  @Public()
  @Get("ponto-pwa/bootstrap")
  bootstrap(@Query("token") token: string, @Query("v") v: string, @Req() req: FastifyRequest) { return this.svc.bootstrap(token, clientIp(req), v ?? null); }

  /** Identifica o funcionário por código de barras / CPF / matrícula. */
  @Public()
  @Post("ponto-pwa/identify")
  @HttpCode(200)
  identify(@Body() b: any, @Req() req: FastifyRequest) { return this.svc.identify(b?.token ?? "", b?.identifier ?? "", clientIp(req)); }

  @Public()
  @Post("ponto-pwa/punch")
  @HttpCode(200)
  punch(@Body() b: any, @Req() req: FastifyRequest) {
    const { token, ...rest } = b ?? {};
    return this.svc.punch(token, rest, clientIp(req));
  }

  /** Bater ponto por reconhecimento facial (1:N): a selfie identifica e marca. */
  @Public()
  @Post("ponto-pwa/face-punch")
  @HttpCode(200)
  facePunch(@Body() b: any, @Req() req: FastifyRequest) {
    const { token, ...rest } = b ?? {};
    return this.svc.facePunch(token, rest, clientIp(req));
  }
}
