import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { loadEnv } from "../config";

// otplib default: SHA1, 30s, 6 digits - padrao TOTP compativel com Google Authenticator
authenticator.options = { window: 1 };

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1) Inicia setup: gera secret novo, retorna QR code (data URL) pra escanear.
   *    NAO ativa MFA ainda. User precisa chamar enable() com o codigo certo.
   */
  async startSetup(userId: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const user = await this.prisma.runWithContext(
      { isPlatformAdmin: true, userId },
      (tx) => tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new AppError(ErrorCode.NotFound, "Usuario nao encontrado", 404);

    const env = loadEnv();
    const issuer = "yugochat";
    const accountName = user.email;
    const secret = authenticator.generateSecret(32);
    const otpauthUrl = authenticator.keyuri(accountName, issuer, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // grava o secret PENDENTE (mfa_secret); mfa_enabled fica false ate enable()
    await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.update({
          where: { id: userId },
          data: { mfaSecret: secret, mfaEnabled: false },
        }),
    );

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * 2) Ativa MFA validando o primeiro codigo (prova que o user escaneou).
   */
  async enable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user || !user.mfaSecret) {
      throw new AppError(ErrorCode.ValidationFailed, "Setup nao iniciado", 400);
    }
    if (!this.verifyCode(user.mfaSecret, code)) {
      throw new AppError(ErrorCode.MfaInvalid, "Codigo invalido", 400);
    }
    await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.update({
          where: { id: userId },
          data: { mfaEnabled: true },
        }),
    );
  }

  /**
   * Verifica codigo TOTP em login.
   */
  verifyCode(secret: string, code: string): boolean {
    if (!code || !secret) return false;
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) return false;
    try {
      return authenticator.verify({ token: clean, secret });
    } catch {
      return false;
    }
  }

  /**
   * Desativa MFA (exige codigo valido + senha verificada pelo caller).
   */
  async disable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new AppError(ErrorCode.NotFound, "Usuario nao encontrado", 404);
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new AppError(ErrorCode.ValidationFailed, "MFA nao esta ativo", 400);
    }
    if (!this.verifyCode(user.mfaSecret, code)) {
      throw new AppError(ErrorCode.MfaInvalid, "Codigo invalido", 400);
    }
    await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.update({
          where: { id: userId },
          data: { mfaEnabled: false, mfaSecret: null },
        }),
    );
  }
}
