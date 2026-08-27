import { Module } from "@nestjs/common";
import { BootstrapController } from "./bootstrap.controller";
import { BootstrapService } from "./bootstrap.service";
import { ShellModule } from "./shell.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule, ShellModule],
  controllers: [BootstrapController],
  providers: [BootstrapService],
})
export class BootstrapModule {}
