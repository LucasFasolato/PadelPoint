import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchAuditEvent } from './entities/match-audit-event.entity';
import { MatchDispute } from './entities/match-dispute.entity';
import { MatchMessage } from './entities/match-message.entity';
import { MatchProposal } from './entities/match-proposal.entity';
import { Match } from './entities/match.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Match,
      MatchProposal,
      MatchMessage,
      MatchDispute,
      MatchAuditEvent,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class MatchesV2Module {}
