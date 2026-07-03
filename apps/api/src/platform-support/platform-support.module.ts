import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { PlatformSupportController } from "./platform-support.controller";
import { PlatformSupportService } from "./platform-support.service";

@Module({
  imports: [NotificationsModule, AiModule, AuthModule],
  controllers: [PlatformSupportController],
  providers: [PlatformSupportService],
  exports: [PlatformSupportService],
})
export class PlatformSupportModule {}
