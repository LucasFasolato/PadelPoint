import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/core/auth/guards/roles.guard';
import { Roles } from '@/modules/core/auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { RankingsQueryDto } from '../dto/rankings-query.dto';
import { RankingsService } from '../services/rankings.service';
import { RankingsSnapshotSchedulerService } from '../services/rankings-snapshot-scheduler.service';
import { RunRankingSnapshotsQueryDto } from '../dto/run-ranking-snapshots-query.dto';

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
  constructor(
    private readonly rankingsService: RankingsService,
    private readonly schedulerService: RankingsSnapshotSchedulerService,
  ) {}

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
      cityName: q.cityName,
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

  @Post('snapshots/run')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  runSnapshots(@Query() q: RunRankingSnapshotsQueryDto) {
    return this.schedulerService.runManual({
      scope: q.scope,
      provinceCode: q.provinceCode,
      cityId: q.cityId,
      category: q.category,
      timeframe: q.timeframe,
      mode: q.mode,
      asOfDate: q.asOfDate,
    });
  }
}
