import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from './entities/match-result.entity';
import { MatchDispute } from './entities/match-dispute.entity';
import { MatchAuditLog } from './entities/match-audit-log.entity';
import { MatchesService } from './services/matches.service';
import { MatchesController } from './controllers/matches.controller';
import { LeagueMatchesController } from './controllers/league-matches.controller';
import { Challenge } from '../challenges/entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { League } from '../leagues/entities/league.entity';
import { LeagueMember } from '../leagues/entities/league-member.entity';
import { Reservation } from '@legacy/reservations/reservation.entity';
import { Court } from '@legacy/courts/court.entity';
import { CompetitiveModule } from '../competitive/competitive.module';
import { CompetitiveProfile } from '../competitive/entities/competitive-profile.entity';
import { EloHistory } from '../competitive/entities/elo-history.entity';
import { LeaguesModule } from '../leagues/leagues.module';
import { NotificationsModule } from '@/modules/core/notifications/notifications.module';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { GlobalRankingSnapshot } from '../rankings/entities/global-ranking-snapshot.entity';
import { MatchesV2Module } from '../matches-v2/matches-v2.module';
import { MatchesV2BridgeService } from './services/matches-v2-bridge.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MatchResult,
      MatchDispute,
      MatchAuditLog,
      Challenge,
      User,
      League,
      LeagueMember,
      Reservation,
      Court,
      CompetitiveProfile,
      EloHistory,
      GlobalRankingSnapshot,
    ]),
    CompetitiveModule,
    LeaguesModule,
    NotificationsModule,
    MatchesV2Module,
  ],
  providers: [MatchesService, MatchesV2BridgeService, CityRequiredGuard],
  controllers: [MatchesController, LeagueMatchesController],
})
export class MatchesModule {}
