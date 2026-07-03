import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { QuotesService } from "./quotes.service";

const ItemSchema = z.object({ description: z.string().min(1).max(300), qty: z.number().int().min(1).max(100000), unitPriceCents: z.number().int().min(0) });
const UpsertSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  contactName: z.string().min(1).max(200),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  storeId: z.string().uuid().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  discountCents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(ItemSchema).min(1),
});

@Controller("quotes")
export class QuotesController {
  constructor(private readonly svc: QuotesService) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.list(ctx, { status }) };
  }
  @Get(":id")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { quote: await this.svc.getById(ctx, id) };
  }
  @Get(":id/pdf")
  async pdf(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.svc.pdfBuffer(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
  @Post()
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { quote: await this.svc.create(ctx, UpsertSchema.parse(body)) };
  }
  @Patch(":id")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { quote: await this.svc.update(ctx, id, UpsertSchema.partial().parse(body)) };
  }
  @Patch(":id/status")
  async setStatus(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string }) {
    return { quote: await this.svc.setStatus(ctx, id, b?.status) };
  }
  @Post(":id/send")
  @HttpCode(200)
  async send(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { channel?: "whatsapp" | "email" | "both" }) {
    return this.svc.send(ctx, id, b?.channel ?? "both");
  }
  @Post(":id/convert")
  @HttpCode(200)
  async convert(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.convertToProduction(ctx, id);
  }
  @Delete(":id")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.remove(ctx, id);
  }
}
