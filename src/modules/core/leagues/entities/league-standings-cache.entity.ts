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

@Entity('league_standings_cache')
@Index(['leagueId', 'userId'], { unique: true })
@Index(['leagueId', 'position'])
@Index(['leagueId', 'snapshotVersion'])
export class LeagueStandingsCache {
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

  @Column({ type: 'timestamptz', nullable: true })
  lastWinAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  delta!: number | null;

  @Column({ type: 'int', nullable: true })
  oldPosition!: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  movementType!: string | null;

  @Column({ type: 'int' })
  snapshotVersion!: number;

  @Column({ type: 'timestamptz' })
  snapshotComputedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
