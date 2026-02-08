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
import { MatchAuditAction } from './match-audit-action.enum';

@Entity('match_audit_logs')
export class MatchAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  matchId!: string;

  @ManyToOne(() => MatchResult, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match!: MatchResult;

  @Column({ type: 'uuid' })
  actorUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actorUserId' })
  actor!: User;

  @Column({ type: 'enum', enum: MatchAuditAction })
  action!: MatchAuditAction;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
