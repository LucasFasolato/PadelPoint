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
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';

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

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: LeagueStatus,
    default: LeagueStatus.DRAFT,
  })
  status!: LeagueStatus;

  @OneToMany(() => LeagueMember, (m) => m.league)
  members!: LeagueMember[];

  @OneToMany(() => LeagueInvite, (i) => i.league)
  invites!: LeagueInvite[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
