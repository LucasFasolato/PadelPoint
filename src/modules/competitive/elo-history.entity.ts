import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CompetitiveProfile } from './competitive-profile.entity';

export enum EloHistoryReason {
  INIT_CATEGORY = 'init_category',
  MATCH_RESULT = 'match_result',
}

@Entity('elo_history')
@Index(['profileId', 'reason', 'refId'])
@Index(['reason', 'refId'])
export class EloHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => CompetitiveProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile!: CompetitiveProfile;

  @Column({ type: 'int' })
  eloBefore!: number;

  @Column({ type: 'int' })
  eloAfter!: number;

  @Column({ type: 'int' })
  delta!: number;

  @Column({ type: 'enum', enum: EloHistoryReason })
  reason!: EloHistoryReason;

  // matchResultId (or challengeId later)
  @Column({ type: 'uuid', nullable: true })
  refId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
