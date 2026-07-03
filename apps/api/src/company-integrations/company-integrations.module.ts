import { Module } from "@nestjs/common";
import { CompanyIntegrationsController } from "./company-integrations.controller";
import { CompanyIntegrationsService } from "./company-integrations.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [IntegrationsModule],
  controllers: [CompanyIntegrationsController],
  providers: [CompanyIntegrationsService],
  exports: [CompanyIntegrationsService],
})
export class CompanyIntegrationsModule {}
