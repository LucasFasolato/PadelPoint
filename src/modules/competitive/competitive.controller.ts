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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { CompetitiveService } from './competitive.service';
import { InitCompetitiveProfileDto } from './dto/init-profile.dto';
import { UpsertOnboardingDto } from './dto/upsert-onboarding.dto';
import { RankingQueryDto } from './dto/ranking-query.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
@Controller('competitive')
export class CompetitiveController {
  constructor(private readonly competitive: CompetitiveService) {}

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
    return this.competitive.eloHistory(user.userId, q.limit ?? 50);
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
    return this.competitive.ranking(q.limit ?? 50);
  }
}
