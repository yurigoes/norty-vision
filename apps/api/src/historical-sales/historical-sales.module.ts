import { Module } from "@nestjs/common";
import { HistoricalSalesController } from "./historical-sales.controller";
import { HistoricalSalesService } from "./historical-sales.service";

@Module({
  controllers: [HistoricalSalesController],
  providers: [HistoricalSalesService],
  exports: [HistoricalSalesService],
})
export class HistoricalSalesModule {}
