import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PixCleanupScheduler } from "./pix-cleanup.scheduler";
import { AutoChargeScheduler } from "./auto-charge.scheduler";
import { OrgIntegrationsModule } from "../org-integrations/org-integrations.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [OrgIntegrationsModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PixCleanupScheduler, AutoChargeScheduler],
  exports: [PaymentsService],
})
export class PaymentsModule {}
