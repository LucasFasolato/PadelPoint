import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { SkipCityRequired } from '@common/decorators/skip-city-required.decorator';

import { CompetitiveService } from '../services/competitive.service';
import { InitCompetitiveProfileDto } from '../dto/init-profile.dto';
import { UpsertOnboardingDto } from '../dto/upsert-onboarding.dto';
import { RankingQueryDto } from '../dto/ranking-query.dto';
import { HistoryQueryDto } from '../dto/history-query.dto';
import { SkillRadarResponseDto } from '../dto/skill-radar-response.dto';
import { MatchmakingRivalsQueryDto } from '../dto/matchmaking-rivals-query.dto';
import { MatchmakingRivalsResponseDto } from '../dto/matchmaking-rivals-response.dto';
import { CompetitiveChallengesQueryDto } from '../dto/competitive-challenges-query.dto';
import {
  DiscoverCandidatesQueryDto,
  DiscoverMode,
  DiscoverScope,
} from '../dto/discover-candidates-query.dto';
import { DiscoverCandidatesResponseDto } from '../dto/discover-candidates-response.dto';
import {
  MatchmakingCandidatesQueryDto,
  MatchmakingCandidatesScope,
  MatchmakingPosition,
} from '../dto/matchmaking-candidates-query.dto';
import { MatchmakingCandidatesResponseDto } from '../dto/matchmaking-candidates-response.dto';
import { MatchType } from '../../matches/enums/match-type.enum';

type AuthUser = {
  userId: string;
  email: string;
  role: string;
  cityId?: string | null;
};

@UseGuards(JwtAuthGuard, CityRequiredGuard)
@ApiTags('competitive')
@Controller('competitive')
export class CompetitiveController {
  constructor(private readonly competitive: CompetitiveService) {}

  @Get('me')
  meV2(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getOrCreateProfile(user.userId);
  }

  @Get('profile/me')
  me(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getOrCreateProfile(user.userId);
  }

  @Post('profile/init')
  init(@Req() req: Request, @Body() dto: InitCompetitiveProfileDto) {
    const user = req.user as AuthUser;
    return this.competitive.initProfileCategory(user.userId, dto.category);
  }

  @Get('profile/me/history')
  history(@Req() req: Request, @Query() q: HistoryQueryDto) {
    const user = req.user as AuthUser;
    return this.competitive.eloHistory(user.userId, {
      limit: q.limit ?? 20,
      cursor: q.cursor,
    });
  }

  @Get('profile/me/radar')
  @ApiOperation({
    summary: 'Get computed skill radar metrics for current player',
  })
  @ApiOkResponse({ type: SkillRadarResponseDto })
  radar(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getSkillRadar(user.userId);
  }

  @Get('matchmaking/rivals')
  @ApiOperation({
    summary: 'Find suggested rivals for current player (legacy endpoint)',
    deprecated: true,
  })
  @ApiOkResponse({ type: MatchmakingRivalsResponseDto })
  matchmakingRivals(
    @Req() req: Request,
    @Query() q: MatchmakingRivalsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.competitive.findRivalSuggestions(user.userId, {
      limit: q.limit ?? 20,
      cursor: q.cursor,
      range: q.range ?? 100,
      sameCategory: q.sameCategory ?? true,
      scopeCityId: user.cityId ?? undefined,
    });
  }

  @Get('matchmaking/partners')
  @ApiOperation({
    summary: 'Find suggested partners for current player (legacy endpoint)',
    deprecated: true,
  })
  @ApiOkResponse({ type: MatchmakingRivalsResponseDto })
  matchmakingPartners(
    @Req() req: Request,
    @Query() q: MatchmakingRivalsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.competitive.findPartnerSuggestions(user.userId, {
      limit: q.limit ?? 20,
      cursor: q.cursor,
      range: q.range ?? 100,
      sameCategory: q.sameCategory ?? true,
      scopeCityId: user.cityId ?? undefined,
    });
  }

  @Get('matchmaking/candidates')
  @SkipCityRequired()
  @ApiOperation({ summary: 'Canonical matchmaking candidates endpoint' })
  @ApiQuery({ name: 'scope', required: false, enum: MatchmakingCandidatesScope })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Optional category filter. Supports 7, 7ma, 6ta.',
    examples: {
      numeric: { value: '7' },
      ordinal: { value: '7ma' },
      canonical: { value: '6ta' },
    },
  })
  @ApiQuery({ name: 'matchType', required: false, enum: MatchType })
  @ApiQuery({ name: 'position', required: false, enum: MatchmakingPosition })
  @ApiQuery({ name: 'sameCategory', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOkResponse({ type: MatchmakingCandidatesResponseDto })
  matchmakingCandidates(
    @Req() req: Request,
    @Query() q: MatchmakingCandidatesQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.competitive.matchmakingCandidates(user.userId, q);
  }

  @Get('challenges')
  listChallenges(
    @Req() req: Request,
    @Query() q: CompetitiveChallengesQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.competitive.listChallenges(user.userId, {
      view: q.view ?? 'inbox',
    });
  }

  @Get('discover/candidates')
  @ApiOperation({
    summary: 'Discover candidate opponents for current player (legacy endpoint)',
    deprecated: true,
  })
  @ApiOkResponse({ type: DiscoverCandidatesResponseDto })
  async discoverCandidates(
    @Req() req: Request,
    @Query() q: DiscoverCandidatesQueryDto,
  ) {
    const user = req.user as AuthUser;
    const canonical = await this.competitive.matchmakingCandidates(user.userId, {
      scope:
        q.scope === DiscoverScope.PROVINCE
          ? MatchmakingCandidatesScope.PROVINCE
          : MatchmakingCandidatesScope.CITY,
      limit: q.limit ?? 20,
      category: q.category,
      matchType:
        q.mode === DiscoverMode.FRIENDLY
          ? MatchType.FRIENDLY
          : MatchType.COMPETITIVE,
      position: MatchmakingPosition.ANY,
      sameCategory:
        typeof q.category === 'string' && q.category.trim().length > 0,
    });
    return { items: canonical.items };
  }

  @Get('onboarding')
  @SkipCityRequired()
  getOnboarding(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getOnboarding(user.userId);
  }

  @Put('onboarding')
  @SkipCityRequired()
  upsertOnboarding(@Req() req: Request, @Body() dto: UpsertOnboardingDto) {
    const user = req.user as AuthUser;
    return this.competitive.upsertOnboarding(user.userId, dto);
  }

  @Get('ranking')
  ranking(@Req() req: Request, @Query() q: RankingQueryDto) {
    const user = req.user as AuthUser;
    return this.competitive.ranking({
      limit: q.limit ?? 50,
      category: q.category,
      cursor: q.cursor,
      cityId: user.cityId ?? undefined,
    });
  }
}
