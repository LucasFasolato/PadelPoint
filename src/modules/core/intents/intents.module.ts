import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from '@core/challenges/entities/challenge.entity';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { ChallengeInvite } from '@core/challenges/entities/challenge-invite.entity';
import { MeIntentsController } from './controllers/me-intents.controller';
import { MatchIntentsService } from './services/match-intents.service';

@Module({
  imports: [TypeOrmModule.forFeature([Challenge, MatchResult, ChallengeInvite])],
  controllers: [MeIntentsController],
  providers: [MatchIntentsService],
  exports: [MatchIntentsService],
})
export class IntentsModule {}
