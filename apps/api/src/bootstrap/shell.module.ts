import { Global, Module } from "@nestjs/common";
import { ShellLoader } from "./shell.loader";

/**
 * A casca do painel tem dois consumidores — o `/api/bootstrap` e o
 * `/api/organizations/me` — e um deles vive dentro do módulo que o outro
 * importa. Global evita o vaivém de imports entre eles.
 */
@Global()
@Module({
  providers: [ShellLoader],
  exports: [ShellLoader],
})
export class ShellModule {}
