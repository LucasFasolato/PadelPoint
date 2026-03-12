import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { League } from '../entities/league.entity';

@Entity('league_standings_snapshot')
@Index(['leagueId', 'userId'], { unique: true })
@Index(['leagueId', 'position'])
@Index('idx_league_standings_read_model_rank_order', [
  'leagueId',
  'position',
  'userId',
])
@Index(['leagueId', 'snapshotVersion'])
@Index(['leagueId', 'computedAt'])
export class LeagueStandingsReadModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'int' })
  played!: number;

  @Column({ type: 'int' })
  wins!: number;

  @Column({ type: 'int' })
  losses!: number;

  @Column({ type: 'int' })
  draws!: number;

  @Column({ type: 'int' })
  points!: number;

  @Column({ type: 'int' })
  setsDiff!: number;

  @Column({ type: 'int' })
  gamesDiff!: number;

  @Column({ type: 'double precision', default: 0 })
  winRate!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastWinAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastMatchAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  delta!: number | null;

  @Column({ type: 'int', nullable: true })
  deltaPosition!: number | null;

  @Column({ type: 'int', nullable: true })
  oldPosition!: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  movementType!: string | null;

  @Column({ type: 'int' })
  snapshotVersion!: number;

  @Column({ type: 'timestamptz' })
  computedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
