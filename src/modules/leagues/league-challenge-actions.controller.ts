import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LeagueChallengesService } from './league-challenges.service';
import { LinkLeagueChallengeMatchDto } from './dto/link-league-challenge-match.dto';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
@Controller('challenges')
export class LeagueChallengeActionsController {
  constructor(private readonly service: LeagueChallengesService) {}

  @Post(':id/accept')
  accept(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.acceptChallenge(user.userId, id);
  }

  @Post(':id/decline')
  decline(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.declineChallenge(user.userId, id);
  }

  @Post(':id/link-match')
  linkMatch(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: LinkLeagueChallengeMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.linkMatch(user.userId, id, dto.matchId);
  }
}
