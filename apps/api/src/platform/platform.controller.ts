import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformService } from "./platform.service";
import {
  CurrentContext,
  Public,
  RequirePlatformAdmin,
  RequirePlatformOwner,
} from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";

@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  // publico: alimentado pra landing (logos, cores, etc - sem secrets)
  @Public()
  @Get("public")
  async getPublic() {
    return { settings: await this.platform.getPublic() };
  }

  // master only: ve tudo
  @RequirePlatformAdmin()
  @Get("settings")
  async getFull(@CurrentContext() ctx: RequestContext) {
    return {
      settings: await this.platform.getFull({ isPlatformAdmin: ctx.isPlatformAdmin }),
    };
  }

  @RequirePlatformOwner()
  @Patch("settings")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Body() body: Record<string, unknown>,
  ) {
    return {
      settings: await this.platform.update(
        {
          isPlatformAdmin: ctx.isPlatformAdmin,
          platformUserId: ctx.platformUserId,
        },
        body,
      ),
    };
  }

  // ---- equipe da plataforma (masters) — owner-only ----
  @RequirePlatformOwner()
  @Get("team")
  async listTeam() {
    return { items: await this.platform.listTeam() };
  }

  @RequirePlatformOwner()
  @Patch("team/:id/role")
  async setMemberRole(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { role } = z
      .object({ role: z.enum(["owner", "support"]) })
      .parse(body);
    return { member: await this.platform.setMemberRole(id, role) };
  }

  @RequirePlatformOwner()
  @Post("team")
  @HttpCode(201)
  async createMember(@Body() body: unknown) {
    const input = z.object({
      name: z.string().min(2).max(120),
      email: z.string().email().max(320),
      role: z.enum(["owner", "support"]),
    }).parse(body);
    return this.platform.createMember(input);
  }

  @RequirePlatformOwner()
  @Post("team/:id/reset-password")
  @HttpCode(200)
  async resetMemberPassword(@Param("id") id: string) {
    return this.platform.resetMemberPassword(id);
  }

  @RequirePlatformOwner()
  @Patch("team/:id/status")
  async setMemberStatus(@Param("id") id: string, @Body() body: unknown) {
    const { status } = z.object({ status: z.enum(["active", "inactive"]) }).parse(body);
    return { member: await this.platform.setMemberStatus(id, status) };
  }

  // ---- acessos às Specs Técnicas (grants) — owner-only ----
  @Get("specs/categories")
  async specCategories() { return { items: await this.platform.specCategories() }; }

  @RequirePlatformOwner()
  @Patch("team/:id/specs")
  async setSpecsAccess(@Param("id") id: string, @Body() body: unknown) {
    const { categories } = z.object({ categories: z.array(z.string().max(60)).max(50) }).parse(body);
    return { member: await this.platform.setSpecsAccess(id, categories) };
  }

  // ---- auditoria (impersonação e ações sensíveis) — owner-only ----
  @RequirePlatformOwner()
  @Get("audit")
  async audit(
    @Query("action") action?: string,
    @Query("organizationId") organizationId?: string,
  ) {
    return { items: await this.platform.listAudit({ action, organizationId }) };
  }
}
