import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LeagueChallengesService } from './league-challenges.service';
import { CreateLeagueChallengeDto } from './dto/create-league-challenge.dto';
import { ListLeagueChallengesQueryDto } from './dto/list-league-challenges-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
@Controller('leagues/:leagueId/challenges')
export class LeagueChallengesController {
  constructor(private readonly service: LeagueChallengesService) {}

  @Post()
  create(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
    @Body() dto: CreateLeagueChallengeDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.createChallenge(user.userId, leagueId, dto);
  }

  @Get()
  list(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
    @Query() query: ListLeagueChallengesQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.listChallenges(user.userId, leagueId, query.status);
  }
}
