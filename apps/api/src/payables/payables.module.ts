import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { AiModule } from "../ai/ai.module";
import { PayablesController } from "./payables.controller";
import { PayablesService } from "./payables.service";
import { PayablesNotifyScheduler } from "./payables-notify.scheduler";
import { PayablesRecurringScheduler } from "./payables-recurring.scheduler";

@Module({
  imports: [NotificationsModule, AiModule],
  controllers: [PayablesController],
  providers: [PayablesService, PayablesNotifyScheduler, PayablesRecurringScheduler],
  exports: [PayablesService],
})
export class PayablesModule {}
