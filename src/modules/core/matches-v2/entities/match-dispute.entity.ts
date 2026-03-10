import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DisputeStatus } from '../../matches/enums/dispute-status.enum';
import { MatchDisputeReasonCode } from '../enums/match-dispute-reason-code.enum';
import { Match } from './match.entity';

type MatchDisputeResolution = 'confirm_as_is' | 'void_match';

@Entity('match_disputes_v2')
@Index('idx_match_disputes_v2_match_id', ['matchId'], { unique: true })
@Index('idx_match_disputes_v2_status', ['status'])
export class MatchDispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId!: string;

  @OneToOne(() => Match, (match) => match.dispute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'match_id' })
  match!: Match;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({
    name: 'reason_code',
    type: 'varchar',
    enum: MatchDisputeReasonCode,
  })
  reasonCode!: MatchDisputeReasonCode;

  @Column({ name: 'message', type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'status', type: 'varchar', enum: DisputeStatus })
  status!: DisputeStatus;

  @Column({ name: 'resolution', type: 'varchar', nullable: true })
  resolution!: MatchDisputeResolution | null;

  @Column({ name: 'resolution_message', type: 'text', nullable: true })
  resolutionMessage!: string | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
