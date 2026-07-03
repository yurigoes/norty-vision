import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { ReceivablesController } from "./receivables.controller";
import { ReceivablesService } from "./receivables.service";
import { ReceivablesRecurringScheduler } from "./receivables-recurring.scheduler";

@Module({
  imports: [AiModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService, ReceivablesRecurringScheduler],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
