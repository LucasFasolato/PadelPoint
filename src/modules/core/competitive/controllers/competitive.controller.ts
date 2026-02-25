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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CompetitiveService } from '../services/competitive.service';
import { InitCompetitiveProfileDto } from '../dto/init-profile.dto';
import { UpsertOnboardingDto } from '../dto/upsert-onboarding.dto';
import { RankingQueryDto } from '../dto/ranking-query.dto';
import { HistoryQueryDto } from '../dto/history-query.dto';
import { SkillRadarResponseDto } from '../dto/skill-radar-response.dto';
import { MatchmakingRivalsQueryDto } from '../dto/matchmaking-rivals-query.dto';
import { MatchmakingRivalsResponseDto } from '../dto/matchmaking-rivals-response.dto';
import { CompetitiveChallengesQueryDto } from '../dto/competitive-challenges-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
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
  @ApiOperation({ summary: 'Get computed skill radar metrics for current player' })
  @ApiOkResponse({ type: SkillRadarResponseDto })
  radar(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getSkillRadar(user.userId);
  }

  @Get('matchmaking/rivals')
  @ApiOperation({ summary: 'Find suggested rivals for current player' })
  @ApiOkResponse({ type: MatchmakingRivalsResponseDto })
  matchmakingRivals(@Req() req: Request, @Query() q: MatchmakingRivalsQueryDto) {
    const user = req.user as AuthUser;
    return this.competitive.findRivalSuggestions(user.userId, {
      limit: q.limit ?? 20,
      cursor: q.cursor,
      range: q.range ?? 100,
      sameCategory: q.sameCategory ?? true,
      city: q.city,
      province: q.province,
      country: q.country,
    });
  }

  @Get('matchmaking/partners')
  @ApiOperation({ summary: 'Find suggested partners for current player' })
  @ApiOkResponse({ type: MatchmakingRivalsResponseDto })
  matchmakingPartners(@Req() req: Request, @Query() q: MatchmakingRivalsQueryDto) {
    const user = req.user as AuthUser;
    return this.competitive.findPartnerSuggestions(user.userId, {
      limit: q.limit ?? 20,
      cursor: q.cursor,
      range: q.range ?? 100,
      sameCategory: q.sameCategory ?? true,
      city: q.city,
      province: q.province,
      country: q.country,
    });
  }

  @Get('challenges')
  listChallenges(@Req() req: Request, @Query() q: CompetitiveChallengesQueryDto) {
    const user = req.user as AuthUser;
    return this.competitive.listChallenges(user.userId, {
      view: q.view ?? 'inbox',
    });
  }

  @Get('onboarding')
  getOnboarding(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.competitive.getOnboarding(user.userId);
  }

  @Put('onboarding')
  upsertOnboarding(@Req() req: Request, @Body() dto: UpsertOnboardingDto) {
    const user = req.user as AuthUser;
    return this.competitive.upsertOnboarding(user.userId, dto);
  }

  @Get('ranking')
  ranking(@Query() q: RankingQueryDto) {
    return this.competitive.ranking({
      limit: q.limit ?? 50,
      category: q.category,
      cursor: q.cursor,
    });
  }
}
