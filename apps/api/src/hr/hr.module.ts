import { Module } from "@nestjs/common";
import { HrController } from "./hr.controller";
import { HrService } from "./hr.service";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ContractsModule } from "../contracts/contracts.module";
import { UsersModule } from "../users/users.module";
import { PontoModule } from "../ponto/ponto.module";

@Module({
  imports: [AuthModule, NotificationsModule, ContractsModule, UsersModule, PontoModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
