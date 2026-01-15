import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChallengeInvitesService } from './challenge-invites.service';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
@Controller('challenge-invites')
export class ChallengeInvitesController {
  constructor(private readonly service: ChallengeInvitesService) {}

  @Post()
  invite(
    @Req() req: Request,
    @Body() dto: { challengeId: string; userId: string },
  ) {
    const me = req.user as AuthUser;
    return this.service.inviteTeammate(dto.challengeId, me.userId, dto.userId);
  }

  // Inbox de INVITES (soy invitee)
  @Get('inbox')
  inbox(@Req() req: Request, @Query('status') status?: string) {
    const me = req.user as AuthUser;
    return this.service.inbox(me.userId, status);
  }

  // Outbox de INVITES (soy inviter)
  @Get('outbox')
  outbox(@Req() req: Request, @Query('status') status?: string) {
    const me = req.user as AuthUser;
    return this.service.outbox(me.userId, status);
  }

  @Patch(':id/accept')
  accept(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.acceptInvite(id, me.userId);
  }

  @Patch(':id/reject')
  reject(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.rejectInvite(id, me.userId);
  }

  @Patch(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.cancelInvite(id, me.userId);
  }
}
