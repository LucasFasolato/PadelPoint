import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Challenge } from './challenge.entity';

@Entity('challenge_messages')
@Index('IDX_challenge_messages_challenge_createdAt', [
  'challengeId',
  'createdAt',
])
export class ChallengeMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  challengeId!: string;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengeId' })
  challenge!: Challenge;

  @Column({ type: 'uuid' })
  senderUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderUserId' })
  sender!: User;

  @Column({ type: 'varchar', length: 500 })
  message!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
