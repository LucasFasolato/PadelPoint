import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserNotificationType } from '../enums/user-notification-type.enum';

@Entity('user_notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
@Index('idx_user_notifications_user_created_id', ['userId', 'createdAt', 'id'])
@Index('idx_user_notifications_user_read_created_at', [
  'userId',
  'readAt',
  'createdAt',
])
export class UserNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

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
