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
import { League } from './league.entity';
import { User } from '../../users/entities/user.entity';
import { LeagueJoinRequestStatus } from '../enums/league-join-request-status.enum';

@Entity('league_join_requests')
@Index(['leagueId', 'userId'], { unique: true })
@Index(['leagueId', 'status'])
export class LeagueJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: LeagueJoinRequestStatus,
    default: LeagueJoinRequestStatus.PENDING,
  })
  status!: LeagueJoinRequestStatus;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
