import { Module } from "@nestjs/common";
import { ImpersonationController } from "./impersonation.controller";
import { ImpersonationService } from "./impersonation.service";
import { SupportAccessModule } from "../support-access/support-access.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [SupportAccessModule, AuthModule],
  controllers: [ImpersonationController],
  providers: [ImpersonationService],
})
export class ImpersonationModule {}
