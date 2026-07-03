import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Public, RequirePlatformOwner } from "../auth/decorators";
import { NichesService } from "./niches.service";

const NicheSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  label: z.string().min(2).max(80).optional(),
  hiddenModuleKeys: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

@Controller("niches")
export class NichesController {
  constructor(private readonly svc: NichesService) {}

  /** Público (logado): nichos ativos pra popular selects (cadastro de empresa/plano). */
  @Public()
  @Get("active")
  async active() {
    return { items: await this.svc.listActive() };
  }

  // ----- master -----
  @RequirePlatformOwner()
  @Get("admin/all")
  async listAll() {
    return { items: await this.svc.listAll() };
  }

  @RequirePlatformOwner()
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = NicheSchema.parse(body);
    return { niche: await this.svc.create(input) };
  }

  @RequirePlatformOwner()
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const input = NicheSchema.partial().parse(body);
    return { niche: await this.svc.update(id, input) };
  }

  @RequirePlatformOwner()
  @Delete(":id")
  async remove(@Param("id") id: string) {
    return this.svc.remove(id);
  }
}
