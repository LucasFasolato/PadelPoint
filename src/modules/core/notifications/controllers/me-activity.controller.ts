import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ActivityFeedService } from '../services/activity-feed.service';
import { MeActivityQueryDto } from '../dto/me-activity-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeActivityController {
  constructor(private readonly activityFeedService: ActivityFeedService) {}

  @Get('activity')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  list(@Req() req: Request, @Query() query: MeActivityQueryDto) {
    const user = req.user as AuthUser;
    return this.activityFeedService.listForUser(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
