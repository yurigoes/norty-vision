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
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { CustomersService } from "./customers.service";

// Coerce STRING VAZIA → null antes da validação. Sem isso, campos como `email`,
// `state`, `avatarUrl` e `storeId` (que têm validador estrito) rejeitam o form
// quando o usuário deixa o campo em branco — front manda `""`, Zod recusa.
// O modelo Prisma aceita null em todos esses campos, então a tradução é segura.
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optStr = (maxOrSchema?: number | z.ZodString) => {
  const base = typeof maxOrSchema === "number" ? z.string().max(maxOrSchema) : (maxOrSchema ?? z.string());
  return z.preprocess(blankToNull, base.nullable().optional());
};

const UpsertCustomerSchema = z.object({
  storeId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()),
  name: z.string().min(2).max(120),
  displayName: optStr(120),
  document: optStr(20),
  documentType: z.preprocess(blankToNull, z.enum(["cpf", "cnpj", "passport", "other"]).nullable().optional()),
  birthDate: optStr(),
  gender: z.preprocess(blankToNull, z.enum(["male", "female", "other", "unspecified"]).nullable().optional()),
  email: optStr(z.string().email().max(320)),
  phone: optStr(30),
  phoneSecondary: optStr(30),
  whatsappPhone: optStr(30),
  prefersChannel: z.preprocess(blankToNull, z.enum(["whatsapp", "sms", "email", "phone", "none"]).nullable().optional()),
  optOutMarketing: z.boolean().optional(),
  city: optStr(80),
  state: optStr(z.string().length(2)),
  postalCode: optStr(12),
  tags: z.array(z.string()).optional(),
  source: optStr(40),
  addressLine: optStr(200),
  addressNumber: optStr(20),
  addressComplement: optStr(80),
  neighborhood: optStr(80),
  avatarUrl: optStr(z.string().url()),
  incomeCents: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
    z.number().int().min(0).nullable().optional(),
  ),
});

@Controller("customers")
export class CustomersController {
  constructor(
    private readonly svc: CustomersService,
    private readonly storage: StorageService,
  ) {}

  /** Documentos enviados pelo cliente (KYC etc.). */
  @Get(":id/documents")
  @RequirePermission("customers.view")
  async listDocuments(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.listDocuments(ctx, id) };
  }

  /** Visualiza um documento (stream se privado, redirect se público). */
  @Get(":id/documents/:docId/file")
  @RequirePermission("customers.view")
  async documentFile(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Res() reply: FastifyReply,
  ) {
    const r = await this.svc.resolveDocument(ctx, id, docId);
    if (r.privateKey) {
      const { body, contentType } = await this.storage.getPrivate(r.privateKey);
      reply.header("Content-Disposition", "inline").type(contentType).send(body);
      return;
    }
    reply.redirect(r.publicUrl!);
  }

  @Get()
  @RequirePermission("customers.view")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
    @Query("q") search?: string,
    @Query("limit") limit?: string,
  ) {
    return {
      items: await this.svc.list(ctx, {
        storeId,
        search,
        limit: limit ? parseInt(limit) : undefined,
      }),
    };
  }

  @Get(":id")
  @RequirePermission("customers.view")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { customer: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("customers.create")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = UpsertCustomerSchema.parse(body);
    return { customer: await this.svc.create(ctx, input) };
  }

  /** Cruza paciente↔cliente: vincula a um existente (CPF/telefone) ou cria. */
  @Post("find-or-create")
  @HttpCode(200)
  @RequirePermission("customers.create")
  async findOrCreate(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = UpsertCustomerSchema.parse(body);
    return this.svc.findOrCreate(ctx, input);
  }

  /** Importação em lote (CSV de clientes). Deduplica por documento/telefone. */
  @Post("import")
  @HttpCode(200)
  @RequirePermission("customers.create")
  async importBatch(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ rows: z.array(UpsertCustomerSchema).min(1).max(5000) }).parse(body);
    return this.svc.importBatch(ctx, input.rows);
  }

  @Patch(":id")
  @RequirePermission("customers.edit")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpsertCustomerSchema.partial().parse(body);
    return { customer: await this.svc.update(ctx, id, input) };
  }

  @Post(":id/reset-portal-password")
  @HttpCode(200)
  @RequirePermission("customers.edit")
  async resetPortalPassword(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.resetPortalPassword(ctx, id);
  }

  @Delete(":id")
  @RequirePermission("customers.delete")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { customer: await this.svc.softDelete(ctx, id) };
  }

  // ============================== Notas permanentes do cliente ==============================
  /** Lista notas fixadas/recentes do cliente (visíveis no painel de atendimento). */
  @Get(":id/notes")
  @RequirePermission("customers.view")
  async listNotes(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.listNotes(ctx, id) };
  }

  /** Cria uma nota fixa sobre o cliente. */
  @Post(":id/notes")
  @HttpCode(201)
  @RequirePermission("customers.edit")
  async createNote(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ body: z.string().min(1).max(2000), pinned: z.boolean().optional(), isPrivate: z.boolean().optional() }).parse(body);
    return { note: await this.svc.createNote(ctx, id, input) };
  }

  /** Apaga uma nota (somente quem escreveu OU admin). */
  @Delete(":id/notes/:noteId")
  @RequirePermission("customers.edit")
  async deleteNote(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("noteId") noteId: string) {
    return this.svc.deleteNote(ctx, id, noteId);
  }

  /** Timeline unificada do cliente: conversas + agendamentos + vendas + produções. */
  @Get(":id/timeline")
  @RequirePermission("customers.view")
  async timeline(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.timeline(ctx, id);
  }
}
