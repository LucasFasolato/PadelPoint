import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Challenge } from '../challenges/challenge.entity';
import { User } from '../users/user.entity';

export enum MatchResultStatus {
  PENDING_CONFIRM = 'pending_confirm',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

export enum WinnerTeam {
  A = 'A',
  B = 'B',
}

@Entity('match_results')
@Index(['challenge'], { unique: true })
export class MatchResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengeId' })
  challenge!: Challenge;

  @Column({ type: 'uuid' })
  challengeId!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  playedAt!: Date;

  // Sets (best of 3)
  @Column({ type: 'int' })
  teamASet1!: number;

  @Column({ type: 'int' })
  teamBSet1!: number;

  @Column({ type: 'int' })
  teamASet2!: number;

  @Column({ type: 'int' })
  teamBSet2!: number;

  @Column({ type: 'int', nullable: true })
  teamASet3!: number | null;

  @Column({ type: 'int', nullable: true })
  teamBSet3!: number | null;

  @Column({ type: 'enum', enum: WinnerTeam })
  winnerTeam!: WinnerTeam;

  @Column({
    type: 'enum',
    enum: MatchResultStatus,
    default: MatchResultStatus.PENDING_CONFIRM,
  })
  status!: MatchResultStatus;

  // Who reported
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'reportedByUserId' })
  reportedBy!: User;

  @Column({ type: 'uuid' })
  reportedByUserId!: string;

  // Who confirmed (optional)
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'confirmedByUserId' })
  confirmedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByUserId!: string | null;

  // Optional admin notes / reason on rejection
  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'boolean', default: false })
  eloApplied!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
