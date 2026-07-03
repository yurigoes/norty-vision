import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ArgonService } from "./argon.service";
import { SessionService } from "./session.service";
import { MeController } from "./me.controller";
import { MfaService } from "./mfa.service";
import { MfaController } from "./mfa.controller";
import { PasswordResetService } from "./password-reset.service";
import { PasswordResetController } from "./password-reset.controller";
import { EmailService } from "../notifications/email.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [IntegrationsModule],
  controllers: [
    AuthController,
    MeController,
    MfaController,
    PasswordResetController,
  ],
  providers: [
    AuthService,
    ArgonService,
    SessionService,
    MfaService,
    PasswordResetService,
    EmailService,
  ],
  exports: [
    AuthService,
    SessionService,
    ArgonService,
    MfaService,
    EmailService,
  ],
})
export class AuthModule {}
