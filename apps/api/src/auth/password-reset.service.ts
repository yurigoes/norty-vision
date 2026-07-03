import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "./argon.service";
import { EmailService } from "../notifications/email.service";
import { loadEnv } from "../config";

const TOKEN_TTL_MINUTES = 30;

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly email: EmailService,
  ) {}

  /**
   * Solicita reset. Sempre retorna 200 (nao revela se email existe ou nao).
   * Se o user existir, envia email com link.
   */
  async request(opts: {
    email: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ ok: true }> {
    const email = opts.email.toLowerCase().trim();
    const env = loadEnv();

    const user = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.user.findUnique({ where: { email } }),
    );

    if (!user) {
      // timing pad: gasta tempo similar pra nao vazar existencia
      await this.argon.hash("placeholder-not-real");
      return { ok: true };
    }

    // gera token raw + hash + grava
    const raw = randomBytes(32).toString("base64url");
    const tokenHash = sha256(raw);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

    await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            channel: "email",
            deliveredTo: user.email,
            expiresAt,
            requestIp: opts.ipAddress ?? null,
            userAgent: opts.userAgent ?? null,
          },
        }),
    );

    const resetUrl = `${env.APP_PUBLIC_URL}/redefinir-senha?token=${encodeURIComponent(raw)}`;

    try {
      await this.email.sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (e) {
      // log mas nao revela falha pro caller (privacidade)
      console.error("[password-reset] email send failed:", e);
    }

    return { ok: true };
  }

  /**
   * Confirma reset: valida token, troca senha, invalida sessoes existentes.
   */
  async confirm(opts: {
    token: string;
    newPassword: string;
  }): Promise<{ ok: true; userId: string }> {
    if (opts.newPassword.length < 8) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha precisa de no minimo 8 caracteres",
        400,
      );
    }
    const tokenHash = sha256(opts.token);
    const record = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.passwordResetToken.findUnique({ where: { tokenHash } }),
    );
    if (!record) {
      throw new AppError(ErrorCode.NotFound, "Token invalido", 404);
    }
    if (record.usedAt) {
      throw new AppError(ErrorCode.Conflict, "Token ja usado", 409);
    }
    if (record.expiresAt < new Date()) {
      throw new AppError(ErrorCode.ValidationFailed, "Token expirado", 410);
    }
    if (!record.userId) {
      throw new AppError(ErrorCode.NotFound, "Token sem usuario", 404);
    }

    const newHash = await this.argon.hash(opts.newPassword);

    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      // atualiza senha
      await tx.user.update({
        where: { id: record.userId! },
        data: {
          passwordHash: newHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // invalida todas as sessoes do user
      await tx.session.updateMany({
        where: { userId: record.userId!, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "password_reset" },
      });
      // marca token como usado
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    });

    return { ok: true, userId: record.userId };
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
