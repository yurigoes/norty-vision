import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/decorators";
import { NortyLicenseGuard } from "./norty-license.guard";
import { NortyLicenseService } from "./norty-license.service";

const LicenseSchema = z.object({
  externalRef: z.string().min(1).max(120),
  plan: z.string().max(60).nullable().optional(),
  cycle: z.enum(["monthly", "annual", "trial"]).nullable().optional(),
  customer: z.object({
    fullName: z.string().min(1).max(200),
    email: z.string().email().max(320).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    document: z.string().max(40).nullable().optional(),
  }),
  seller: z.object({ name: z.string().max(200).nullable().optional(), email: z.string().max(320).nullable().optional() }).nullable().optional(),
});

/**
 * API de licenciamento do Norty — /api/norty/v1 (prefixo global "api" + "norty/v1").
 * Autenticada por token estático (NortyLicenseGuard). O Norty chama isto pra
 * vender/gerir licenças do Norty Vision.
 */
@Public()
@UseGuards(NortyLicenseGuard)
@Controller("norty/v1")
export class NortyLicenseController {
  constructor(private readonly svc: NortyLicenseService) {}

  @Get("me")
  me() { return this.svc.me(); }

  @Post("licenses")
  @HttpCode(200)
  create(@Body() body: unknown) { return this.svc.createLicense(LicenseSchema.parse(body) as any); }

  @Get("licenses/:id")
  get(@Param("id") id: string) { return this.svc.getLicense(id); }

  @Post("licenses/:id/suspend")
  @HttpCode(200)
  suspend(@Param("id") id: string) { return this.svc.setStatus(id, "SUSPENDED"); }

  @Post("licenses/:id/reactivate")
  @HttpCode(200)
  reactivate(@Param("id") id: string) { return this.svc.setStatus(id, "ACTIVE"); }

  @Post("licenses/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id") id: string) { return this.svc.setStatus(id, "CANCELED"); }

  @Get("plans")
  plans() { return this.svc.plans(); }
}
