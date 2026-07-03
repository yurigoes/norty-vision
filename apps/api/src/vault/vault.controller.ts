import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePlatformOwner } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { VaultService } from "./vault.service";

const SetSecretInput = z.object({
  newSecret: z.string().min(8).max(256),
  currentSecret: z.string().optional(),
  hint: z.string().max(200).optional(),
});

const UnlockInput = z.object({
  secret: z.string().min(1).max(256),
});

const CreateItem = z.object({
  provider: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  consoleUrl: z.string().url().nullable().optional(),
  username: z.string().max(200).nullable().optional(),
  password: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const UpdateItem = CreateItem.partial().omit({ provider: true }).extend({
  externalAdminUserId: z.string().max(60).nullable().optional(),
});

@Controller("platform/vault")
export class VaultController {
  constructor(private readonly svc: VaultService) {}

  // -------------------------------------------------------------------
  // Setup / status / unlock / lock
  // -------------------------------------------------------------------
  @RequirePlatformOwner()
  @Get("status")
  async status(@CurrentContext() ctx: RequestContext) {
    const s = await this.svc.status();
    const unlocked = ctx.platformUserId
      ? await this.svc.isUnlocked(ctx.platformUserId)
      : false;
    return { ...s, unlocked };
  }

  @RequirePlatformOwner()
  @Post("set-secret")
  @HttpCode(200)
  async setSecret(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = SetSecretInput.parse(body);
    await this.svc.setUnlockSecret({
      platformUserId: ctx.platformUserId!,
      newSecret: input.newSecret,
      currentSecret: input.currentSecret,
      hint: input.hint,
    });
    return { ok: true };
  }

  @RequirePlatformOwner()
  @Post("unlock")
  @HttpCode(200)
  async unlock(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = UnlockInput.parse(body);
    return this.svc.unlock({
      platformUserId: ctx.platformUserId!,
      secret: input.secret,
    });
  }

  @RequirePlatformOwner()
  @Post("lock")
  @HttpCode(200)
  async lock(@CurrentContext() ctx: RequestContext) {
    await this.svc.lock(ctx.platformUserId!);
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // CRUD de credenciais
  // -------------------------------------------------------------------
  @RequirePlatformOwner()
  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("reveal") reveal?: string,
  ) {
    const items = await this.svc.list({
      platformUserId: ctx.platformUserId!,
      reveal: reveal === "1" || reveal === "true",
    });
    return { items };
  }

  @RequirePlatformOwner()
  @Post()
  async create(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const data = CreateItem.parse(body);
    await this.svc.create({ platformUserId: ctx.platformUserId!, data });
    return { ok: true };
  }

  @RequirePlatformOwner()
  @Patch(":id")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const patch = UpdateItem.parse(body);
    await this.svc.update({
      platformUserId: ctx.platformUserId!,
      id,
      patch,
    });
    return { ok: true };
  }

  @RequirePlatformOwner()
  @Delete(":id")
  async remove(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    await this.svc.remove({ platformUserId: ctx.platformUserId!, id });
    return { ok: true };
  }
}
