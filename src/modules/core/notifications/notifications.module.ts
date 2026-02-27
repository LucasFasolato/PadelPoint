import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from './entities/notification.entity';
import { NotificationEvent } from './entities/notification-event.entity';
import { UserNotification } from './entities/user-notification.entity';
import { LeagueMember } from '@/modules/core/leagues/entities/league-member.entity';
import { MatchResult } from '@/modules/core/matches/entities/match-result.entity';
import { Challenge } from '@/modules/core/challenges/entities/challenge.entity';
import { LeagueInvite } from '@/modules/core/leagues/entities/league-invite.entity';
import { League } from '@/modules/core/leagues/entities/league.entity';
import { User } from '@/modules/core/users/entities/user.entity';
import { NotificationsService } from './services/notifications.service';
import { NotificationService } from './services/notification.service';
import { NotificationEventsService } from './services/notification-events.service';
import { UserNotificationsService } from './services/user-notifications.service';
import { ActivityFeedService } from './services/activity-feed.service';
import { InboxService } from './services/inbox.service';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { NotificationsAdminController } from './controllers/notifications-admin.controller';
import { UserNotificationsController } from './controllers/user-notifications.controller';
import { HealthController } from './controllers/health.controller';
import { MeActivityController } from './controllers/me-activity.controller';
import { MeInboxController } from './controllers/me-inbox.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationEvent,
      UserNotification,
      LeagueMember,
      MatchResult,
      Challenge,
      LeagueInvite,
      League,
      User,
    ]),
  ],
  controllers: [
    NotificationsAdminController,
    UserNotificationsController,
    HealthController,
    MeActivityController,
    MeInboxController,
  ],
  providers: [
    NotificationsService,
    NotificationService,
    NotificationEventsService,
    UserNotificationsService,
    ActivityFeedService,
    InboxService,
    NotificationsGateway,
  ],
  exports: [
    NotificationsService,
    NotificationEventsService,
    NotificationService,
    UserNotificationsService,
    ActivityFeedService,
    InboxService,
    NotificationsGateway,
  ],
})
export class NotificationsModule {}
