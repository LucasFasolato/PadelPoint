import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { League } from './league.entity';
import { User } from '../users/user.entity';
import { MatchResult } from '../matches/match-result.entity';
import { LeagueChallengeStatus } from './league-challenge-status.enum';

@Entity('league_challenges')
@Index(['leagueId'])
@Index(['createdById'])
@Index(['opponentId'])
@Index(['status'])
@Index(['expiresAt'])
@Index(['matchId'])
export class LeagueChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User;

  @Column({ type: 'uuid' })
  opponentId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opponentId' })
  opponent!: User;

  @Column({
    type: 'enum',
    enum: LeagueChallengeStatus,
    default: LeagueChallengeStatus.PENDING,
  })
  status!: LeagueChallengeStatus;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({
    type: 'timestamptz',
    default: () => `now() + interval '7 days'`,
  })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  matchId!: string | null;

  @ManyToOne(() => MatchResult, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'matchId' })
  match!: MatchResult | null;

  @CreateDateColumn()
  createdAt!: Date;
}
