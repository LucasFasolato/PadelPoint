import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum NotificationEventType {
  HOLD_CREATED = 'hold.created',
  RESERVATION_CONFIRMED = 'reservation.confirmed',
  NOTIFICATION_RESEND_REQUESTED = 'notification.resend_requested',
}

export enum NotificationEventChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  MOCK = 'mock',
}

export type NotificationEventPayload = {
  reservationId: string;
  courtId: string;
  clubId: string;
  startAt: string;
  endAt: string;
  precio: number;
  status: string;
  confirmedAt?: string | null;
};

@Entity({ name: 'notification_events' })
@Index(['type'])
@Index(['reservationId'])
@Index(['createdAt'])
export class NotificationEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: NotificationEventType })
  type!: NotificationEventType;

  @Column({ type: 'uuid' })
  reservationId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'enum', enum: NotificationEventChannel })
  channel!: NotificationEventChannel;

  @Column({ type: 'jsonb' })
  payload!: NotificationEventPayload;

  @CreateDateColumn()
  createdAt!: Date;
}
