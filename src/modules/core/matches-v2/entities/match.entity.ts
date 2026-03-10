import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeagueMode } from '../../leagues/enums/league-mode.enum';
import { MatchType } from '../../matches/enums/match-type.enum';
import { MatchAdminOverrideType } from '../enums/match-admin-override-type.enum';
import { MatchCoordinationStatus } from '../enums/match-coordination-status.enum';
import { MatchOriginType } from '../enums/match-origin-type.enum';
import { MatchRejectionReasonCode } from '../enums/match-rejection-reason-code.enum';
import { MatchSource } from '../enums/match-source.enum';
import { MatchStatus } from '../enums/match-status.enum';
import { MatchTeam } from '../enums/match-team.enum';
import { MatchVoidReasonCode } from '../enums/match-void-reason-code.enum';
import { MatchAuditEvent } from './match-audit-event.entity';
import { MatchDispute } from './match-dispute.entity';
import { MatchMessage } from './match-message.entity';
import { MatchProposal } from './match-proposal.entity';

@Entity('matches_v2')
@Index('idx_matches_v2_league_id', ['leagueId'])
@Index('idx_matches_v2_status', ['status'])
@Index('idx_matches_v2_team_a_player_1_id', ['teamAPlayer1Id'])
@Index('idx_matches_v2_team_a_player_2_id', ['teamAPlayer2Id'])
@Index('idx_matches_v2_team_b_player_1_id', ['teamBPlayer1Id'])
@Index('idx_matches_v2_team_b_player_2_id', ['teamBPlayer2Id'])
@Index('idx_matches_v2_scheduled_at', ['scheduledAt'])
@Index('idx_matches_v2_played_at', ['playedAt'])
@Index('idx_matches_v2_created_at', ['createdAt'])
@Index('idx_matches_v2_legacy_challenge_id', ['legacyChallengeId'], {
  unique: true,
  where: '"legacy_challenge_id" IS NOT NULL',
})
@Index('idx_matches_v2_legacy_match_result_id', ['legacyMatchResultId'], {
  unique: true,
  where: '"legacy_match_result_id" IS NOT NULL',
})
@Index('idx_matches_v2_league_status_played_at', [
  'leagueId',
  'status',
  'playedAt',
])
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'origin_type',
    type: 'varchar',
    enum: MatchOriginType,
  })
  originType!: MatchOriginType;

  @Column({ name: 'origin_challenge_intent_id', type: 'uuid', nullable: true })
  originChallengeIntentId!: string | null;

  @Column({ name: 'origin_league_challenge_id', type: 'uuid', nullable: true })
  originLeagueChallengeId!: string | null;

  @Column({ name: 'source', type: 'varchar', enum: MatchSource })
  source!: MatchSource;

  @Column({ name: 'league_id', type: 'uuid', nullable: true })
  leagueId!: string | null;

  @Column({ name: 'competition_mode', type: 'varchar', enum: LeagueMode })
  competitionMode!: LeagueMode;

  @Column({ name: 'match_type', type: 'varchar', enum: MatchType })
  matchType!: MatchType;

  @Column({ name: 'team_a_player_1_id', type: 'uuid' })
  teamAPlayer1Id!: string;

  @Column({ name: 'team_a_player_2_id', type: 'uuid' })
  teamAPlayer2Id!: string;

  @Column({ name: 'team_b_player_1_id', type: 'uuid' })
  teamBPlayer1Id!: string;

  @Column({ name: 'team_b_player_2_id', type: 'uuid' })
  teamBPlayer2Id!: string;

  @Column({ name: 'status', type: 'varchar', enum: MatchStatus })
  status!: MatchStatus;

  @Column({
    name: 'coordination_status',
    type: 'varchar',
    enum: MatchCoordinationStatus,
    default: MatchCoordinationStatus.NONE,
  })
  coordinationStatus!: MatchCoordinationStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'played_at', type: 'timestamptz', nullable: true })
  playedAt!: Date | null;

  @Column({ name: 'location_label', type: 'varchar', nullable: true })
  locationLabel!: string | null;

  @Column({ name: 'club_id', type: 'uuid', nullable: true })
  clubId!: string | null;

  @Column({ name: 'court_id', type: 'uuid', nullable: true })
  courtId!: string | null;

  @Column({ name: 'result_reported_at', type: 'timestamptz', nullable: true })
  resultReportedAt!: Date | null;

  @Column({
    name: 'result_reported_by_user_id',
    type: 'uuid',
    nullable: true,
  })
  resultReportedByUserId!: string | null;

  @Column({
    name: 'winner_team',
    type: 'varchar',
    enum: MatchTeam,
    nullable: true,
  })
  winnerTeam!: MatchTeam | null;

  @Column({ name: 'sets_json', type: 'jsonb', nullable: true })
  setsJson!: Record<string, unknown>[] | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true })
  confirmedByUserId!: string | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'rejected_by_user_id', type: 'uuid', nullable: true })
  rejectedByUserId!: string | null;

  @Column({
    name: 'rejection_reason_code',
    type: 'varchar',
    enum: MatchRejectionReasonCode,
    nullable: true,
  })
  rejectionReasonCode!: MatchRejectionReasonCode | null;

  @Column({ name: 'rejection_message', type: 'text', nullable: true })
  rejectionMessage!: string | null;

  @Column({ name: 'disputed_at', type: 'timestamptz', nullable: true })
  disputedAt!: Date | null;

  @Column({ name: 'has_open_dispute', type: 'boolean', default: false })
  hasOpenDispute!: boolean;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;

  @Column({ name: 'voided_by_user_id', type: 'uuid', nullable: true })
  voidedByUserId!: string | null;

  @Column({
    name: 'void_reason_code',
    type: 'varchar',
    enum: MatchVoidReasonCode,
    nullable: true,
  })
  voidReasonCode!: MatchVoidReasonCode | null;

  @Column({ name: 'impact_ranking', type: 'boolean', default: false })
  impactRanking!: boolean;

  @Column({ name: 'elo_applied', type: 'boolean', default: false })
  eloApplied!: boolean;

  @Column({ name: 'standings_applied', type: 'boolean', default: false })
  standingsApplied!: boolean;

  @Column({ name: 'ranking_impact_json', type: 'jsonb', nullable: true })
  rankingImpactJson!: Record<string, unknown> | null;

  @Column({
    name: 'admin_override_type',
    type: 'varchar',
    enum: MatchAdminOverrideType,
    nullable: true,
  })
  adminOverrideType!: MatchAdminOverrideType | null;

  @Column({ name: 'admin_override_by_user_id', type: 'uuid', nullable: true })
  adminOverrideByUserId!: string | null;

  @Column({ name: 'admin_override_at', type: 'timestamptz', nullable: true })
  adminOverrideAt!: Date | null;

  @Column({ name: 'admin_override_reason', type: 'text', nullable: true })
  adminOverrideReason!: string | null;

  @Column({ name: 'legacy_challenge_id', type: 'uuid', nullable: true })
  legacyChallengeId!: string | null;

  @Column({ name: 'legacy_match_result_id', type: 'uuid', nullable: true })
  legacyMatchResultId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;

  @OneToMany(() => MatchProposal, (proposal) => proposal.match)
  proposals!: MatchProposal[];

  @OneToMany(() => MatchMessage, (message) => message.match)
  messages!: MatchMessage[];

  @OneToOne(() => MatchDispute, (dispute) => dispute.match)
  dispute!: MatchDispute | null;

  @OneToMany(() => MatchAuditEvent, (event) => event.match)
  auditEvents!: MatchAuditEvent[];
}
