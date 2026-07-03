import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ProspectorService } from "./prospector.service";

const FilterSchema = z.object({ k: z.string().min(1).max(40), v: z.string().min(1).max(60) });
const CampaignSchema = z.object({
  name: z.string().min(1).max(120),
  source: z.enum(["osm", "cnpj"]).optional(),
  osmFilters: z.array(FilterSchema).max(10).optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  limitPerRun: z.number().int().optional(),
  frequency: z.enum(["manual", "daily", "weekly"]).optional(),
  autoCreateLead: z.boolean().optional(),
  enrichCnpjAuto: z.boolean().optional(),
  active: z.boolean().optional(),
});

@Controller("prospector")
export class ProspectorController {
  constructor(private readonly svc: ProspectorService) {}

  @Get("campaigns")
  async list(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.list(ctx) }; }

  @Post("campaigns")
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) { return { campaign: await this.svc.create(ctx, CampaignSchema.parse(body)) }; }

  @Patch("campaigns/:id")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) { return { campaign: await this.svc.update(ctx, id, CampaignSchema.partial().parse(body)) }; }

  @Delete("campaigns/:id")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.remove(ctx, id); }

  @Post("campaigns/:id/run")
  @HttpCode(200)
  async run(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.run(ctx, id); }

  @Get("campaigns/:id/results")
  async results(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { items: await this.svc.results(ctx, id) }; }

  /** Enriquece um resultado por CNPJ ao vivo (BrasilAPI). */
  @Post("results/:id/enrich")
  @HttpCode(200)
  async enrich(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { result: await this.svc.enrichResult(ctx, id) }; }

  /** Consulta ad-hoc de um CNPJ (BrasilAPI). createLead=true joga na fila. */
  @Post("cnpj/lookup")
  @HttpCode(200)
  async cnpjLookup(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ cnpj: z.string().min(11).max(20), createLead: z.boolean().optional() }).parse(body);
    return this.svc.lookupCnpj(ctx, input.cnpj, input.createLead ?? false);
  }

  // ---- base CNPJ (master importa; todos consultam via campanha cnpj) ----
  @Get("cnpj/count")
  async cnpjCount() { return { count: await this.svc.cnpjCount() }; }
  @Post("cnpj/import")
  @HttpCode(200)
  async cnpjImport(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ csv: z.string().min(1) }).parse(body);
    return this.svc.importCnpj(ctx, input.csv);
  }

  @Get("optout")
  async optout(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listOptout(ctx) }; }
  @Post("optout")
  @HttpCode(200)
  async addOptout(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ value: z.string().min(3).max(40), kind: z.enum(["phone", "cnpj"]).optional() }).parse(body);
    return { optout: await this.svc.addOptout(ctx, input.value, input.kind ?? "phone") };
  }
}
