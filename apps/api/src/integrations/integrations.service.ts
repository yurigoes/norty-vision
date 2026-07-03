import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listGlobal(opts: { isPlatformAdmin: boolean }) {
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      (tx) =>
        tx.platformIntegration.findMany({
          where: { organizationId: null },
          orderBy: [{ provider: "asc" }],
        }),
    );
  }

  async getByProvider(opts: { isPlatformAdmin: boolean; provider: string }) {
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      (tx) =>
        tx.platformIntegration.findFirst({
          where: { provider: opts.provider, organizationId: null },
        }),
    );
  }

  async update(
    opts: { isPlatformAdmin: boolean; platformUserId: string | null; provider: string },
    patch: Record<string, unknown>,
  ) {
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      async (tx) => {
        const existing = await tx.platformIntegration.findFirst({
          where: { provider: opts.provider, organizationId: null },
        });

        const data: Record<string, unknown> = {
          ...patch,
          updatedByPlatformUserId: opts.platformUserId ?? null,
        };
        // mesmo critério da empresa: ao salvar credencial (apiToken/apiKey/senha)
        // sem status explícito, marca como ativa em vez de deixar estado antigo.
        if (data.status === undefined && (patch.apiToken || patch.apiKey || patch.password)) {
          data.status = "active";
        }

        if (existing) {
          return tx.platformIntegration.update({
            where: { id: existing.id },
            data,
          });
        }
        return tx.platformIntegration.create({
          data: {
            provider: opts.provider,
            label: String(patch.label ?? opts.provider),
            baseUrl: String(patch.baseUrl ?? ""),
            ...data,
          },
        });
      },
    );
  }
}
