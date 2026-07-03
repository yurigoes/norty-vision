import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { NortyLicenseController } from "./norty-license.controller";
import { NortyLicenseService } from "./norty-license.service";
import { NortyLicenseGuard } from "./norty-license.guard";

/** API de licenciamento do Norty (/api/norty/v1). Reaproveita org + planos. */
@Module({
  imports: [OrganizationsModule, SubscriptionsModule],
  controllers: [NortyLicenseController],
  providers: [NortyLicenseService, NortyLicenseGuard],
})
export class NortyLicenseModule {}
