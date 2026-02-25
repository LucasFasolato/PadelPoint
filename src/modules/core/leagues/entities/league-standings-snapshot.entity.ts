import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { League } from '../entities/league.entity';
import { MovementType } from '../standings/standings-diff';

export type LeagueStandingsSnapshotRow = {
  userId: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  setsDiff: number;
  gamesDiff: number;
  position: number;
  /** ISO 8601 timestamp of the player's most recent winning match in this league. */
  lastWinAt?: string;
  // Movement fields — populated when a prior snapshot exists; absent on the first snapshot.
  /** oldPosition - newPosition. Positive = moved up. null = new player. */
  delta?: number | null;
  /** Position in the immediately preceding snapshot. */
  oldPosition?: number | null;
  /** Direction of ranking movement since the last snapshot. */
  movementType?: MovementType;
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
