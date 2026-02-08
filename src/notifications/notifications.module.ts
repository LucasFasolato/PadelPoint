import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from './notification.entity';
import { NotificationEvent } from './notification-event.entity';
import { UserNotification } from './user-notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { UserNotificationsService } from './user-notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsAdminController } from './notifications-admin.controller';
import { UserNotificationsController } from './user-notifications.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationEvent, UserNotification]),
  ],
  controllers: [
    NotificationsAdminController,
    UserNotificationsController,
    HealthController,
  ],
  providers: [
    NotificationsService,
    NotificationService,
    NotificationEventsService,
    UserNotificationsService,
    NotificationsGateway,
  ],
  exports: [
    NotificationsService,
    NotificationEventsService,
    NotificationService,
    UserNotificationsService,
    NotificationsGateway,
  ],
})
export class NotificationsModule {}
