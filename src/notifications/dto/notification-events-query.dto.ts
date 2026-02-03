import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { NotificationEventType } from '../notification-event.entity';

export class NotificationEventsQueryDto {
  @IsOptional()
  @IsEnum(NotificationEventType)
  type?: NotificationEventType;

  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
