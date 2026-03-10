import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompetitiveModule } from '../competitive/competitive.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { MatchAuditEvent } from './entities/match-audit-event.entity';
import { MatchDispute } from './entities/match-dispute.entity';
import { MatchMessage } from './entities/match-message.entity';
import { MatchProposal } from './entities/match-proposal.entity';
import { Match } from './entities/match.entity';
import { MatchEffectsService } from './services/match-effects.service';
import { MatchQueryService } from './services/match-query.service';
import { MatchResultLifecycleService } from './services/match-result-lifecycle.service';
import { MatchSchedulingService } from './services/match-scheduling.service';

@Module({
  imports: [
    CompetitiveModule,
    LeaguesModule,
    TypeOrmModule.forFeature([
      Match,
      MatchProposal,
      MatchMessage,
      MatchDispute,
      MatchAuditEvent,
    ]),
  ],
  providers: [
    MatchQueryService,
    MatchEffectsService,
    MatchSchedulingService,
    MatchResultLifecycleService,
  ],
  exports: [
    TypeOrmModule,
    MatchQueryService,
    MatchSchedulingService,
    MatchResultLifecycleService,
  ],
})
export class MatchesV2Module {}
