import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SystemService } from "./system.service";

@Controller("system")
export class SystemController {
  constructor(private readonly svc: SystemService) {}

  @Get("stats")
  stats(@CurrentContext() ctx: RequestContext) { return this.svc.stats(ctx); }

  @Post("backup")
  @HttpCode(200)
  backup(@CurrentContext() ctx: RequestContext) { return this.svc.backupDatabase(ctx); }
}
