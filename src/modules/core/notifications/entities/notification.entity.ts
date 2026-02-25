import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum NotificationChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

export enum NotificationStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
}

export type NotificationPayload = {
  link?: string;
  text?: string;
  subject?: string;
} | null;

@Entity({ name: 'notifications' })
@Index(['reservationId', 'channel', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reservationId!: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel!: NotificationChannel;

  // destino: email / phone / etc
  @Column({ type: 'varchar', length: 180, nullable: true })
  to!: string | null;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.QUEUED,
  })
  status!: NotificationStatus;

  @Column({ type: 'varchar', length: 40, default: 'MOCK' })
  provider!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: NotificationPayload;

  @CreateDateColumn()
  createdAt!: Date;
}
