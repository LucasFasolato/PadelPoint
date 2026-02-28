import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from '@core/challenges/entities/challenge.entity';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { ChallengeInvite } from '@core/challenges/entities/challenge-invite.entity';
import { ChallengesModule } from '@core/challenges/challenges.module';
import { CompetitiveModule } from '@core/competitive/competitive.module';
import { LeagueMember } from '@core/leagues/entities/league-member.entity';
import { MeIntentsController } from './controllers/me-intents.controller';
import { MatchIntentsService } from './services/match-intents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Challenge,
      MatchResult,
      ChallengeInvite,
      LeagueMember,
    ]),
    ChallengesModule,
    CompetitiveModule,
  ],
  controllers: [MeIntentsController],
  providers: [MatchIntentsService],
  exports: [MatchIntentsService],
})
export class IntentsModule {}
