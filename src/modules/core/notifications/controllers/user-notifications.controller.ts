import {
  Controller,
  Get,
  Header,
  Patch,
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
import {
  CanonicalNotificationsInboxResponseDto,
  LegacyNotificationsFeedResponseDto,
} from '../dto/notifications-inbox.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private readonly service: UserNotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary:
      'General notifications feed (history). For actionable notifications, use /notifications/inbox.',
  })
  @ApiOkResponse({ type: LegacyNotificationsFeedResponseDto })
  list(@Req() req: Request, @Query() query: UserNotificationsQueryDto) {
    const user = req.user as AuthUser;
    // Compatibility alias for old clients; canonical endpoint is GET /notifications/inbox
    return this.service.listLegacyFromCanonical(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('inbox')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary:
      'Canonical actions inbox (invites, challenges, pending confirmations) with action metadata.',
  })
  @ApiOkResponse({ type: CanonicalNotificationsInboxResponseDto })
  inbox(@Req() req: Request, @Query() query: UserNotificationsQueryDto) {
    const user = req.user as AuthUser;
    return this.service.listInboxCanonical(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  async unreadCount(@Req() req: Request) {
    const user = req.user as AuthUser;
    const count = await this.service.getUnreadCount(user.userId);
    return { count };
  }

  @Post(':id/read')
  async markRead(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    await this.service.markRead(user.userId, id);
    return { ok: true };
  }

  @Patch(':id/read')
  async markReadPatch(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    await this.service.markRead(user.userId, id);
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.service.markAllRead(user.userId);
  }
}
