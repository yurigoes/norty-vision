import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePlatformAdmin } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { MasterSyncService } from "./master-sync.service";

const Input = z.object({
  currentPlatformPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256).optional(),
  newEmail: z.string().email().max(320).optional(),
});

@Controller("platform/master")
export class MasterSyncController {
  constructor(private readonly svc: MasterSyncService) {}

  /**
   * POST /api/platform/master/sync
   *
   * Atualiza senha (e/ou email) do master no yugo + Chatwoot + GLPI.
   * Exige:
   *  - cofre desbloqueado
   *  - senha atual do master
   *  - newPassword OU newEmail (pelo menos um)
   */
  @RequirePlatformAdmin()
  @Post("sync")
  @HttpCode(200)
  async sync(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = Input.parse(body);
    return this.svc.sync({
      platformUserId: ctx.platformUserId!,
      currentPlatformPassword: input.currentPlatformPassword,
      newPassword: input.newPassword,
      newEmail: input.newEmail,
    });
  }

  /**
   * POST /api/platform/master/discover
   * Auto-descobre external_admin_user_id em Chatwoot/GLPI usando o
   * email do master. Grava direto em admin_credentials_vault.
   * Exige cofre desbloqueado.
   */
  @RequirePlatformAdmin()
  @Post("discover")
  @HttpCode(200)
  async discover(@CurrentContext() ctx: RequestContext) {
    return this.svc.discoverExternalIds({
      platformUserId: ctx.platformUserId!,
    });
  }
}
