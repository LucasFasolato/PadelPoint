import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from '../matches/entities/match-result.entity';
import { User } from '../users/entities/user.entity';
import { City } from '../geo/entities/city.entity';
import { Province } from '../geo/entities/province.entity';
import { GlobalRankingSnapshot } from './entities/global-ranking-snapshot.entity';
import { RankingSnapshotRun } from './entities/ranking-snapshot-run.entity';
import { RankingsController } from './controllers/rankings.controller';
import { RankingsService } from './services/rankings.service';
import { RankingsSnapshotSchedulerService } from './services/rankings-snapshot-scheduler.service';
import { UserNotification } from '../notifications/entities/user-notification.entity';
import { PlayerProfile } from '../players/entities/player-profile.entity';
import { Challenge } from '../challenges/entities/challenge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GlobalRankingSnapshot,
      MatchResult,
      User,
      PlayerProfile,
      City,
      Province,
      UserNotification,
      Challenge,
      RankingSnapshotRun,
    ]),
  ],
  controllers: [RankingsController],
  providers: [RankingsService, RankingsSnapshotSchedulerService],
  exports: [RankingsService, RankingsSnapshotSchedulerService],
})
export class RankingsModule {}
