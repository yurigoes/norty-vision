import { Module } from "@nestjs/common";
import { SupplierPortalController } from "./supplier-portal.controller";
import { SupplierAuthService } from "./supplier-auth.service";
import { SupplierPortalService } from "./supplier-portal.service";
import { SupplierGuard } from "./supplier.guard";
import { AuthModule } from "../auth/auth.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [SupplierPortalController],
  providers: [SupplierAuthService, SupplierPortalService, SupplierGuard],
  exports: [SupplierAuthService],
})
export class SupplierPortalModule {}
