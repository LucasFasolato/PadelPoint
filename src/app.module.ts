import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

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
  ],
})
export class AppModule {}
