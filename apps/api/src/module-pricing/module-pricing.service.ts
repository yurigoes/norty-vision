import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";

const SetSchema = z.object({ priceCents: z.number().int().min(0).max(100000000), active: z.boolean().optional() });

@Injectable()
export class ModulePricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista todos os preços de módulo (referência global). */
  async list() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.modulePrice.findMany({ orderBy: { moduleKey: "asc" } }),
    );
  }

  /** Preço de um módulo específico (ou null). */
  async get(key: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.modulePrice.findUnique({ where: { moduleKey: key } }),
    );
  }

  /** Master define/atualiza o preço à la carte de um módulo. */
  async set(key: string, body: unknown) {
    const input = SetSchema.parse(body);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.modulePrice.upsert({
        where: { moduleKey: key },
        create: { moduleKey: key, priceCents: input.priceCents, active: input.active ?? true },
        update: { priceCents: input.priceCents, active: input.active ?? true, updatedAt: new Date() },
      }),
    );
  }
}
