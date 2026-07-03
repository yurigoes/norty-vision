import { Module } from "@nestjs/common";
import { FiscalController } from "./fiscal.controller";
import { FiscalService } from "./fiscal.service";
import { NfceService } from "./nfce.service";
import { NfseService } from "./nfse.service";
import { FiscalRefService } from "./fiscal-ref.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [FiscalController],
  providers: [FiscalService, NfceService, NfseService, FiscalRefService],
  exports: [FiscalService, NfseService],
})
export class FiscalModule {}
