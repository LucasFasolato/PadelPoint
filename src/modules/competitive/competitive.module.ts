import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompetitiveController } from './competitive.controller';
import { CompetitiveService } from './competitive.service';
import { CompetitiveProfile } from './competitive-profile.entity';
import { EloHistory } from './elo-history.entity';
import { EloService } from './elo.service';

import { MatchResult } from '../matches/match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { UsersModule } from '../users/users.module';
import { PlayerProfile } from '../players/player-profile.entity';
import { PlayerFavorite } from '../players/player-favorite.entity';

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
