import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { SurveysModule } from "../surveys/surveys.module";
import { FiscalModule } from "../fiscal/fiscal.module";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";
import { ProductionImportService } from "./production-import.service";
import { ProductionWipeService } from "./production-wipe.service";
import { ProductionRemindersScheduler } from "./production-reminders.scheduler";

@Module({
  imports: [NotificationsModule, SurveysModule, FiscalModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionImportService, ProductionWipeService, ProductionRemindersScheduler],
  exports: [ProductionService],
})
export class ProductionModule {}
