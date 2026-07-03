import { Module } from "@nestjs/common";
import { ProfessionalsController } from "./professionals.controller";
import { ProfessionalsService } from "./professionals.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalsController],
  providers: [ProfessionalsService],
  exports: [ProfessionalsService],
})
export class ProfessionalsModule {}
