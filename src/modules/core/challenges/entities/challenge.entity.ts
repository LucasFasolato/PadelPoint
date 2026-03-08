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
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { ChallengeType } from '../enums/challenge-type.enum';
import { MatchType } from '../../matches/enums/match-type.enum';

@Entity('challenges')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: ChallengeType })
  type!: ChallengeType;

  @Column({
    type: 'enum',
    enum: ChallengeStatus,
    default: ChallengeStatus.PENDING,
  })
  status!: ChallengeStatus;

  @Column({
    type: 'enum',
    enum: MatchType,
    default: MatchType.COMPETITIVE,
  })
  matchType!: MatchType;

  // -----------------
  // Team A
  // -----------------
  @Index()
  @Column({ type: 'uuid' })
  teamA1Id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamA1Id' })
  teamA1!: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  teamA2Id!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'teamA2Id' })
  teamA2!: User | null;

  // -----------------
  // Team B
  // -----------------
  @Index()
  @Column({ type: 'uuid', nullable: true })
  teamB1Id!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'teamB1Id' })
  teamB1!: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  teamB2Id!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'teamB2Id' })
  teamB2!: User | null;

  /**
   * DIRECT: invited opponent (must be teamB1)
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  invitedOpponentId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invitedOpponentId' })
  invitedOpponent!: User | null;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'int', nullable: true })
  targetCategory!: number | null;

  @Column({ type: 'varchar', length: 280, nullable: true })
  message!: string | null;

  @Column({
    type: 'enum',
    enum: ChallengeCoordinationStatus,
    nullable: true,
  })
  coordinationStatus!: ChallengeCoordinationStatus | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  locationLabel!: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @ManyToOne(() => Club, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clubId' })
  club!: Club | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  courtId!: string | null;

  @ManyToOne(() => Court, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'courtId' })
  court!: Court | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
