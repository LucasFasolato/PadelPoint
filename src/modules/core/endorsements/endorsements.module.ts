import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { User } from '@core/users/entities/user.entity';
import { MatchEndorsement } from './entities/match-endorsement.entity';
import { MatchEndorsementsService } from './services/match-endorsements.service';
import { MatchEndorsementsController } from './controllers/match-endorsements.controller';
import { PlayerStrengthsController } from './controllers/player-strengths.controller';
import { MeReputationController } from './controllers/me-reputation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MatchResult, MatchEndorsement, User])],
  providers: [MatchEndorsementsService],
  controllers: [
    MatchEndorsementsController,
    PlayerStrengthsController,
    MeReputationController,
  ],
})
export class EndorsementsModule {}
