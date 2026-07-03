import { Module } from "@nestjs/common";
import { ExamsController } from "./exams.controller";
import { ExamsService } from "./exams.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { OrgIntegrationsModule } from "../org-integrations/org-integrations.module";

@Module({
  imports: [NotificationsModule, PaymentsModule, OrgIntegrationsModule],
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
