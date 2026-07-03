import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { RateLimitService } from "../redis/rate-limit.service";
import { ContactService } from "./contact.service";

const SubmitSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(320),
  phone: z.string().max(30).nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  segment: z.string().max(40).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

function clientIp(req: FastifyRequest): string | null {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

@Controller()
export class ContactController {
  constructor(
    private readonly svc: ContactService,
    private readonly rate: RateLimitService,
  ) {}

  /** Público: formulário da landing. Rate-limit 5/h por IP. */
  @Public()
  @Post("contact")
  @HttpCode(200)
  async submit(@Body() body: unknown, @Req() req: FastifyRequest) {
    const ip = clientIp(req);
    await this.rate.enforce(`contact:${ip ?? "anon"}`, 5, 3600);
    return this.svc.submit(SubmitSchema.parse(body), ip, req.headers["user-agent"] ?? null);
  }

  // ---- master inbox ----
  @Get("platform/contacts")
  async list(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.list(ctx, status) };
  }

  @Patch("platform/contacts/:id")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      status: z.enum(["new", "contacted", "won", "lost"]).optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(body);
    return { contact: await this.svc.update(ctx, id, input) };
  }
}
