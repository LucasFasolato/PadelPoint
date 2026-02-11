import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { League } from './league.entity';
import { LeagueRole } from './league-role.enum';

@Entity('league_members')
@Index(['leagueId', 'userId'], { unique: true })
@Index(['leagueId'])
export class LeagueMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, (l) => l.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: LeagueRole, default: LeagueRole.MEMBER })
  role!: LeagueRole;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'int', default: 0 })
  wins!: number;

  @Column({ type: 'int', default: 0 })
  losses!: number;

  @Column({ type: 'int', default: 0 })
  draws!: number;

  @Column({ type: 'int', default: 0 })
  setsDiff!: number;

  @Column({ type: 'int', default: 0 })
  gamesDiff!: number;

  @Column({ type: 'int', nullable: true })
  position!: number | null;

  @CreateDateColumn()
  joinedAt!: Date;
}
