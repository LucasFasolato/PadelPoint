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

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      CompetitiveProfile,
      EloHistory,
      MatchResult,
      Challenge,
    ]),
  ],
  controllers: [CompetitiveController],
  providers: [CompetitiveService, EloService],
  exports: [CompetitiveService, EloService],
})
export class CompetitiveModule {}
