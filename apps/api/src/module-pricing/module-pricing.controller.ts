import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { RequirePlatformAdmin } from "../auth/decorators";
import { ModulePricingService } from "./module-pricing.service";

@Controller("module-pricing")
export class ModulePricingController {
  constructor(private readonly svc: ModulePricingService) {}

  /** Lista os preços (qualquer usuário autenticado — usado na página do módulo). */
  @Get()
  async list() {
    return { items: await this.svc.list() };
  }

  /** Master define o preço à la carte de um módulo. */
  @RequirePlatformAdmin()
  @Put(":key")
  async set(@Param("key") key: string, @Body() body: unknown) {
    return { price: await this.svc.set(key, body) };
  }
}
