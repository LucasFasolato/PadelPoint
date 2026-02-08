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
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsQueryDto } from './dto/user-notifications-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private readonly service: UserNotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  list(@Req() req: Request, @Query() query: UserNotificationsQueryDto) {
    const user = req.user as AuthUser;
    return this.service.list(user.userId, {
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

  @Post('read-all')
  async markAllRead(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.service.markAllRead(user.userId);
  }
}
