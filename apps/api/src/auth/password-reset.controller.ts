import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Public } from "./decorators";
import { PasswordResetService } from "./password-reset.service";

const RequestInput = z.object({
  email: z.string().email().max(320).trim().toLowerCase(),
});

const ConfirmInput = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(256),   // a partir de 8 caracteres
});

@Controller("auth/password-reset")
export class PasswordResetController {
  constructor(private readonly svc: PasswordResetService) {}

  @Public()
  @Post("request")
  @HttpCode(200)
  async request(@Req() req: FastifyRequest, @Body() body: unknown) {
    const input = RequestInput.parse(body);
    const ipAddress =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ?? req.ip ?? null;
    return this.svc.request({
      email: input.email,
      ipAddress,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  @Public()
  @Post("confirm")
  @HttpCode(200)
  async confirm(@Body() body: unknown) {
    const input = ConfirmInput.parse(body);
    return this.svc.confirm(input);
  }
}
