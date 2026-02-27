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
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { UserNotificationsService } from '../services/user-notifications.service';
import { UserNotificationsQueryDto } from '../dto/user-notifications-query.dto';
import { MeInboxQueryDto } from '../dto/me-inbox-query.dto';
import { InboxResponseDto } from '../dto/inbox.dto';
import { InboxService } from '../services/inbox.service';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeInboxController {
  constructor(
    private readonly inboxService: InboxService,
    private readonly notificationsService: UserNotificationsService,
  ) {}

  @Get('inbox')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: InboxResponseDto })
  listInbox(@Req() req: Request, @Query() query: MeInboxQueryDto) {
    const user = req.user as AuthUser;
    return this.inboxService.listInbox(user.userId, { limit: query.limit });
  }

  @Get('notifications')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  listNotifications(
    @Req() req: Request,
    @Query() query: UserNotificationsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.notificationsService.list(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('notifications/:id/read')
  async markRead(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    await this.notificationsService.markRead(user.userId, id);
    return { ok: true };
  }

  @Post('notifications/read-all')
  markAllRead(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.notificationsService.markAllRead(user.userId);
  }
}
