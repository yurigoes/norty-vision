import { Module } from "@nestjs/common";
import { PontoController } from "./ponto.controller";
import { PontoService } from "./ponto.service";
import { JornadaService } from "./jornada.service";
import { PontoPwaController } from "./ponto-pwa.controller";
import { PontoPwaService } from "./ponto-pwa.service";
import { FaceService } from "./face.service";
import { PontoSignService } from "./sign.service";
import { FolhaService } from "./folha.service";
import { AejService } from "./aej.service";
import { PontoAlertsScheduler } from "./ponto-alerts.scheduler";
import { AiModule } from "../ai/ai.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [PontoController, PontoPwaController],
  providers: [PontoService, JornadaService, PontoPwaService, FaceService, PontoSignService, FolhaService, AejService, PontoAlertsScheduler],
  exports: [PontoService, JornadaService],
})
export class PontoModule {}
