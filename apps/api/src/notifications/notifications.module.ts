import { Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { EmailService } from "./email.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [IntegrationsModule],
  providers: [NotificationService, EmailService],
  exports: [NotificationService, EmailService],
})
export class NotificationsModule {}
