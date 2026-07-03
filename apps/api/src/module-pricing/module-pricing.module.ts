import { Module } from "@nestjs/common";
import { ModulePricingController } from "./module-pricing.controller";
import { ModulePricingService } from "./module-pricing.service";

@Module({
  controllers: [ModulePricingController],
  providers: [ModulePricingService],
  exports: [ModulePricingService],
})
export class ModulePricingModule {}
