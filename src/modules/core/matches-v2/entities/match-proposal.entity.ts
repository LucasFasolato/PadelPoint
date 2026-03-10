import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChallengeScheduleProposalStatus } from '../../challenges/enums/challenge-schedule-proposal-status.enum';
import { Match } from './match.entity';

@Entity('match_proposals_v2')
@Index('idx_match_proposals_v2_match_id', ['matchId'])
@Index('idx_match_proposals_v2_match_id_status', ['matchId', 'status'])
@Index('idx_match_proposals_v2_created_at', ['createdAt'])
export class MatchProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId!: string;

  @ManyToOne(() => Match, (match) => match.proposals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'match_id' })
  match!: Match;

  @Column({ name: 'proposed_by_user_id', type: 'uuid' })
  proposedByUserId!: string;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt!: Date;

  @Column({ name: 'location_label', type: 'varchar', nullable: true })
  locationLabel!: string | null;

  @Column({ name: 'club_id', type: 'uuid', nullable: true })
  clubId!: string | null;

  @Column({ name: 'court_id', type: 'uuid', nullable: true })
  courtId!: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: ChallengeScheduleProposalStatus,
  })
  status!: ChallengeScheduleProposalStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
