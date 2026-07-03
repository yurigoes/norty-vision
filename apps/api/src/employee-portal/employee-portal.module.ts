import { Module } from "@nestjs/common";
import { EmployeePortalController } from "./employee-portal.controller";
import { EmployeeAuthService } from "./employee-auth.service";
import { EmployeePortalService } from "./employee-portal.service";
import { EmployeeGuard } from "./employee.guard";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { PontoModule } from "../ponto/ponto.module";

@Module({
  imports: [AuthModule, StorageModule, PontoModule],
  controllers: [EmployeePortalController],
  providers: [EmployeeAuthService, EmployeePortalService, EmployeeGuard],
  exports: [EmployeeAuthService],
})
export class EmployeePortalModule {}
