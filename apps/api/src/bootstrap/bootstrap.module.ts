import { Module } from "@nestjs/common";
import { BootstrapController } from "./bootstrap.controller";
import { BootstrapService } from "./bootstrap.service";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { StoresModule } from "../stores/stores.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { CompanyIntegrationsModule } from "../company-integrations/company-integrations.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [
    AuthModule,
    OrganizationsModule,
    StoresModule,
    SubscriptionsModule,
    CompanyIntegrationsModule,
    IntegrationsModule,
  ],
  controllers: [BootstrapController],
  providers: [BootstrapService],
})
export class BootstrapModule {}
