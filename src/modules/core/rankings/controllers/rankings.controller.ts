import {
  Controller,
  Get,
  Header,
  Logger,
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
  private readonly logger = new Logger(RankingsController.name);

  constructor(
    private readonly rankingsService: RankingsService,
    private readonly schedulerService: RankingsSnapshotSchedulerService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getRankings(@Req() req: Request, @Query() query: RankingsQueryDto) {
    const user = req.user as AuthUser;
    const headerValue = req.headers['x-railway-request-id'];
    const requestId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue ?? null;
    const rawKeys =
      req.query && typeof req.query === 'object' ? Object.keys(req.query) : [];
    const rawCityId = (req.query as Record<string, unknown>)?.cityId;
    const rawCityName = (req.query as Record<string, unknown>)?.cityName;
    const rawProvinceCode = (req.query as Record<string, unknown>)?.provinceCode;
    const getQueryLen = (value: unknown): number => {
      if (typeof value === 'string') return value.trim().length;
      if (Array.isArray(value)) {
        const first = value.find((entry) => typeof entry === 'string');
        return typeof first === 'string' ? first.trim().length : 0;
      }
      return 0;
    };

    this.logger.debug(
      JSON.stringify({
        event: 'rankings.query',
        requestId,
        rawKeys,
        scopeRaw: query.scope ?? null,
        cityIdType: typeof rawCityId,
        cityIdIsArray: Array.isArray(rawCityId),
        cityIdLen: getQueryLen(rawCityId),
        cityNameType: typeof rawCityName,
        cityNameIsArray: Array.isArray(rawCityName),
        cityNameLen: getQueryLen(rawCityName),
        provinceCodeType: typeof rawProvinceCode,
        provinceCodeIsArray: Array.isArray(rawProvinceCode),
        provinceCodeLen: getQueryLen(rawProvinceCode),
        dto: {
          scope: query.scope ?? null,
          cityId: Boolean(query.cityId),
          cityName: Boolean(query.cityName),
          provinceCode: Boolean(query.provinceCode),
        },
      }),
    );

    return this.rankingsService.getLeaderboard({
      userId: user.userId,
      scope: query.scope,
      provinceCode: query.provinceCode,
      cityId: query.cityId,
      cityName: query.cityName,
      category: query.category,
      timeframe: query.timeframe,
      mode: query.mode,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      context: {
        requestId: requestId ?? undefined,
      },
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
