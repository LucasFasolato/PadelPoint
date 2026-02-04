import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from './notification.entity';
import { NotificationEvent } from './notification-event.entity';
import { NotificationsService } from './notifications.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationsAdminController } from './notifications-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, NotificationEvent])],
  controllers: [NotificationsAdminController],
  providers: [
    NotificationsService,
    NotificationService,
    NotificationEventsService,
  ],
  exports: [
    NotificationsService,
    NotificationEventsService,
    NotificationService,
  ],
})
export class NotificationsModule {}
