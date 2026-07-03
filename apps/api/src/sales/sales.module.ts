import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";
import { CreditModule } from "../credit/credit.module";
import { OrgIntegrationsModule } from "../org-integrations/org-integrations.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [CreditModule, OrgIntegrationsModule, PaymentsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
