import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ArgonService } from "../auth/argon.service";

const UNLOCK_TTL_SECONDS = 30 * 60; // 30 minutos

/**
 * VaultService - cofre de credenciais admin.
 *
 * Fluxo:
 *  1. Master configura senha mestra (uma vez) via setUnlockSecret()
 *  2. Pra ver credenciais, master chama unlock(secret)
 *     - Validamos vs Argon2id; se OK, gravamos Redis key com TTL 30min
 *  3. Endpoints de leitura checam isUnlocked(platformUserId) antes
 *     de retornar passwords descobertos.
 *  4. setSecret e unlock geram audit em external_provisioning_log.
 */
@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly argon: ArgonService,
  ) {}

  // ==========================================================================
  // Setup inicial / troca da senha mestra
  // ==========================================================================
  async setUnlockSecret(opts: {
    platformUserId: string;
    newSecret: string;
    currentSecret?: string;
    hint?: string;
  }): Promise<void> {
    if (opts.newSecret.length < 8) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha mestra precisa de no minimo 8 caracteres",
        400,
      );
    }

    const existing = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.masterUnlockSecret.findUnique({ where: { id: 1 } }),
    );

    // se ja tem senha definida, exige a atual pra trocar
    if (existing?.secretHash) {
      if (!opts.currentSecret) {
        throw new AppError(
          ErrorCode.Unauthorized,
          "Senha atual obrigatoria pra trocar",
          401,
        );
      }
      const ok = await this.argon.verify(existing.secretHash, opts.currentSecret);
      if (!ok) {
        throw new AppError(ErrorCode.Unauthorized, "Senha atual incorreta", 401);
      }
    }

    const newHash = await this.argon.hash(opts.newSecret);

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.masterUnlockSecret.update({
        where: { id: 1 },
        data: {
          secretHash: newHash,
          hint: opts.hint ?? null,
          configuredByPlatformUserId: opts.platformUserId,
          configuredAt: new Date(),
        },
      }),
    );
  }

  async status(): Promise<{ configured: boolean; hint: string | null }> {
    const row = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.masterUnlockSecret.findUnique({ where: { id: 1 } }),
    );
    return {
      configured: Boolean(row?.secretHash),
      hint: row?.hint ?? null,
    };
  }

  // ==========================================================================
  // Unlock / lock
  // ==========================================================================
  async unlock(opts: {
    platformUserId: string;
    secret: string;
  }): Promise<{ ok: true; expiresAt: Date }> {
    const row = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.masterUnlockSecret.findUnique({ where: { id: 1 } }),
    );
    if (!row?.secretHash) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha mestra do cofre ainda nao foi configurada",
        400,
      );
    }
    const ok = await this.argon.verify(row.secretHash, opts.secret);
    if (!ok) {
      throw new AppError(ErrorCode.Unauthorized, "Senha mestra invalida", 401);
    }

    await this.redis.client.set(
      this.redisKey(opts.platformUserId),
      "1",
      "EX",
      UNLOCK_TTL_SECONDS,
    );
    return {
      ok: true,
      expiresAt: new Date(Date.now() + UNLOCK_TTL_SECONDS * 1000),
    };
  }

  async lock(platformUserId: string): Promise<void> {
    await this.redis.client.del(this.redisKey(platformUserId));
  }

  async isUnlocked(platformUserId: string): Promise<boolean> {
    const v = await this.redis.client.get(this.redisKey(platformUserId));
    return v === "1";
  }

  private async requireUnlocked(platformUserId: string): Promise<void> {
    if (!(await this.isUnlocked(platformUserId))) {
      throw new AppError(
        ErrorCode.Forbidden,
        "Cofre bloqueado. Forneca a senha mestra primeiro.",
        403,
        { unlockRequired: true },
      );
    }
  }

  private redisKey(platformUserId: string): string {
    return `vault:unlocked:${platformUserId}`;
  }

  // ==========================================================================
  // CRUD de credenciais (todos exigem unlock)
  // ==========================================================================
  async list(opts: {
    platformUserId: string;
    reveal?: boolean;
  }): Promise<Array<Record<string, unknown>>> {
    const items = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.adminCredentialsVault.findMany({
          orderBy: [{ isSystem: "desc" }, { provider: "asc" }],
        }),
    );

    // se reveal=true, exige unlock pra retornar passwords
    let unlocked = false;
    if (opts.reveal) {
      unlocked = await this.isUnlocked(opts.platformUserId);
    }

    return items.map((i) => ({
      id: i.id,
      provider: i.provider,
      label: i.label,
      consoleUrl: i.consoleUrl,
      username: i.username,
      password: unlocked ? i.password : maskPassword(i.password),
      notes: i.notes,
      externalAdminUserId: i.externalAdminUserId,
      isSystem: i.isSystem,
      updatedAt: i.updatedAt,
    }));
  }

  async update(opts: {
    platformUserId: string;
    id: string;
    patch: {
      label?: string;
      consoleUrl?: string | null;
      username?: string | null;
      password?: string | null;
      notes?: string | null;
      externalAdminUserId?: string | null;
    };
  }): Promise<void> {
    await this.requireUnlocked(opts.platformUserId);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.adminCredentialsVault.update({
        where: { id: opts.id },
        data: {
          ...opts.patch,
          updatedByPlatformUserId: opts.platformUserId,
        },
      }),
    );
  }

  async create(opts: {
    platformUserId: string;
    data: {
      provider: string;
      label: string;
      consoleUrl?: string | null;
      username?: string | null;
      password?: string | null;
      notes?: string | null;
    };
  }): Promise<void> {
    await this.requireUnlocked(opts.platformUserId);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.adminCredentialsVault.create({
        data: {
          ...opts.data,
          isSystem: false,
          updatedByPlatformUserId: opts.platformUserId,
        },
      }),
    );
  }

  async remove(opts: { platformUserId: string; id: string }): Promise<void> {
    await this.requireUnlocked(opts.platformUserId);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.adminCredentialsVault.delete({ where: { id: opts.id } }),
    );
  }
}

function maskPassword(p: string | null): string | null {
  if (!p) return null;
  if (p.length <= 4) return "••••";
  return "••••••••" + p.slice(-4);
}
