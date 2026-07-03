import { Module } from "@nestjs/common";
import { VoipController } from "./voip.controller";
import { VoipService } from "./voip.service";
import { VoipAdminController } from "./voip-admin.controller";
import { VoipAdminService } from "./voip-admin.service";

@Module({
  controllers: [VoipController, VoipAdminController],
  providers: [VoipService, VoipAdminService],
  exports: [VoipService, VoipAdminService],
})
export class VoipModule {}
