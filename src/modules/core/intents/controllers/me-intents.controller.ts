import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { MatchIntentsService } from '../services/match-intents.service';
import { MeIntentsQueryDto } from '../dto/me-intents-query.dto';
import { MatchIntentsResponseDto } from '../dto/match-intents.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeIntentsController {
  constructor(private readonly intentsService: MatchIntentsService) {}

  @Get('intents')
  @ApiOkResponse({ type: MatchIntentsResponseDto })
  listIntents(@Req() req: Request, @Query() query: MeIntentsQueryDto) {
    const user = req.user as AuthUser;
    return this.intentsService.listForUser(user.userId, query);
  }
}
