import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { OwnersModule } from './modules/owners/owners.module';
import { LeadsModule } from './modules/leads/leads.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { AIAgentModule } from './modules/ai-agent/ai-agent.module';
import { PostingModule } from './modules/posting/posting.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { ViewingsModule } from './modules/viewings/viewings.module';
import { FieldAgentsModule } from './modules/field-agents/field-agents.module';
import { DealsModule } from './modules/deals/deals.module';
import { ScoresModule } from './modules/scores/scores.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AutomationModule } from './modules/automation/automation.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HostawayModule } from './modules/integrations/hostaway/hostaway.module';
import { PublicModule } from './modules/public/public.module';
import { PlacementsModule } from './modules/placements/placements.module';
import { SystemDocsModule } from './modules/system-docs/system-docs.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    PrismaModule,
    HealthModule,

    AuthModule,
    UsersModule,
    CompaniesModule,
    FilesModule,
    PropertiesModule,
    OwnersModule,
    LeadsModule,
    WhatsAppModule,
    AIAgentModule,
    PostingModule,
    TrackingModule,
    ViewingsModule,
    FieldAgentsModule,
    DealsModule,
    ScoresModule,
    AnalyticsModule,
    AutomationModule,
    NotificationsModule,
    HostawayModule,
    PublicModule,
    PlacementsModule,
    SystemDocsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
