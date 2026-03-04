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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/core/auth/guards/roles.guard';
import { Roles } from '@/modules/core/auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { RankingsQueryDto } from '../dto/rankings-query.dto';
import { RankingEligibilityProgressQueryDto } from '../dto/ranking-eligibility-progress-query.dto';
import { RankingEligibilityProgressResponseDto } from '../dto/ranking-eligibility-progress-response.dto';
import { RankingScope } from '../enums/ranking-scope.enum';
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
@ApiBearerAuth()
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

    this.logger.debug(
      JSON.stringify({
        event: 'rankings.query',
        requestId,
        rawKeys,
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

  @Get('me/progress')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiQuery({ name: 'scope', enum: RankingScope, required: true })
  @ApiQuery({
    name: 'category',
    type: String,
    required: false,
    description: 'Category filter. Supports 7, 7ma, 6ta.',
    examples: {
      numeric: { value: '7' },
      ordinal: { value: '7ma' },
      canonical: { value: '6ta' },
    },
  })
  @ApiOkResponse({ type: RankingEligibilityProgressResponseDto })
  getMyProgress(
    @Req() req: Request,
    @Query() query: RankingEligibilityProgressQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.rankingsService.getMyRankingEligibilityProgress({
      userId: user.userId,
      scope: query.scope,
      category: query.category,
    });
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
