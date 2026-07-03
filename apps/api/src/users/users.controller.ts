import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { UsersService } from "./users.service";

const CreateUserSchema = z.object({
  organizationId: z.string().uuid().optional(),
  storeId: z.string().uuid().nullable().optional(),
  roleSlug: z.string().min(2).max(40),
  email: z.string().email().max(320),
  name: z.string().min(2).max(120),
  phone: z.string().max(30).nullable().optional(),
  password: z.string().min(8).max(256),
  alsoProfessional: z.boolean().optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(30).nullable().optional(),
  status: z.enum(["active", "suspended", "invited"]).optional(),
  password: z.string().min(8).max(256).optional(),
});

const CreateMembershipSchema = z.object({
  organizationId: z.string().uuid().optional(),
  storeId: z.string().uuid().nullable().optional(),
  roleSlug: z.string().min(2).max(40),
});

const UpsertRoleSchema = z.object({
  organizationId: z.string().uuid().optional(),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  name: z.string().min(2).max(60),
  description: z.string().max(200).nullable().optional(),
  permissions: z.record(z.boolean()).default({}),
  isActive: z.boolean().optional(),
});

@Controller("users")
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get("sellers")
  async listSellers(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listSellers(ctx) };
  }

  @Patch(":id/commission")
  async setCommission(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { commissionPct } = z
      .object({ commissionPct: z.number().min(0).max(100).nullable() })
      .parse(body);
    return this.svc.setCommission(ctx, id, commissionPct);
  }

  @Patch(":id/seller")
  async setSeller(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { isSeller } = z.object({ isSeller: z.boolean() }).parse(body);
    return this.svc.setSeller(ctx, id, isSeller);
  }

  @Post(":id/reset-password")
  async resetPassword(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.resetPassword(ctx, id);
  }

  /** Desbloqueia a conta: limpa o lock por tentativas e reativa (status=active). */
  @Post(":id/unblock")
  @HttpCode(200)
  async unblock(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.unblock(ctx, id);
  }

  /** Envia login + senha por email/WhatsApp. A senha vem do admin (recém definida). */
  @Post(":id/send-credentials")
  @HttpCode(200)
  async sendCredentials(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ password: z.string().max(256).nullable().optional() }).parse(body ?? {});
    return this.svc.sendCredentials(ctx, id, input);
  }

  /** Troca o papel de um vínculo. */
  @Patch("memberships/:membershipId/role")
  async setMembershipRole(@CurrentContext() ctx: RequestContext, @Param("membershipId") membershipId: string, @Body() body: unknown) {
    const input = z.object({ roleSlug: z.string().min(2).max(40) }).parse(body);
    return this.svc.setMembershipRole(ctx, membershipId, input.roleSlug);
  }

  /** Overrides de permissão por usuário. */
  @Patch("memberships/:membershipId/permissions")
  async setMembershipPermissions(@CurrentContext() ctx: RequestContext, @Param("membershipId") membershipId: string, @Body() body: unknown) {
    // Aceitamos record(any) — o service sanitiza pra só guardar chaves válidas
    // do catálogo com valor true. Isso evita o erro "Expected boolean, received
    // object" quando o front carrega permissões legadas aninhadas dos papéis
    // antigos e tenta salvar de volta.
    const input = z.object({ permissions: z.record(z.any()) }).parse(body);
    return { membership: await this.svc.setMembershipPermissions(ctx, membershipId, input.permissions as Record<string, boolean>) };
  }

  @Get("roles")
  async listRoles(
    @CurrentContext() ctx: RequestContext,
    @Query("organizationId") organizationId?: string,
  ) {
    return {
      roles: await this.svc.listRoles(ctx, organizationId),
      catalog: this.svc.permissionCatalog(),
    };
  }

  @Post("roles")
  @HttpCode(201)
  async createRole(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = UpsertRoleSchema.parse(body);
    return {
      role: await this.svc.createRole(
        ctx,
        { slug: input.slug, name: input.name, description: input.description, permissions: input.permissions },
        input.organizationId,
      ),
    };
  }

  @Patch("roles/:id")
  async updateRole(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpsertRoleSchema.partial().parse(body);
    return {
      role: await this.svc.updateRole(ctx, id, {
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        isActive: input.isActive,
      } as any),
    };
  }

  @Delete("roles/:id")
  async deleteRole(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return this.svc.deleteRole(ctx, id);
  }

  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("organizationId") organizationId?: string,
  ) {
    const items = await this.svc.list(ctx, { organizationId });
    return { items };
  }

  @Get(":id")
  async getById(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { user: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = CreateUserSchema.parse(body);
    return this.svc.create(ctx, input);
  }

  @Patch(":id")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateUserSchema.parse(body);
    return { user: await this.svc.update(ctx, id, input) };
  }

  @Post(":id/disable-mfa")
  @HttpCode(200)
  async disableMfa(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    await this.svc.disableMfa(ctx, id);
    return { ok: true };
  }

  @Post(":id/memberships")
  @HttpCode(201)
  async addMembership(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = CreateMembershipSchema.parse(body);
    return { membership: await this.svc.addMembership(ctx, id, input) };
  }

  @Delete("memberships/:membershipId")
  async revokeMembership(
    @CurrentContext() ctx: RequestContext,
    @Param("membershipId") membershipId: string,
  ) {
    return {
      membership: await this.svc.revokeMembership(ctx, membershipId),
    };
  }
}
