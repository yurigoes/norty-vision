import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SuppliersService } from "./suppliers.service";

const UpsertSchema = z.object({
  type: z.enum(["medico", "laboratorio", "costureira", "outro"]),
  name: z.string().min(2).max(160),
  document: z.string().max(20).nullable().optional(),
  councilNumber: z.string().max(40).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  payoutMode: z.enum(["fixed", "percent"]).optional(),
  payoutFixedCents: z.number().int().min(0).nullable().optional(),
  payoutPercent: z.number().min(0).max(100).nullable().optional(),
  pixKey: z.string().max(200).nullable().optional(),
  // costureira: valor único por peça (multiplicado pelo total de peças do
  // roster ao marcar "pronto" no portal). 0 = sem cálculo automático.
  pricePerPieceCents: z.number().int().min(0).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}

  @Get()
  @RequirePermission("suppliers.manage")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("type") type?: string,
    @Query("activeOnly") activeOnly?: string,
  ) {
    return { items: await this.svc.list(ctx, { type, activeOnly: activeOnly === "true" }) };
  }

  @Get(":id")
  @RequirePermission("suppliers.manage")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { supplier: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("suppliers.manage")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { supplier: await this.svc.create(ctx, UpsertSchema.parse(body)) };
  }

  @Patch(":id")
  @RequirePermission("suppliers.manage")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { supplier: await this.svc.update(ctx, id, UpsertSchema.partial().parse(body)) };
  }

  @Delete(":id")
  @RequirePermission("suppliers.manage")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { supplier: await this.svc.softDelete(ctx, id) };
  }
}
