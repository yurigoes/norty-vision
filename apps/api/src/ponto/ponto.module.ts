import { Module } from "@nestjs/common";
import { PontoController } from "./ponto.controller";
import { PontoService } from "./ponto.service";
import { JornadaService } from "./jornada.service";
import { PontoPwaController } from "./ponto-pwa.controller";
import { PontoPwaService } from "./ponto-pwa.service";
import { FaceService } from "./face.service";
import { PontoSignService } from "./sign.service";
import { ShiftSwapService } from "./shift-swap.service";
import { EmployerService } from "./employer.service";
import { FolhaService } from "./folha.service";
import { ReportsService } from "./reports.service";
import { AllocationService } from "./allocation.service";
import { AssiduidadeService } from "./assiduidade.service";
import { AejService } from "./aej.service";
import { PontoAlertsScheduler } from "./ponto-alerts.scheduler";
import { AiModule } from "../ai/ai.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [PontoController, PontoPwaController],
  providers: [PontoService, JornadaService, PontoPwaService, FaceService, PontoSignService, ShiftSwapService, EmployerService, FolhaService, ReportsService, AllocationService, AssiduidadeService, AejService, PontoAlertsScheduler],
  exports: [PontoService, JornadaService, FolhaService, PontoSignService, ShiftSwapService, EmployerService, AssiduidadeService, AejService],
})
export class PontoModule {}
