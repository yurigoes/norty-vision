import { Controller, Get } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SidebarService } from "./sidebar.service";

@Controller("sidebar")
export class SidebarController {
  constructor(private readonly svc: SidebarService) {}

  @Get("counts")
  async counts(@CurrentContext() ctx: RequestContext) {
    return this.svc.counts(ctx);
  }
}
