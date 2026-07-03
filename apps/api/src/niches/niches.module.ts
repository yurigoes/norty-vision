import { Module } from "@nestjs/common";
import { NichesController } from "./niches.controller";
import { NichesService } from "./niches.service";

@Module({
  controllers: [NichesController],
  providers: [NichesService],
  exports: [NichesService],
})
export class NichesModule {}
