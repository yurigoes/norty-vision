import { Controller, Get, Query } from "@nestjs/common";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly svc: MetricsService) {}

  // BI gateado por reports.bi_panel — antes qualquer usuário logado acessava o
  // dashboard. Agora só quem tem a permissão (org admin/master sempre têm).
  @Get("overview")
  @RequirePermission("reports.bi_panel")
  async overview(@CurrentContext() ctx: RequestContext) {
    return this.svc.overview(ctx);
  }

  /** Painel BI da ótica (agenda + vendas + tendência + previsão). */
  @Get("otica")
  @RequirePermission("reports.bi_panel")
  async otica(@CurrentContext() ctx: RequestContext, @Query("days") days?: string) {
    return this.svc.oticaDashboard(ctx, days ? Number(days) : 30);
  }
}
