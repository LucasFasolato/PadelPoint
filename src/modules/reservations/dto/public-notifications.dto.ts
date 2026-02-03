import { IsNotEmpty, IsString } from 'class-validator';
import {
  NotificationEventChannel,
  NotificationEventType,
} from '@/notifications/notification-event.entity';

export class PublicNotificationsQueryDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class PublicNotificationsResendDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export type PublicNotificationEventDto = {
  id: string;
  type: NotificationEventType;
  reservationId: string;
  channel: NotificationEventChannel;
  createdAt: string;
};
