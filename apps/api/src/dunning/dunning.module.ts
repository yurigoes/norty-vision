import { Module, forwardRef } from "@nestjs/common";
import { DunningController } from "./dunning.controller";
import { DunningService } from "./dunning.service";
import { SchedulerService } from "./scheduler.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  // forwardRef pra evitar ciclo (InboxModule também precisa de Notifications etc).
  imports: [NotificationsModule, forwardRef(() => InboxModule)],
  controllers: [DunningController, ReportsController],
  providers: [DunningService, SchedulerService, ReportsService],
  exports: [DunningService],
})
export class DunningModule {}
