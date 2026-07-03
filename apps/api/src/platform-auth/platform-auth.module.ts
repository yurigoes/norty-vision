import { Module } from "@nestjs/common";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule], // re-exporta ArgonService
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService],
  exports: [PlatformAuthService],
})
export class PlatformAuthModule {}
