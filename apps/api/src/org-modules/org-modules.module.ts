import { Module } from "@nestjs/common";
import { OrgModulesController, OrgProductionFeaturesController, OrgSubmoduleFeaturesController } from "./org-modules.controller";
import { OrgModulesService } from "./org-modules.service";

@Module({
  controllers: [OrgModulesController, OrgProductionFeaturesController, OrgSubmoduleFeaturesController],
  providers: [OrgModulesService],
  exports: [OrgModulesService],
})
export class OrgModulesModule {}
