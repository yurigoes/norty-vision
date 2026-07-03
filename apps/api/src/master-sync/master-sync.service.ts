import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { VaultService } from "../vault/vault.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ChatwootAdapter } from "../integrations/adapters/chatwoot.adapter";
import { GlpiAdapter } from "../integrations/adapters/glpi.adapter";
import type { AdapterCredentials } from "../integrations/adapters/types";

export interface ProviderResult {
  provider: string;
  ok: boolean;
  status?: number;
  message?: string;
}

@Injectable()
export class MasterSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly vault: VaultService,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * Auto-descobre external_admin_user_id em Chatwoot/GLPI pelo email do
   * master. Atualiza admin_credentials_vault. Exige cofre desbloqueado.
   *
   * Estrategia:
   *  - Chatwoot: nao existe GET /users index na Platform API. Tenta IDs
   *    comuns (1, 2, 3) que sao do primeiro super_admin criado no
   *    onboarding. Bate email pra confirmar.
   *  - GLPI: usa GET /search/User?email=... que e oficial.
   */
  async discoverExternalIds(opts: {
    platformUserId: string;
  }): Promise<{ chatwoot: string | null; glpi: string | null }> {
    if (!(await this.vault.isUnlocked(opts.platformUserId))) {
      throw new AppError(
        ErrorCode.Forbidden,
        "Desbloqueie o cofre primeiro",
        403,
        { unlockRequired: true },
      );
    }

    const platformUser = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.platformUser.findUnique({ where: { id: opts.platformUserId } }),
    );
    if (!platformUser) {
      throw new AppError(ErrorCode.NotFound, "Master nao encontrado", 404);
    }
    const email = platformUser.email;

    const result: { chatwoot: string | null; glpi: string | null } = {
      chatwoot: null,
      glpi: null,
    };

    // ---- Chatwoot ----
    const cwInt = await this.integrations.getByProvider({
      isPlatformAdmin: true,
      provider: "chatwoot",
    });
    if (cwInt && cwInt.status === "active") {
      const adapter = new ChatwootAdapter({
        baseUrl: cwInt.baseUrl,
        apiKey: cwInt.apiKey,
        apiToken: cwInt.apiToken,
      });
      for (const candidateId of [1, 2, 3, 4, 5]) {
        const r = await adapter.getUser(candidateId);
        if (r.ok && r.body?.email?.toLowerCase() === email.toLowerCase()) {
          result.chatwoot = String(candidateId);
          break;
        }
      }
    }

    // ---- GLPI ----
    const glpiInt = await this.integrations.getByProvider({
      isPlatformAdmin: true,
      provider: "glpi",
    });
    if (glpiInt && glpiInt.status === "active") {
      const adapter = new GlpiAdapter({
        baseUrl: glpiInt.baseUrl,
        apiKey: glpiInt.apiKey,
        apiToken: glpiInt.apiToken,
        username: glpiInt.username,
        password: glpiInt.password,
      });
      try {
        const r = await adapter.findUserByEmail(email);
        const firstRow = r.body?.data?.[0];
        if (firstRow && (firstRow as any)["2"]) {
          result.glpi = String((firstRow as any)["2"]);
        }
      } finally {
        await adapter.killSession();
      }
    }

    // grava no vault
    for (const provider of ["chatwoot", "glpi"] as const) {
      const id = result[provider];
      if (!id) continue;
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.adminCredentialsVault.update({
          where: { provider },
          data: { externalAdminUserId: id },
        }),
      );
    }

    return result;
  }

  /**
   * Sincroniza senha (e opcionalmente email) do master nos sistemas integrados.
   *
   * Requer:
   *  - cofre desbloqueado (sessao recente)
   *  - senha do platform_user atual (revalidacao)
   *  - external_admin_user_id preenchido no vault pra cada provider
   *
   * Atualiza:
   *  - platform_users (Argon2id)
   *  - Chatwoot via PATCH /platform/api/v1/users/:id
   *  - GLPI via PUT /apirest.php/User/:id
   *  - admin_credentials_vault.password (sincroniza o que esta visivel pro master)
   *
   * Evolution NAO tem user — ignorado.
   */
  async sync(opts: {
    platformUserId: string;
    currentPlatformPassword: string;
    newPassword?: string;
    newEmail?: string;
  }): Promise<{ providers: ProviderResult[]; updatedYugo: boolean }> {
    if (!opts.newPassword && !opts.newEmail) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Informe newPassword ou newEmail",
        400,
      );
    }

    // exige cofre desbloqueado
    if (!(await this.vault.isUnlocked(opts.platformUserId))) {
      throw new AppError(
        ErrorCode.Forbidden,
        "Desbloqueie o cofre primeiro",
        403,
        { unlockRequired: true },
      );
    }

    // valida senha atual
    const platformUser = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.platformUser.findUnique({ where: { id: opts.platformUserId } }),
    );
    if (!platformUser) {
      throw new AppError(ErrorCode.NotFound, "Master nao encontrado", 404);
    }
    const ok = await this.argon.verify(
      platformUser.passwordHash,
      opts.currentPlatformPassword,
    );
    if (!ok) {
      throw new AppError(ErrorCode.Unauthorized, "Senha atual incorreta", 401);
    }

    if (opts.newPassword) {
      this.validatePasswordStrength(opts.newPassword);
    }
    if (opts.newEmail) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.newEmail)) {
        throw new AppError(ErrorCode.ValidationFailed, "Email invalido", 400);
      }
    }

    // 1. atualiza yugo (platform_users)
    const updates: Record<string, unknown> = {};
    if (opts.newPassword) {
      updates.passwordHash = await this.argon.hash(opts.newPassword);
    }
    if (opts.newEmail) {
      updates.email = opts.newEmail.toLowerCase().trim();
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.update({
        where: { id: opts.platformUserId },
        data: updates,
      }),
    );

    // 2. atualiza Chatwoot e GLPI conforme vault
    const providerResults: ProviderResult[] = [];

    for (const provider of ["chatwoot", "glpi"] as const) {
      const result = await this.syncProvider({
        provider,
        platformUserId: opts.platformUserId,
        newPassword: opts.newPassword,
        newEmail: opts.newEmail,
      });
      providerResults.push(result);
    }

    return {
      providers: providerResults,
      updatedYugo: true,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================
  private async syncProvider(opts: {
    provider: "chatwoot" | "glpi";
    platformUserId: string;
    newPassword?: string;
    newEmail?: string;
  }): Promise<ProviderResult> {
    const provider = opts.provider;

    // 1. busca config da integration
    const integration = await this.integrations.getByProvider({
      isPlatformAdmin: true,
      provider,
    });
    if (!integration || integration.status !== "active") {
      return {
        provider,
        ok: false,
        message: "Integracao nao esta ativa em platform_integrations",
      };
    }

    // 2. busca external_admin_user_id no vault
    const vaultRow = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.adminCredentialsVault.findUnique({ where: { provider } }),
    );
    if (!vaultRow?.externalAdminUserId) {
      return {
        provider,
        ok: false,
        message:
          "Preencha 'External admin user ID' no cofre antes de sincronizar",
      };
    }

    const creds: AdapterCredentials = {
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      apiToken: integration.apiToken,
      username: integration.username,
      password: integration.password,
    };

    if (provider === "chatwoot") {
      const adapter = new ChatwootAdapter(creds);
      const r = await adapter.updateUser({
        id: vaultRow.externalAdminUserId,
        password: opts.newPassword,
        email: opts.newEmail,
      });
      if (r.ok) {
        await this.syncVaultPassword(provider, opts.newPassword);
        return { provider, ok: true, status: r.status };
      }
      return {
        provider,
        ok: false,
        status: r.status,
        message: r.error ?? "Falha no Chatwoot",
      };
    }

    if (provider === "glpi") {
      const adapter = new GlpiAdapter(creds);
      try {
        const r = await adapter.updateUser({
          id: vaultRow.externalAdminUserId,
          password: opts.newPassword,
          email: opts.newEmail,
        });
        if (r.ok) {
          await this.syncVaultPassword(provider, opts.newPassword);
          return { provider, ok: true, status: r.status };
        }
        return {
          provider,
          ok: false,
          status: r.status,
          message: r.error ?? "Falha no GLPI",
        };
      } finally {
        await adapter.killSession();
      }
    }

    return { provider, ok: false, message: "Provider nao suportado" };
  }

  private async syncVaultPassword(
    provider: string,
    newPassword?: string,
  ): Promise<void> {
    if (!newPassword) return;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.adminCredentialsVault.update({
        where: { provider },
        data: { password: newPassword },
      }),
    );
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 12) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha precisa de no minimo 12 caracteres",
        400,
      );
    }
    if (!/[a-z]/.test(password)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Inclua letra minuscula",
        400,
      );
    }
    if (!/[A-Z]/.test(password)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Inclua letra maiuscula",
        400,
      );
    }
    if (!/\d/.test(password)) {
      throw new AppError(ErrorCode.ValidationFailed, "Inclua numero", 400);
    }
  }
}
