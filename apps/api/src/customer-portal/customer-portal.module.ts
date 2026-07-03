import { Module } from "@nestjs/common";
import { CustomerPortalController } from "./customer-portal.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { CustomerPortalService } from "./customer-portal.service";
import { CustomerGuard } from "./customer.guard";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { StorageModule } from "../storage/storage.module";
import { ContractsModule } from "../contracts/contracts.module";
import { PaymentsModule } from "../payments/payments.module";
import { SurveysModule } from "../surveys/surveys.module";
import { HelpdeskModule } from "../helpdesk/helpdesk.module";
import { ProductionModule } from "../production/production.module";

@Module({
  imports: [AuthModule, NotificationsModule, StorageModule, ContractsModule, PaymentsModule, SurveysModule, HelpdeskModule, ProductionModule],
  controllers: [CustomerPortalController],
  providers: [CustomerAuthService, CustomerPortalService, CustomerGuard],
  exports: [CustomerAuthService],
})
export class CustomerPortalModule {}
