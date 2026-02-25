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
import { Challenge } from '../../challenges/entities/challenge.entity';
import { League } from '../../leagues/entities/league.entity';
import { User } from '../../users/entities/user.entity';
import { MatchSource } from '../enums/match-source.enum';

export enum MatchResultStatus {
  SCHEDULED = 'scheduled',
  PENDING_CONFIRM = 'pending_confirm',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
  DISPUTED = 'disputed',
  RESOLVED = 'resolved',
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

  @Index()
  @Column({ type: 'uuid', nullable: true })
  leagueId!: string | null;

  @ManyToOne(() => League, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leagueId' })
  league!: League | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  playedAt!: Date | null;

  // Sets (best of 3)
  @Column({ type: 'int', nullable: true })
  teamASet1!: number | null;

  @Column({ type: 'int', nullable: true })
  teamBSet1!: number | null;

  @Column({ type: 'int', nullable: true })
  teamASet2!: number | null;

  @Column({ type: 'int', nullable: true })
  teamBSet2!: number | null;

  @Column({ type: 'int', nullable: true })
  teamASet3!: number | null;

  @Column({ type: 'int', nullable: true })
  teamBSet3!: number | null;

  @Column({ type: 'enum', enum: WinnerTeam, nullable: true })
  winnerTeam!: WinnerTeam | null;

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

  @Column({
    type: 'enum',
    enum: MatchSource,
    default: MatchSource.RESERVATION,
  })
  source!: MatchSource;

  @Column({ type: 'boolean', default: false })
  eloApplied!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
