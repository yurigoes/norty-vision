import { Module } from "@nestjs/common";
import { OrgAiService } from "./org-ai.service";
import { OrgAiController } from "./org-ai.controller";
import { AiLearningService } from "./ai-learning.service";
import { AiLearningController } from "./ai-learning.controller";
import { EmbeddingService } from "./embedding.service";

@Module({
  controllers: [OrgAiController, AiLearningController],
  providers: [OrgAiService, AiLearningService, EmbeddingService],
  exports: [OrgAiService, AiLearningService, EmbeddingService],
})
export class AiModule {}
