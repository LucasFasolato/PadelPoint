import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ranking_snapshot_runs')
@Index(['createdAt'])
@Index(['status', 'createdAt'])
export class RankingSnapshotRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24 })
  trigger!: 'SCHEDULED' | 'MANUAL';

  @Column({ type: 'varchar', length: 24 })
  status!: 'RUNNING' | 'SUCCESS' | 'FAILED';

  @Column({ type: 'varchar', length: 24, nullable: true })
  scope!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  provinceCode!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cityId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  categoryKey!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  timeframe!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  modeKey!: string | null;

  @Column({ type: 'date', nullable: true })
  asOfDate!: string | null;

  @Column({ type: 'int', default: 0 })
  candidates!: number;

  @Column({ type: 'int', default: 0 })
  computedRows!: number;

  @Column({ type: 'int', default: 0 })
  insertedSnapshots!: number;

  @Column({ type: 'int', default: 0 })
  movementEvents!: number;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
