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
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ProfessionalsService } from "./professionals.service";

const UpsertProfessionalSchema = z.object({
  // aceita vazio/null (loja unica resolvida no service)
  storeId: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().uuid().optional(),
  ),
  name: z.string().min(2).max(120),
  displayName: z.string().max(120).nullable().optional(),
  document: z.string().max(20).nullable().optional(),
  registrationId: z.string().max(40).nullable().optional(),
  registrationUf: z.string().length(2).nullable().optional(),
  specialty: z.string().max(120).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  defaultAppointmentDurationMin: z.number().int().min(5).max(480).optional(),
  defaultAppointmentCapacity: z.number().int().min(1).max(50).optional(),
  acceptsWalkIn: z.boolean().optional(),
  status: z.enum(["active", "inactive", "vacation", "suspended"]).optional(),
  displayOrder: z.number().int().optional(),
});

@Controller("professionals")
export class ProfessionalsController {
  constructor(private readonly svc: ProfessionalsService) {}

  // Leitura é livre dentro da org (qualquer um precisa enxergar profissional
  // pra agendar). O RLS já restringe ao tenant.
  @Get()
  @RequirePermission("professionals.view")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
  ) {
    return { items: await this.svc.list(ctx, { storeId }) };
  }

  @Get(":id")
  @RequirePermission("professionals.view")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { professional: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("professionals.manage")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = UpsertProfessionalSchema.parse(body);
    return { professional: await this.svc.create(ctx, input) };
  }

  @Patch(":id")
  @RequirePermission("professionals.manage")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpsertProfessionalSchema.partial().parse(body);
    return { professional: await this.svc.update(ctx, id, input) };
  }

  @Delete(":id")
  @RequirePermission("professionals.manage")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { professional: await this.svc.softDelete(ctx, id) };
  }
}
