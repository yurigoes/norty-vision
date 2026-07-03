import { Module } from "@nestjs/common";
import { SubscriptionInvoicesController } from "./subscription-invoices.controller";
import { SubscriptionInvoicesService } from "./subscription-invoices.service";
import { SubscriptionBillingScheduler } from "./subscription-billing.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [NotificationsModule, IntegrationsModule],
  controllers: [SubscriptionInvoicesController],
  providers: [SubscriptionInvoicesService, SubscriptionBillingScheduler],
  exports: [SubscriptionInvoicesService],
})
export class SubscriptionInvoicesModule {}
