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

export type LeagueStandingsSnapshotRow = {
  userId: string;
  points: number;
  wins: number;
  losses: number;
  draws?: number;
  setsDiff: number;
  gamesDiff: number;
  position: number;
};

@Entity('league_standings_snapshots')
@Index(['leagueId'])
@Index(['computedAt'])
@Index(['leagueId', 'version'], { unique: true })
export class LeagueStandingsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'int' })
  version!: number;

  @CreateDateColumn()
  computedAt!: Date;

  @Column({ type: 'jsonb' })
  rows!: LeagueStandingsSnapshotRow[];
}
