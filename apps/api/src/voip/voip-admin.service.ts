import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { encryptSipPass } from "./voip.service";

const ADM = { isPlatformAdmin: true as const };

/** Admin do call center por empresa (orgAdmin). CRUD de trunks, DIDs, grupos
 *  e membros. Nunca devolve a senha SIP em plain. */
@Injectable()
export class VoipAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin }; }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Só admin", 403);
  }
  private redactTrunk<T extends { sipPassEnc?: string | null }>(t: T): Omit<T, "sipPassEnc"> & { hasPass: boolean } {
    const { sipPassEnc, ...rest } = t as any;
    return { ...rest, hasPass: !!sipPassEnc };
  }

  // ============== TRUNKS ==============
  async listTrunks(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipTrunk.findMany({ orderBy: { createdAt: "asc" } }));
    return { items: rows.map((t) => this.redactTrunk(t)) };
  }
  async createTrunk(ctx: RequestContext, dto: { name: string; sipHost: string; sipUser: string; sipPass: string; register?: boolean; callerIdName?: string }) {
    this.requireAdmin(ctx);
    const enc = encryptSipPass(dto.sipPass);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipTrunk.create({
      data: { organizationId: ctx.orgId!, name: dto.name, sipHost: dto.sipHost, sipUser: dto.sipUser, sipPassEnc: enc, register: dto.register ?? true, callerIdName: dto.callerIdName ?? null },
    }));
    return this.redactTrunk(row);
  }
  async updateTrunk(ctx: RequestContext, id: string, dto: { name?: string; sipHost?: string; sipUser?: string; sipPass?: string; register?: boolean; active?: boolean; callerIdName?: string }) {
    this.requireAdmin(ctx);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sipHost !== undefined) data.sipHost = dto.sipHost;
    if (dto.sipUser !== undefined) data.sipUser = dto.sipUser;
    if (dto.register !== undefined) data.register = dto.register;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.callerIdName !== undefined) data.callerIdName = dto.callerIdName;
    if (dto.sipPass !== undefined && dto.sipPass !== "") data.sipPassEnc = encryptSipPass(dto.sipPass);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipTrunk.update({ where: { id }, data }));
    return this.redactTrunk(row);
  }
  async deleteTrunk(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipTrunk.delete({ where: { id } }));
    return { ok: true };
  }

  // ============== DIDs ==============
  async listDids(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipDid.findMany({ orderBy: { createdAt: "asc" } }));
    return { items };
  }
  async createDid(ctx: RequestContext, dto: { trunkId: string; number: string; label?: string; inboundKind?: string; inboundId?: string; fallbackKind?: string; fallbackId?: string }) {
    this.requireAdmin(ctx);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipDid.create({
      data: {
        organizationId: ctx.orgId!, trunkId: dto.trunkId, number: dto.number.replace(/\D/g, ""),
        label: dto.label ?? null, inboundKind: dto.inboundKind ?? "group", inboundId: dto.inboundId ?? null,
        fallbackKind: dto.fallbackKind ?? null, fallbackId: dto.fallbackId ?? null,
      },
    }));
    return row;
  }
  async updateDid(ctx: RequestContext, id: string, dto: { number?: string; label?: string; inboundKind?: string; inboundId?: string | null; fallbackKind?: string | null; fallbackId?: string | null; active?: boolean }) {
    this.requireAdmin(ctx);
    const data: any = {};
    if (dto.number !== undefined) data.number = dto.number.replace(/\D/g, "");
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.inboundKind !== undefined) data.inboundKind = dto.inboundKind;
    if (dto.inboundId !== undefined) data.inboundId = dto.inboundId;
    if (dto.fallbackKind !== undefined) data.fallbackKind = dto.fallbackKind;
    if (dto.fallbackId !== undefined) data.fallbackId = dto.fallbackId;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipDid.update({ where: { id }, data }));
  }
  async deleteDid(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipDid.delete({ where: { id } }));
    return { ok: true };
  }

  // ============== GROUPS ==============
  async listGroups(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const groups = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroup.findMany({ orderBy: { name: "asc" } }));
    const counts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroupMember.groupBy({ by: ["groupId"], _count: { _all: true }, where: { active: true } })).catch(() => [] as any[]);
    const map = new Map<string, number>();
    for (const c of counts as any[]) map.set(c.groupId, c._count._all);
    return { items: groups.map((g) => ({ ...g, memberCount: map.get(g.id) ?? 0 })) };
  }
  async createGroup(ctx: RequestContext, dto: { name: string; strategy?: string; ringTimeoutS?: number }) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroup.create({
      data: { organizationId: ctx.orgId!, name: dto.name, strategy: dto.strategy ?? "all", ringTimeoutS: dto.ringTimeoutS ?? 25 },
    }));
  }
  async updateGroup(ctx: RequestContext, id: string, dto: { name?: string; strategy?: string; ringTimeoutS?: number }) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroup.update({ where: { id }, data: dto }));
  }
  async deleteGroup(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroup.delete({ where: { id } }));
    return { ok: true };
  }

  // ============== GROUP MEMBERS ==============
  async listMembers(ctx: RequestContext, groupId: string) {
    this.requireAdmin(ctx);
    const members = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroupMember.findMany({ where: { groupId }, orderBy: { priority: "asc" } }));
    if (!members.length) return { items: [] };
    const membershipIds = members.map((m) => m.membershipId);
    const memberships = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findMany({ where: { id: { in: membershipIds } }, select: { id: true, user: { select: { name: true } } } }));
    const exts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findMany({ where: { membershipId: { in: membershipIds } }, select: { membershipId: true, extension: true } }));
    const nameOf = new Map<string, string>();
    for (const m of memberships) nameOf.set(m.id, m.user?.name ?? "—");
    const extOf = new Map<string, string>();
    for (const e of exts) if (e.membershipId) extOf.set(e.membershipId, e.extension);
    return { items: members.map((m) => ({ id: m.id, membershipId: m.membershipId, name: nameOf.get(m.membershipId) ?? "—", extension: extOf.get(m.membershipId) ?? null, priority: m.priority, active: m.active })) };
  }
  async addMember(ctx: RequestContext, groupId: string, dto: { membershipId: string; priority?: number }) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroupMember.create({
      data: { organizationId: ctx.orgId!, groupId, membershipId: dto.membershipId, priority: dto.priority ?? 0 },
    }));
  }
  async removeMember(ctx: RequestContext, groupId: string, memberId: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipGroupMember.deleteMany({ where: { id: memberId, groupId } }));
    return { ok: true };
  }

  // ============== OPERADORES (p/ picker dos grupos) ==============
  async listOperators(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const members = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findMany({
      where: { organizationId: ctx.orgId!, status: "active" },
      select: {
        id: true,
        role: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { user: { name: "asc" } },
    }));
    const exts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.voipExtension.findMany({
      where: { membershipId: { in: members.map((m) => m.id) }, active: true },
      select: { membershipId: true, extension: true },
    }));
    const extOf = new Map<string, string>();
    for (const e of exts) if (e.membershipId) extOf.set(e.membershipId, e.extension);
    return { items: members.map((m) => ({
      membershipId: m.id,
      name: m.user?.name ?? m.user?.email ?? "—",
      role: m.role?.name ?? null,
      extension: extOf.get(m.id) ?? null,
    })) };
  }
}
