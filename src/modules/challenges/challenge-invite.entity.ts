import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Challenge } from './challenge.entity';

export enum ChallengeInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('challenge_invites')
@Index(['challengeId', 'inviteeId'], { unique: true })
export class ChallengeInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  challengeId!: string;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengeId' })
  challenge!: Challenge;

  @Column({ type: 'uuid' })
  inviterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviterId' })
  inviter!: User;

  @Column({ type: 'uuid' })
  inviteeId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviteeId' })
  invitee!: User;

  @Column({
    type: 'enum',
    enum: ChallengeInviteStatus,
    default: ChallengeInviteStatus.PENDING,
  })
  status!: ChallengeInviteStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
