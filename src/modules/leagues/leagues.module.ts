import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { MatchResult } from '../matches/match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { CompetitiveProfile } from '../competitive/competitive-profile.entity';
import { User } from '../users/user.entity';
import { LeaguesService } from './leagues.service';
import { LeagueStandingsService } from './league-standings.service';
import { LeaguesController } from './leagues.controller';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      League,
      LeagueMember,
      LeagueInvite,
      MatchResult,
      Challenge,
      CompetitiveProfile,
      User,
    ]),
    NotificationsModule,
  ],
  controllers: [LeaguesController],
  providers: [LeaguesService, LeagueStandingsService],
  exports: [LeagueStandingsService],
})
export class LeaguesModule {}
