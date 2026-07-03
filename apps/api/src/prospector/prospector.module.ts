import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { ProspectorController } from "./prospector.controller";
import { ProspectorService } from "./prospector.service";
import { ProspectorScheduler } from "./prospector.scheduler";

@Module({
  imports: [CrmModule],
  controllers: [ProspectorController],
  providers: [ProspectorService, ProspectorScheduler],
  exports: [ProspectorService],
})
export class ProspectorModule {}
