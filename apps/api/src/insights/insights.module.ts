import { Module } from "@nestjs/common";
import { InsightsController } from "./insights.controller";
import { InsightsService } from "./insights.service";
import { InsightsScheduler } from "./insights.scheduler";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AiModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsScheduler],
  exports: [InsightsService],
})
export class InsightsModule {}
