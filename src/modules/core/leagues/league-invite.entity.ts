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
import { InviteStatus } from './invite-status.enum';

@Entity('league_invites')
export class LeagueInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  leagueId!: string;

  @ManyToOne(() => League, (l) => l.invites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leagueId' })
  league!: League;

  @Column({ type: 'uuid', nullable: true })
  invitedUserId!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  invitedEmail!: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  token!: string;

  @Column({
    type: 'enum',
    enum: InviteStatus,
    default: InviteStatus.PENDING,
  })
  status!: InviteStatus;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
