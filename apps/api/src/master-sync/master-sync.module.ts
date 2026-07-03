import { Module } from "@nestjs/common";
import { MasterSyncController } from "./master-sync.controller";
import { MasterSyncService } from "./master-sync.service";
import { AuthModule } from "../auth/auth.module";
import { VaultModule } from "../vault/vault.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [AuthModule, VaultModule, IntegrationsModule],
  controllers: [MasterSyncController],
  providers: [MasterSyncService],
})
export class MasterSyncModule {}
