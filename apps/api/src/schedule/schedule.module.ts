import { Module } from "@nestjs/common";
import { ScheduleController } from "./schedule.controller";
import { ScheduleService } from "./schedule.service";
import { AgendaReminderScheduler } from "./agenda-reminder.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";
import { AppointmentsModule } from "../appointments/appointments.module";

@Module({
  imports: [NotificationsModule, AppointmentsModule],
  controllers: [ScheduleController],
  providers: [ScheduleService, AgendaReminderScheduler],
  exports: [ScheduleService],
})
export class ScheduleModule {}
