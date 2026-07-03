import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { VoipAdminService } from "./voip-admin.service";

@Controller("voip/admin")
export class VoipAdminController {
  constructor(private readonly svc: VoipAdminService) {}

  // ---- Trunks (linhas SIP) ----
  @Get("trunks") list_trunks(@CurrentContext() ctx: RequestContext) { return this.svc.listTrunks(ctx); }
  @Post("trunks") @HttpCode(200) async create_trunk(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      name: z.string().min(1), sipHost: z.string().min(3), sipUser: z.string().min(1), sipPass: z.string().min(1),
      register: z.boolean().optional(), callerIdName: z.string().optional(),
    }).parse(body);
    return this.svc.createTrunk(ctx, input);
  }
  @Put("trunks/:id") @HttpCode(200) async update_trunk(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      name: z.string().optional(), sipHost: z.string().optional(), sipUser: z.string().optional(), sipPass: z.string().optional(),
      register: z.boolean().optional(), active: z.boolean().optional(), callerIdName: z.string().optional(),
    }).parse(body);
    return this.svc.updateTrunk(ctx, id, input);
  }
  @Delete("trunks/:id") delete_trunk(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deleteTrunk(ctx, id); }

  // ---- DIDs (números) ----
  @Get("dids") list_dids(@CurrentContext() ctx: RequestContext) { return this.svc.listDids(ctx); }
  @Post("dids") @HttpCode(200) async create_did(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      trunkId: z.string().uuid(), number: z.string().min(8), label: z.string().optional(),
      inboundKind: z.enum(["group", "ivr", "extension"]).optional(),
      inboundId: z.string().uuid().optional(),
      fallbackKind: z.enum(["group", "ivr", "extension", "voicemail"]).optional(),
      fallbackId: z.string().uuid().optional(),
    }).parse(body);
    return this.svc.createDid(ctx, input);
  }
  @Put("dids/:id") @HttpCode(200) async update_did(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      number: z.string().optional(), label: z.string().nullable().optional(),
      inboundKind: z.enum(["group", "ivr", "extension"]).optional(),
      inboundId: z.string().uuid().nullable().optional(),
      fallbackKind: z.enum(["group", "ivr", "extension", "voicemail"]).nullable().optional(),
      fallbackId: z.string().uuid().nullable().optional(),
      active: z.boolean().optional(),
    }).parse(body);
    return this.svc.updateDid(ctx, id, input as any);
  }
  @Delete("dids/:id") delete_did(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deleteDid(ctx, id); }

  // ---- Grupos ----
  @Get("groups") list_groups(@CurrentContext() ctx: RequestContext) { return this.svc.listGroups(ctx); }
  @Post("groups") @HttpCode(200) async create_group(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ name: z.string().min(1), strategy: z.enum(["all", "sequential", "longest_idle"]).optional(), ringTimeoutS: z.number().int().min(5).max(180).optional() }).parse(body);
    return this.svc.createGroup(ctx, input);
  }
  @Put("groups/:id") @HttpCode(200) async update_group(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ name: z.string().optional(), strategy: z.enum(["all", "sequential", "longest_idle"]).optional(), ringTimeoutS: z.number().int().min(5).max(180).optional() }).parse(body);
    return this.svc.updateGroup(ctx, id, input);
  }
  @Delete("groups/:id") delete_group(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deleteGroup(ctx, id); }

  // ---- Membros do grupo ----
  @Get("groups/:id/members") list_members(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.listMembers(ctx, id); }
  @Post("groups/:id/members") @HttpCode(200) async add_member(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ membershipId: z.string().uuid(), priority: z.number().int().optional() }).parse(body);
    return this.svc.addMember(ctx, id, input);
  }
  @Delete("groups/:id/members/:memberId") remove_member(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("memberId") memberId: string) {
    return this.svc.removeMember(ctx, id, memberId);
  }

  // ---- Operadores (picker pra adicionar a grupos) ----
  @Get("operators") operators(@CurrentContext() ctx: RequestContext) { return this.svc.listOperators(ctx); }
}
