import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { SurveysModule } from "../surveys/surveys.module";
import { OrgIntegrationsModule } from "../org-integrations/org-integrations.module";
import { AiModule } from "../ai/ai.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { ProductionModule } from "../production/production.module";
import { QuotesModule } from "../quotes/quotes.module";

@Module({
  imports: [NotificationsModule, SurveysModule, OrgIntegrationsModule, AiModule, AppointmentsModule, ProductionModule, QuotesModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
