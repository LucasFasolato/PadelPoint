import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from '../matches/entities/match-result.entity';
import { User } from '../users/entities/user.entity';
import { City } from '../geo/entities/city.entity';
import { Province } from '../geo/entities/province.entity';
import { GlobalRankingSnapshot } from './entities/global-ranking-snapshot.entity';
import { RankingsController } from './controllers/rankings.controller';
import { RankingsService } from './services/rankings.service';
import { UserNotification } from '../notifications/entities/user-notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GlobalRankingSnapshot,
      MatchResult,
      User,
      City,
      Province,
      UserNotification,
    ]),
  ],
  controllers: [RankingsController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
