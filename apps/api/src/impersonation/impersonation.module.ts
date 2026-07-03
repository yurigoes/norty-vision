import { Module } from "@nestjs/common";
import { ImpersonationController } from "./impersonation.controller";
import { ImpersonationService } from "./impersonation.service";
import { SupportAccessModule } from "../support-access/support-access.module";

@Module({
  imports: [SupportAccessModule],
  controllers: [ImpersonationController],
  providers: [ImpersonationService],
})
export class ImpersonationModule {}
