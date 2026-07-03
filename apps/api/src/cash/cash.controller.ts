import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { CashService } from "./cash.service";

@Controller("cash")
export class CashController {
  constructor(private readonly svc: CashService) {}

  @Get("current")
  @RequirePermission("cashbox.view_all")
  async current(@CurrentContext() ctx: RequestContext, @Query("storeId") storeId?: string) {
    return this.svc.current(ctx, storeId);
  }

  @Get("history")
  @RequirePermission("cashbox.view_all")
  async history(@CurrentContext() ctx: RequestContext, @Query("storeId") storeId?: string) {
    return { items: await this.svc.list(ctx, storeId) };
  }

  @Get(":id")
  @RequirePermission("cashbox.view_all")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { register: await this.svc.getById(ctx, id) };
  }

  @Post("open")
  @HttpCode(201)
  @RequirePermission("cashbox.open")
  async open(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      storeId: z.string().uuid().optional(),
      openingFloatCents: z.number().int().min(0).optional(),
    }).parse(body ?? {});
    return { register: await this.svc.openRegister(ctx, input) };
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("cashbox.close")
  async close(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      countedCents: z.number().int().min(0).optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(body ?? {});
    return { register: await this.svc.closeRegister(ctx, id, input) };
  }
}
