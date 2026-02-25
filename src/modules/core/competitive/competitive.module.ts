import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompetitiveController } from './controllers/competitive.controller';
import { CompetitiveService } from './services/competitive.service';
import { CompetitiveProfile } from './entities/competitive-profile.entity';
import { EloHistory } from './entities/elo-history.entity';
import { EloService } from './services/elo.service';

import { MatchResult } from '../matches/entities/match-result.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { UsersModule } from '../users/users.module';
import { PlayerProfile } from '../players/entities/player-profile.entity';
import { PlayerFavorite } from '../players/entities/player-favorite.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      CompetitiveProfile,
      EloHistory,
      MatchResult,
      Challenge,
      PlayerProfile,
      PlayerFavorite,
    ]),
  ],
  controllers: [CompetitiveController],
  providers: [CompetitiveService, EloService],
  exports: [CompetitiveService, EloService],
})
export class CompetitiveModule {}
