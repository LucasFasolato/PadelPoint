import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from './entities/notification.entity';
import { NotificationEvent } from './entities/notification-event.entity';
import { UserNotification } from './entities/user-notification.entity';
import { LeagueMember } from '@/modules/core/leagues/entities/league-member.entity';
import { NotificationsService } from './services/notifications.service';
import { NotificationService } from './services/notification.service';
import { NotificationEventsService } from './services/notification-events.service';
import { UserNotificationsService } from './services/user-notifications.service';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { NotificationsAdminController } from './controllers/notifications-admin.controller';
import { UserNotificationsController } from './controllers/user-notifications.controller';
import { HealthController } from './controllers/health.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationEvent,
      UserNotification,
      LeagueMember,
    ]),
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
