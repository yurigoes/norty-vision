import { Module } from "@nestjs/common";
import { PlatformContractsController } from "./platform-contracts.controller";
import { PlatformContractsService } from "./platform-contracts.service";

@Module({
  controllers: [PlatformContractsController],
  providers: [PlatformContractsService],
  exports: [PlatformContractsService],
})
export class PlatformContractsModule {}
