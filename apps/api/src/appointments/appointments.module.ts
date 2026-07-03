import { Module } from "@nestjs/common";
import { AppointmentsController } from "./appointments.controller";
import { PublicAppointmentsController } from "./public-appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { SurveysModule } from "../surveys/surveys.module";

@Module({
  imports: [NotificationsModule, SurveysModule],
  controllers: [AppointmentsController, PublicAppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
