import { Module } from "@nestjs/common";
import { OpticalController } from "./optical.controller";
import { OpticalService } from "./optical.service";
import { OpticalFollowupsScheduler } from "./optical-followups.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";
import { SurveysModule } from "../surveys/surveys.module";

@Module({
  imports: [NotificationsModule, SurveysModule],
  controllers: [OpticalController],
  providers: [OpticalService, OpticalFollowupsScheduler],
  exports: [OpticalService],
})
export class OpticalModule {}
