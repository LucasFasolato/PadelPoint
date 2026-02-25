import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { League } from './entities/league.entity';
import { LeagueMember } from './entities/league-member.entity';
import { LeagueInvite } from './entities/league-invite.entity';
import { LeagueActivity } from './entities/league-activity.entity';
import { LeagueStandingsSnapshot } from './entities/league-standings-snapshot.entity';
import { LeagueChallenge } from './entities/league-challenge.entity';
import { MatchResult } from '../matches/entities/match-result.entity';
import { User } from '../users/entities/user.entity';
import { MediaAsset } from '@core/media/entities/media-asset.entity';
import { LeaguesService } from './services/leagues.service';
import { LeagueStandingsService } from './services/league-standings.service';
import { LeagueActivityService } from './services/league-activity.service';
import { LeaguesController } from './controllers/leagues.controller';
import { PublicLeaguesController } from './controllers/public-leagues.controller';
import { LeagueChallengesController } from './controllers/league-challenges.controller';
import { LeagueChallengeActionsController } from './controllers/league-challenge-actions.controller';
import { LeagueChallengesService } from './services/league-challenges.service';
import { NotificationsModule } from '@/modules/core/notifications/notifications.module';

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
      MediaAsset,
    ]),
    NotificationsModule,
  ],
  controllers: [
    LeaguesController,
    PublicLeaguesController,
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
