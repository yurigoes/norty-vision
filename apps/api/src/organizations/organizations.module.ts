import { Module } from "@nestjs/common";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";
import { SignupController } from "./signup.controller";
import { AuthModule } from "../auth/auth.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [AuthModule, IntegrationsModule, SubscriptionsModule],
  controllers: [OrganizationsController, SignupController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
