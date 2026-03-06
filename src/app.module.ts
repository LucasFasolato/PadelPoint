import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';

import { ClubsModule } from './modules/legacy/clubs/clubs.module';
import { CourtsModule } from './modules/legacy/courts/courts.module';
import { AvailabilityModule } from './modules/legacy/availability/availability.module';
import { ReservationsModule } from './modules/legacy/reservations/reservations.module';
import { AgendaModule } from './modules/legacy/agenda/agenda.module';
import { ReportsModule } from './modules/legacy/reports/reports.module';
import { UsersModule } from './modules/core/users/users.module';
import { AuthModule } from './modules/core/auth/auth.module';
import { CompetitiveModule } from './modules/core/competitive/competitive.module';
import { ChallengesModule } from './modules/core/challenges/challenges.module';
import { MatchesModule } from './modules/core/matches/matches.module';
import { PaymentsModule } from './modules/legacy/payments/payments.module';
import { ClubMembersModule } from './modules/legacy/club-members/club-members.module';
import { MediaModule } from './modules/core/media/media.module';
import { NotificationsModule } from './modules/core/notifications/notifications.module';
import { LeaguesModule } from './modules/core/leagues/leagues.module';
import { PlayersModule } from './modules/core/players/players.module';
import { RankingsModule } from './modules/core/rankings/rankings.module';
import { IntentsModule } from './modules/core/intents/intents.module';
import { InsightsModule } from './modules/core/insights/insights.module';
import { EndorsementsModule } from './modules/core/endorsements/endorsements.module';
import { ObservabilityModule } from './common/observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ObservabilityModule,
    ScheduleModule.forRoot(),

    DatabaseModule,

    ClubsModule,
    CourtsModule,
    AvailabilityModule,
    ReservationsModule,
    AgendaModule,
    ReportsModule,
    UsersModule,
    AuthModule.register(),
    CompetitiveModule,
    ChallengesModule,
    MatchesModule,
    PaymentsModule,
    ClubMembersModule,
    MediaModule,
    NotificationsModule,
    LeaguesModule,
    PlayersModule,
    RankingsModule,
    IntentsModule,
    InsightsModule,
    EndorsementsModule,
  ],
})
export class AppModule {}
