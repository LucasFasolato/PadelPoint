import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchResult } from './match-result.entity';
import { MatchDispute } from './match-dispute.entity';
import { MatchAuditLog } from './match-audit-log.entity';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { Challenge } from '../challenges/challenge.entity';
import { User } from '../users/user.entity';
import { CompetitiveModule } from '../competitive/competitive.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MatchResult, MatchDispute, MatchAuditLog, Challenge, User]),
    CompetitiveModule,
    LeaguesModule,
    NotificationsModule,
  ],
  providers: [MatchesService],
  controllers: [MatchesController],
})
export class MatchesModule {}
