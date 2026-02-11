import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { LeagueActivity } from './league-activity.entity';
import { LeagueStandingsSnapshot } from './league-standings-snapshot.entity';
import { LeagueChallenge } from './league-challenge.entity';
import { MatchResult } from '../matches/match-result.entity';
import { User } from '../users/user.entity';
import { LeaguesService } from './leagues.service';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { LeaguesController } from './leagues.controller';
import { LeagueChallengesController } from './league-challenges.controller';
import { LeagueChallengeActionsController } from './league-challenge-actions.controller';
import { LeagueChallengesService } from './league-challenges.service';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      League,
      LeagueMember,
      LeagueInvite,
      LeagueActivity,
      LeagueStandingsSnapshot,
      LeagueChallenge,
      MatchResult,
      User,
    ]),
    NotificationsModule,
  ],
  controllers: [
    LeaguesController,
    LeagueChallengesController,
    LeagueChallengeActionsController,
  ],
  providers: [
    LeaguesService,
    LeagueStandingsService,
    LeagueActivityService,
    LeagueChallengesService,
  ],
  exports: [LeagueStandingsService, LeagueActivityService],
})
export class LeaguesModule {}
