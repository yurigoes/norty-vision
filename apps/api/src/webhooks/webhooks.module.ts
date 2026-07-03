import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { EvolutionWebhookService } from "./evolution-webhook.service";
import { MetaWebhookService } from "./meta-webhook.service";
import { MetaAdapter } from "../integrations/adapters/meta.adapter";
import { NluModule } from "../nlu/nlu.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { InboxModule } from "../inbox/inbox.module";
import { ProductionModule } from "../production/production.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CrmModule } from "../crm/crm.module";

@Module({
  imports: [NluModule, AppointmentsModule, InboxModule, ProductionModule, IntegrationsModule, CrmModule],
  controllers: [WebhooksController],
  providers: [EvolutionWebhookService, MetaWebhookService, MetaAdapter],
  exports: [EvolutionWebhookService, MetaWebhookService, MetaAdapter],
})
export class WebhooksModule {}
