import { Module } from "@nestjs/common";
import { OrgIntegrationsController } from "./org-integrations.controller";
import { OrgIntegrationsService } from "./org-integrations.service";

@Module({
  controllers: [OrgIntegrationsController],
  providers: [OrgIntegrationsService],
  exports: [OrgIntegrationsService],
})
export class OrgIntegrationsModule {}
