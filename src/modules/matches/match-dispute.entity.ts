import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MatchResult } from './match-result.entity';
import { User } from '../users/user.entity';
import { DisputeReasonCode } from './dispute-reason.enum';
import { DisputeStatus } from './dispute-status.enum';

@Entity('match_disputes')
@Index(['matchId'], { unique: true, where: `"status" = 'open'` })
export class MatchDispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  matchId!: string;

  @ManyToOne(() => MatchResult, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match!: MatchResult;

  @Column({ type: 'uuid' })
  raisedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'raisedByUserId' })
  raisedBy!: User;

  @Column({ type: 'enum', enum: DisputeReasonCode })
  reasonCode!: DisputeReasonCode;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.OPEN,
  })
  status!: DisputeStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
