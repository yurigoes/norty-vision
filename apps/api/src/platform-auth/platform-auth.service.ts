import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { loadEnv } from "../config";

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
  ) {}

  async login(opts: {
    email: string;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ rawToken: string; expiresAt: Date; platformUserId: string }> {
    const env = loadEnv();
    const email = opts.email.toLowerCase().trim();

    // RLS: precisa is_platform_admin=true pra ler tabela.
    // Usamos bypass aqui setando o flag.
    const user = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.findUnique({ where: { email } }),
    );

    // timing-attack safe: verify mesmo se user nao existir
    if (!user) {
      await this.argon
        .verify(
          "$argon2id$v=19$m=19456,t=2,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000",
          opts.password,
        )
        .catch(() => false);
      throw new AppError(ErrorCode.Unauthorized, "Credenciais invalidas", 401);
    }

    if (user.status !== "active") {
      throw new AppError(ErrorCode.Forbidden, "Conta master nao esta ativa", 403);
    }

    const ok = await this.argon.verify(user.passwordHash, opts.password);
    if (!ok) {
      throw new AppError(ErrorCode.Unauthorized, "Credenciais invalidas", 401);
    }

    // rehash se necessario
    if (this.argon.needsRehash(user.passwordHash)) {
      const newHash = await this.argon.hash(opts.password);
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.platformUser.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        }),
      );
    }

    // gera token + cria sessao
    const raw = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(
      Date.now() + env.MASTER_SESSION_DURATION_HOURS * 3600_000,
    );

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformSession.create({
        data: {
          platformUserId: user.id,
          tokenHash,
          ipAddress: opts.ipAddress ?? null,
          userAgent: opts.userAgent ?? null,
          expiresAt,
          // owner vê tudo; demais (support) veem só as categorias concedidas (grants)
          techSpecsCategories: user.role === "owner" ? ["*"] : (user.techSpecsCategories ?? []),
        },
      }),
    );

    return { rawToken: raw, expiresAt, platformUserId: user.id };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "logout" },
      }),
    );
  }
}
