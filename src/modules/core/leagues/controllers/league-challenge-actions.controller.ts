import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { LeagueChallengesService } from '../services/league-challenges.service';
import { LinkLeagueChallengeMatchDto } from '../dto/link-league-challenge-match.dto';

type AuthUser = { userId: string; email: string; role: string };

/**
 * Canonical league challenge action endpoints.
 *
 * These routes operate on LeagueChallenge entities (NOT regular Challenge entities).
 * Frontend MUST use these endpoints for league challenge accept/decline/link-match.
 *
 * Canon:
 *   POST /challenges/:id/accept     — accept a league challenge (opponent only)
 *   POST /challenges/:id/decline    — decline a league challenge (opponent only)
 *   POST /challenges/:id/link-match — link a completed match to a league challenge
 *
 * NOTE: PATCH /challenges/:id/accept and PATCH /challenges/:id/reject
 * in ChallengesController are for REGULAR (non-league) challenges only.
 * Do NOT use those routes for league challenges.
 */
@ApiTags('league-challenge-actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('challenges')
export class LeagueChallengeActionsController {
  constructor(private readonly service: LeagueChallengesService) {}

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept a league challenge (canonical)',
    description:
      'Only the opponent can accept. Validates league membership and expiry. ' +
      'Canon endpoint for league challenge accept — do NOT use PATCH /challenges/:id/accept (regular direct challenge).',
  })
  accept(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.acceptChallenge(user.userId, id);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline a league challenge (canonical)',
    description:
      'Only the opponent can decline. Canon endpoint for league challenge decline — ' +
      'do NOT use PATCH /challenges/:id/reject (regular direct challenge).',
  })
  decline(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.declineChallenge(user.userId, id);
  }

  @Post(':id/link-match')
  @ApiOperation({
    summary: 'Link a completed match to a league challenge',
    description: 'Either participant can link the match once the league challenge is accepted.',
  })
  linkMatch(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: LinkLeagueChallengeMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.linkMatch(user.userId, id, dto.matchId);
  }
}
