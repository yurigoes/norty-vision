import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";

interface UpsertNicheInput {
  key?: string;
  label?: string;
  hiddenModuleKeys?: string[];
  isActive?: boolean;
  displayOrder?: number;
}

@Injectable()
export class NichesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista todos os nichos (master). Ordenados por displayOrder. */
  async listAll() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.findMany({ orderBy: { displayOrder: "asc" } }),
    );
  }

  /** Lista nichos ativos — usado pra popular selects (ex.: nicho do plano/empresa). */
  async listActive() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { key: true, label: true } }),
    );
  }

  /** Deny-list de módulos do nicho (módulos que NÃO aparecem). [] se desconhecido. */
  async hiddenModulesForNiche(nicheKey: string | null | undefined): Promise<string[]> {
    const key = (nicheKey ?? "").toLowerCase().trim() || "generico";
    const row = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.findFirst({ where: { key }, select: { hiddenModuleKeys: true } }),
    ).catch(() => null);
    const arr = row?.hiddenModuleKeys;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  }

  async create(input: UpsertNicheInput) {
    const key = (input.key ?? "").toLowerCase().trim();
    if (!/^[a-z0-9-]{2,40}$/.test(key)) {
      throw new AppError(ErrorCode.ValidationFailed, "Chave inválida. Use 2-40 caracteres: letras minúsculas, números e hífen.", 400);
    }
    const exists = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.findFirst({ where: { key }, select: { id: true } }),
    );
    if (exists) throw new AppError(ErrorCode.Conflict, `Já existe um nicho com a chave "${key}".`, 409);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.create({
        data: {
          key,
          label: (input.label ?? key).slice(0, 80),
          hiddenModuleKeys: this.sanitizeKeys(input.hiddenModuleKeys) as any,
          isActive: input.isActive ?? true,
          displayOrder: Math.floor(input.displayOrder ?? 0),
        },
      }),
    );
  }

  async update(id: string, input: UpsertNicheInput) {
    const data: Record<string, unknown> = {};
    if (input.label !== undefined) data.label = String(input.label).slice(0, 80);
    if (input.hiddenModuleKeys !== undefined) data.hiddenModuleKeys = this.sanitizeKeys(input.hiddenModuleKeys);
    if (input.isActive !== undefined) data.isActive = !!input.isActive;
    if (input.displayOrder !== undefined) data.displayOrder = Math.floor(input.displayOrder);
    data.updatedAt = new Date();
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.update({ where: { id }, data }),
    );
  }

  async remove(id: string) {
    // Não deixa apagar nicho em uso por alguma empresa (evita órfão).
    const niche = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.niche.findFirst({ where: { id }, select: { key: true } }),
    );
    if (!niche) throw new AppError(ErrorCode.NotFound, "Nicho não encontrado", 404);
    const inUse = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.count({ where: { niche: niche.key, deletedAt: null } }),
    );
    if (inUse > 0) throw new AppError(ErrorCode.Conflict, `Não dá pra excluir: ${inUse} empresa(s) usam o nicho "${niche.key}". Troque o nicho delas antes.`, 409);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.niche.delete({ where: { id } }));
    return { ok: true };
  }

  private sanitizeKeys(keys?: string[]): string[] {
    if (!Array.isArray(keys)) return [];
    return [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))].slice(0, 200);
  }
}
