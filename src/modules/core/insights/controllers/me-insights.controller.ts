import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { InsightsService } from '../services/insights.service';
import { InsightsQueryDto } from '../dto/insights-query.dto';
import { InsightsDto } from '../dto/insights.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeInsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('insights')
  @ApiOkResponse({ type: InsightsDto })
  getInsights(@Req() req: Request, @Query() query: InsightsQueryDto) {
    const user = req.user as AuthUser;
    return this.insightsService.getMyInsights({
      userId: user.userId,
      timeframe: query.timeframe,
      mode: query.mode,
    });
  }
}
