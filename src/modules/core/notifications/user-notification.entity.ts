import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserNotificationType } from './user-notification-type.enum';

@Entity('user_notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
export class UserNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: UserNotificationType })
  type!: UserNotificationType;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
