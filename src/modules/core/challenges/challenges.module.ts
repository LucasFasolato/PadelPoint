import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { Challenge } from './entities/challenge.entity';
import { ChallengeInvite } from './entities/challenge-invite.entity';
import { ChallengeMessage } from './entities/challenge-message.entity';
import { ChallengeScheduleProposal } from './entities/challenge-schedule-proposal.entity';
import { ChallengesController } from './controllers/challenges.controller';
import { ChallengeCoordinationService } from './services/challenge-coordination.service';
import { ChallengesV2CoordinationBridgeService } from './services/challenges-v2-coordination-bridge.service';
import { ChallengesService } from './services/challenges.service';
import { ChallengeInvitesController } from './controllers/challenge-invites.controller';
import { ChallengeInvitesService } from './services/challenge-invites.service';
import { UsersModule } from '../users/users.module';
import { CompetitiveModule } from '../competitive/competitive.module';
import { NotificationsModule } from '@/modules/core/notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { MatchResult } from '../matches/entities/match-result.entity';
import { MatchesV2Module } from '../matches-v2/matches-v2.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Challenge,
      ChallengeInvite,
      ChallengeMessage,
      ChallengeScheduleProposal,
      User,
      MatchResult,
      Club,
      Court,
    ]),
    UsersModule,
    CompetitiveModule,
    NotificationsModule,
    MatchesV2Module,
  ],
  controllers: [ChallengesController, ChallengeInvitesController],
  providers: [
    ChallengesService,
    ChallengeCoordinationService,
    ChallengesV2CoordinationBridgeService,
    ChallengeInvitesService,
    CityRequiredGuard,
  ],
  exports: [ChallengesService, ChallengeCoordinationService],
})
export class ChallengesModule {}
