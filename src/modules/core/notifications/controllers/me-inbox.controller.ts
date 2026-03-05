import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { UserNotificationsService } from '../services/user-notifications.service';
import { UserNotificationsQueryDto } from '../dto/user-notifications-query.dto';
import { MeInboxQueryDto } from '../dto/me-inbox-query.dto';
import { InboxResponseDto } from '../dto/inbox.dto';
import { InboxService } from '../services/inbox.service';
import { LegacyNotificationsFeedResponseDto } from '../dto/notifications-inbox.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeInboxController {
  constructor(
    private readonly inboxService: InboxService,
    private readonly notificationsService: UserNotificationsService,
  ) {}

  @Get('inbox')
  @ApiOperation({
    summary: 'Legacy inbox endpoint (deprecated)',
    description: 'Use GET /notifications/inbox for the canonical actions inbox.',
    deprecated: true,
  })
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: InboxResponseDto })
  listInbox(@Req() req: Request, @Query() query: MeInboxQueryDto) {
    const user = req.user as AuthUser;
    return this.inboxService.listInbox(user.userId, { limit: query.limit });
  }

  @Get('notifications')
  @ApiOperation({
    summary: 'Legacy notifications feed endpoint (deprecated)',
    description: 'Use GET /notifications for feed history or GET /notifications/inbox for actionable items.',
    deprecated: true,
  })
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: LegacyNotificationsFeedResponseDto })
  listNotifications(
    @Req() req: Request,
    @Query() query: UserNotificationsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.notificationsService.listLegacyFromCanonical(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('notifications/:id/read')
  // Deprecated - use PATCH /notifications/:id/read
  @ApiOperation({ deprecated: true })
  async markRead(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    await this.notificationsService.markRead(user.userId, id);
    return { ok: true };
  }

  @Post('notifications/read-all')
  // Deprecated - use POST /notifications/read-all
  @ApiOperation({ deprecated: true })
  markAllRead(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.notificationsService.markAllRead(user.userId);
  }
}
