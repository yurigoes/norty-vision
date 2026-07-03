import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { IntegrationsModule } from "../integrations/integrations.module";
import { PlatformContractsModule } from "../platform-contracts/platform-contracts.module";
import { SubscriptionInvoicesModule } from "../subscription-invoices/subscription-invoices.module";

@Module({
  imports: [IntegrationsModule, PlatformContractsModule, SubscriptionInvoicesModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
