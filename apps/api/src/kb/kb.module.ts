import { Module } from "@nestjs/common";
import { KbService } from "./kb.service";
import { KbController } from "./kb.controller";
import { AiModule } from "../ai/ai.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [AiModule, InboxModule],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
