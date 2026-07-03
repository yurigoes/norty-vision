import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProductionModule } from "../production/production.module";
import { QuotesController } from "./quotes.controller";
import { QuotesService } from "./quotes.service";

@Module({
  imports: [NotificationsModule, ProductionModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
