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
import { LeagueActivityType } from './league-activity-type.enum';

@Entity('league_activity')
export class LeagueActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'enum', enum: LeagueActivityType })
  type!: LeagueActivityType;

  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}
