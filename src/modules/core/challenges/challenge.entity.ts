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
import { User } from '../users/user.entity';
import { ChallengeStatus } from './challenge-status.enum';
import { ChallengeType } from './challenge-type.enum';

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
