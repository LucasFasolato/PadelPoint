import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';

import { ClubsModule } from './modules/clubs/clubs.module';
import { CourtsModule } from './modules/courts/courts.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { AgendaModule } from './modules/agenda/agenda.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompetitiveModule } from './modules/competitive/competitive.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { MatchesModule } from './modules/matches/matches.module';
import { PaymentsModule } from './payments/payments.module';
import { ClubMembersModule } from './modules/club-members/club-members.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),

    DatabaseModule,

    ClubsModule,
    CourtsModule,
    AvailabilityModule,
    ReservationsModule,
    AgendaModule,
    ReportsModule,
    UsersModule,
    AuthModule,
    CompetitiveModule,
    ChallengesModule,
    MatchesModule,
    PaymentsModule,
    ClubMembersModule,
    MediaModule,
    NotificationsModule,
  ],
})
export class AppModule {}
