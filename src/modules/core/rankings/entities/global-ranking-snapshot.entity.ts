import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { City } from '../../geo/entities/city.entity';
import { MovementType } from '../../leagues/standings/standings-diff';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';

export type GlobalRankingSnapshotRow = {
  userId: string;
  displayName: string;
  cityId: string | null;
  provinceCode: string | null;
  category: number | null;
  categoryKey: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  setsDiff: number;
  gamesDiff: number;
  rating: number;
  elo: number | null;
  opponentAvgElo: number | null;
  position: number;
  /** oldPosition - newPosition. Positive means moved up. */
  delta?: number | null;
  oldPosition?: number | null;
  movementType?: MovementType;
};

@Entity('global_ranking_snapshots')
@Index(['dimensionKey', 'categoryKey', 'timeframe', 'modeKey', 'asOfDate'])
@Index(['dimensionKey', 'categoryKey', 'timeframe', 'modeKey', 'asOfDate'], {
  unique: true,
})
@Index(['scope', 'provinceCode', 'cityId', 'asOfDate'])
@Index(['computedAt'])
@Index(['dimensionKey', 'categoryKey', 'timeframe', 'modeKey', 'version'], {
  unique: true,
})
export class GlobalRankingSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  dimensionKey!: string;

  @Column({ type: 'enum', enum: RankingScope })
  scope!: RankingScope;

  @Column({ type: 'varchar', length: 16, nullable: true })
  provinceCode!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cityId!: string | null;

  @ManyToOne(() => City, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cityId' })
  city!: City | null;

  @Column({ type: 'varchar', length: 24 })
  categoryKey!: string;

  @Column({
    type: 'enum',
    enum: RankingTimeframe,
    default: RankingTimeframe.CURRENT_SEASON,
  })
  timeframe!: RankingTimeframe;

  @Column({ type: 'varchar', length: 24, default: 'COMPETITIVE' })
  modeKey!: string;

  @Column({ type: 'date' })
  asOfDate!: string;

  @Column({ type: 'int' })
  version!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  computedAt!: Date;

  @Column({ type: 'jsonb' })
  rows!: GlobalRankingSnapshotRow[];
}
