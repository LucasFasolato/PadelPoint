import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RankingsQueryDto } from '../dto/rankings-query.dto';
import { RankingsService } from '../services/rankings.service';

type AuthUser = {
  userId: string;
  email: string;
  role: string;
  cityId?: string | null;
};

@ApiTags('rankings')
@Controller('rankings')
@UseGuards(JwtAuthGuard)
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getLeaderboard(@Req() req: Request, @Query() q: RankingsQueryDto) {
    const user = req.user as AuthUser;
    return this.rankingsService.getLeaderboard({
      userId: user.userId,
      scope: q.scope,
      provinceCode: q.provinceCode,
      cityId: q.cityId,
      category: q.category,
      timeframe: q.timeframe,
      mode: q.mode,
      page: q.page ?? 1,
      limit: q.limit ?? 50,
    });
  }

  @Get('scopes')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getScopes(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.rankingsService.getAvailableScopes(user.userId);
  }
}

