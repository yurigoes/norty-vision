import { Module } from "@nestjs/common";
import { SurveysController } from "./surveys.controller";
import { SurveysService } from "./surveys.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [SurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
