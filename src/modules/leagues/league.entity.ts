import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { LeagueSettings, DEFAULT_LEAGUE_SETTINGS } from './league-settings.type';

@Entity('leagues')
export class League {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index()
  @Column({ type: 'uuid' })
  creatorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creatorId' })
  creator!: User;

  @Column({
    type: 'enum',
    enum: LeagueMode,
    default: LeagueMode.SCHEDULED,
  })
  mode!: LeagueMode;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({
    type: 'enum',
    enum: LeagueStatus,
    default: LeagueStatus.DRAFT,
  })
  status!: LeagueStatus;

  @Column({
    type: 'jsonb',
    default: () => `'${JSON.stringify(DEFAULT_LEAGUE_SETTINGS)}'`,
  })
  settings!: LeagueSettings;

  @OneToMany(() => LeagueMember, (m) => m.league)
  members!: LeagueMember[];

  @OneToMany(() => LeagueInvite, (i) => i.league)
  invites!: LeagueInvite[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
