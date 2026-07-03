import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { PlatformModule } from "./platform/platform.module";
import { PlatformAuthModule } from "./platform-auth/platform-auth.module";
import { StorageModule } from "./storage/storage.module";
import { UploadsModule } from "./uploads/uploads.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { VaultModule } from "./vault/vault.module";
import { MasterSyncModule } from "./master-sync/master-sync.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { StoresModule } from "./stores/stores.module";
import { UsersModule } from "./users/users.module";
import { ContractsModule } from "./contracts/contracts.module";
import { PlansModule } from "./plans/plans.module";
import { NichesModule } from "./niches/niches.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { ProfessionalsModule } from "./professionals/professionals.module";
import { CustomersModule } from "./customers/customers.module";
import { ScheduleModule } from "./schedule/schedule.module";
import { AppointmentsModule } from "./appointments/appointments.module";
import { NluModule } from "./nlu/nlu.module";
import { ProductsModule } from "./products/products.module";
import { CreditModule } from "./credit/credit.module";
import { SalesModule } from "./sales/sales.module";
import { OrgIntegrationsModule } from "./org-integrations/org-integrations.module";
import { PaymentsModule } from "./payments/payments.module";
import { InsightsModule } from "./insights/insights.module";
import { KioskModule } from "./kiosk/kiosk.module";
import { CustomerPortalModule } from "./customer-portal/customer-portal.module";
import { DunningModule } from "./dunning/dunning.module";
import { SupportModule } from "./support/support.module";
import { MessagingModule } from "./messaging/messaging.module";
import { CompanyIntegrationsModule } from "./company-integrations/company-integrations.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { OpticalModule } from "./optical/optical.module";
import { SurveysModule } from "./surveys/surveys.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { CommissionsModule } from "./commissions/commissions.module";
import { HrModule } from "./hr/hr.module";
import { EmployeePortalModule } from "./employee-portal/employee-portal.module";
import { OrgModulesModule } from "./org-modules/org-modules.module";
import { PlatformContractsModule } from "./platform-contracts/platform-contracts.module";
import { ContactModule } from "./contact/contact.module";
import { SupportAccessModule } from "./support-access/support-access.module";
import { SupplierPortalModule } from "./supplier-portal/supplier-portal.module";
import { BroadcastModule } from "./broadcast/broadcast.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { ModulePricingModule } from "./module-pricing/module-pricing.module";
import { SubscriptionInvoicesModule } from "./subscription-invoices/subscription-invoices.module";
import { SidebarModule } from "./sidebar/sidebar.module";
import { ImpersonationModule } from "./impersonation/impersonation.module";
import { CashModule } from "./cash/cash.module";
import { HelpdeskModule } from "./helpdesk/helpdesk.module";
import { ExamsModule } from "./exams/exams.module";
import { MetricsModule } from "./metrics/metrics.module";
import { InboxModule } from "./inbox/inbox.module";
import { AiModule } from "./ai/ai.module";
import { KbModule } from "./kb/kb.module";
import { QuotesModule } from "./quotes/quotes.module";
import { ProductionModule } from "./production/production.module";
import { PontoModule } from "./ponto/ponto.module";
import { FiscalModule } from "./fiscal/fiscal.module";
import { SystemModule } from "./system/system.module";
import { PayablesModule } from "./payables/payables.module";
import { ReceivablesModule } from "./receivables/receivables.module";
import { PlatformSupportModule } from "./platform-support/platform-support.module";
import { HistoricalSalesModule } from "./historical-sales/historical-sales.module";
import { CrmModule } from "./crm/crm.module";
import { ProspectorModule } from "./prospector/prospector.module";
import { VoipModule } from "./voip/voip.module";
import { NortyLicenseModule } from "./norty-license/norty-license.module";
import { AuthGuard } from "./auth/auth.guard";

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    HealthModule,
    AuthModule,
    PlatformAuthModule,
    PlatformModule,
    UploadsModule,
    IntegrationsModule,
    VaultModule,
    MasterSyncModule,
    WebhooksModule,
    PlansModule,
    NichesModule,
    SubscriptionsModule,
    OrganizationsModule,
    StoresModule,
    UsersModule,
    ContractsModule,
    ProfessionalsModule,
    CustomersModule,
    ScheduleModule,
    AppointmentsModule,
    NluModule,
    ProductsModule,
    CreditModule,
    SalesModule,
    OrgIntegrationsModule,
    PaymentsModule,
    InsightsModule,
    KioskModule,
    CustomerPortalModule,
    DunningModule,
    SupportModule,
    MessagingModule,
    CompanyIntegrationsModule,
    SuppliersModule,
    OpticalModule,
    SurveysModule,
    PayoutsModule,
    CommissionsModule,
    HrModule,
    EmployeePortalModule,
    OrgModulesModule,
    PlatformContractsModule,
    ContactModule,
    SupportAccessModule,
    SupplierPortalModule,
    BroadcastModule,
    MarketplaceModule,
    ModulePricingModule,
    SubscriptionInvoicesModule,
    SidebarModule,
    ImpersonationModule,
    CashModule,
    HelpdeskModule,
    ExamsModule,
    MetricsModule,
    AiModule,
    InboxModule,
    KbModule,
    QuotesModule,
    ProductionModule,
    PontoModule,
    FiscalModule,
    SystemModule,
    PayablesModule,
    ReceivablesModule,
    PlatformSupportModule,
    HistoricalSalesModule,
    CrmModule,
    ProspectorModule,
    VoipModule,
    NortyLicenseModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
