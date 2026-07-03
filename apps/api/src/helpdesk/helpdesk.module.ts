import { Module } from "@nestjs/common";
import { HelpdeskController } from "./helpdesk.controller";
import { HelpdeskService } from "./helpdesk.service";
import { SlaScheduler } from "./sla.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [HelpdeskController],
  providers: [HelpdeskService, SlaScheduler],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
