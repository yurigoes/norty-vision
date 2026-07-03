import { Module } from "@nestjs/common";
import { BroadcastController } from "./broadcast.controller";
import { BroadcastService } from "./broadcast.service";
import { BroadcastScheduler } from "./broadcast.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";
import { MessagingModule } from "../messaging/messaging.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [NotificationsModule, MessagingModule, IntegrationsModule],
  controllers: [BroadcastController],
  providers: [BroadcastService, BroadcastScheduler],
})
export class BroadcastModule {}
