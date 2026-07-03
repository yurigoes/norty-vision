import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SupportService } from "./support.service";

@Controller("support")
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  // help
  @Get("help")
  async listHelp(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listHelp({ isMaster: ctx.isPlatformAdmin }) };
  }

  @Get("help/:slug")
  async getHelp(
    @CurrentContext() ctx: RequestContext,
    @Param("slug") slug: string,
  ) {
    const article = await this.svc.getHelpBySlug(slug, {
      isMaster: ctx.isPlatformAdmin,
    });
    return { article };
  }

  // guide
  @Get("guide")
  async listGuide(@CurrentContext() ctx: RequestContext) {
    return {
      sections: await this.svc.listGuideSections({
        isMaster: ctx.isPlatformAdmin,
      }),
    };
  }

  @Get("guide/by-path")
  async getGuide(
    @CurrentContext() ctx: RequestContext,
    @Query("path") path: string,
  ) {
    if (!path) return { section: null };
    const section = await this.svc.getGuideByPath(path, {
      isMaster: ctx.isPlatformAdmin,
    });
    return { section };
  }

  // specs (restritas)
  @Get("specs")
  async listSpecs(@CurrentContext() ctx: RequestContext) {
    return {
      docs: await this.svc.listSpecs({ isMaster: ctx.isPlatformAdmin }),
      requires_master: !ctx.isPlatformAdmin,
    };
  }

  @Get("specs/:slug")
  async getSpec(
    @CurrentContext() ctx: RequestContext,
    @Param("slug") slug: string,
  ) {
    const doc = await this.svc.getSpecBySlug(slug, {
      isMaster: ctx.isPlatformAdmin,
    });
    return { doc };
  }

  // health
  @Get("health")
  async health() {
    return this.svc.getHealth();
  }

  @Get("containers")
  async containers(@CurrentContext() ctx: RequestContext) {
    return this.svc.getContainersStatus({ isMaster: ctx.isPlatformAdmin });
  }

  // backup
  @Get("backup")
  async backup() {
    return this.svc.getBackupStatus();
  }

  // privacidade
  @Get("privacy/overview")
  async privacyOverview(@CurrentContext() ctx: RequestContext) {
    return this.svc.getPrivacityOverview({
      isMaster: ctx.isPlatformAdmin,
    });
  }

  @Get("privacy/recent-access")
  async recentAccess(
    @CurrentContext() ctx: RequestContext,
    @Query("limit") limit?: string,
  ) {
    return {
      items: await this.svc.getRecentDataAccess({
        isMaster: ctx.isPlatformAdmin,
        limit: limit ? parseInt(limit) : 50,
      }),
    };
  }
}
