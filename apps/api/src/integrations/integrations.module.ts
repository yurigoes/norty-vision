import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { SsoController } from "./sso.controller";
import { IntegrationsService } from "./integrations.service";
import { ProvisioningService } from "./provisioning.service";

@Module({
  controllers: [IntegrationsController, SsoController],
  providers: [IntegrationsService, ProvisioningService],
  exports: [IntegrationsService, ProvisioningService],
})
export class IntegrationsModule {}
