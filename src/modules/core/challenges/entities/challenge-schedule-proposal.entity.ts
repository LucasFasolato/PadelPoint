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
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { User } from '../../users/entities/user.entity';
import { Challenge } from './challenge.entity';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';

@Entity('challenge_schedule_proposals')
@Index('IDX_challenge_schedule_proposals_challenge_createdAt', [
  'challengeId',
  'createdAt',
])
@Index('IDX_challenge_schedule_proposals_challenge_status', [
  'challengeId',
  'status',
])
export class ChallengeScheduleProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  challengeId!: string;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengeId' })
  challenge!: Challenge;

  @Column({ type: 'uuid' })
  proposedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proposedByUserId' })
  proposedBy!: User;

  @Column({ type: 'timestamptz' })
  scheduledAt!: Date;

  @Column({ type: 'varchar', length: 160, nullable: true })
  locationLabel!: string | null;

  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @ManyToOne(() => Club, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clubId' })
  club!: Club | null;

  @Column({ type: 'uuid', nullable: true })
  courtId!: string | null;

  @ManyToOne(() => Court, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'courtId' })
  court!: Court | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: ChallengeScheduleProposalStatus,
    default: ChallengeScheduleProposalStatus.PENDING,
  })
  status!: ChallengeScheduleProposalStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
