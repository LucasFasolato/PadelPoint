import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from './match-result.entity';
import { MatchDispute } from './match-dispute.entity';
import { MatchAuditLog } from './match-audit-log.entity';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { LeagueMatchesController } from './league-matches.controller';
import { Challenge } from '../challenges/challenge.entity';
import { User } from '../users/user.entity';
import { League } from '../leagues/league.entity';
import { LeagueMember } from '../leagues/league-member.entity';
import { Reservation } from '../reservations/reservation.entity';
import { CompetitiveModule } from '../competitive/competitive.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MatchResult, MatchDispute, MatchAuditLog, Challenge, User, League, LeagueMember, Reservation]),
    CompetitiveModule,
    LeaguesModule,
    NotificationsModule,
  ],
  providers: [MatchesService],
  controllers: [MatchesController, LeagueMatchesController],
})
export class MatchesModule {}
