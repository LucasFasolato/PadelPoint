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
import { ChallengesService } from './challenges.service';

import { CreateDirectChallengeDto } from './dto/create-direct-challenge.dto';
import { CreateOpenChallengeDto } from './dto/create-open-challenge.dto';
import { ListOpenQueryDto } from './dto/list-open-query.dto';

type AuthUser = { userId: string; email: string; role: string };

@UseGuards(JwtAuthGuard)
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly service: ChallengesService) {}

  @Post('direct')
  createDirect(@Req() req: Request, @Body() dto: CreateDirectChallengeDto) {
    const me = req.user as AuthUser;
    return this.service.createDirect({
      meUserId: me.userId,
      opponentUserId: dto.opponentUserId,
      partnerUserId: dto.partnerUserId ?? null,
      reservationId: dto.reservationId ?? null,
      message: dto.message ?? null,
    });
  }

  @Post('open')
  createOpen(@Req() req: Request, @Body() dto: CreateOpenChallengeDto) {
    const me = req.user as AuthUser;
    return this.service.createOpen({
      meUserId: me.userId,
      partnerUserId: dto.partnerUserId ?? null,
      targetCategory: dto.targetCategory,
      reservationId: dto.reservationId ?? null,
      message: dto.message ?? null,
    });
  }

  @Get('open')
  listOpen(@Query() q: ListOpenQueryDto) {
    const limit = q.limit ? Number(q.limit) : 50;
    return this.service.listOpen({
      category: q.category,
      limit: Number.isFinite(limit) ? limit : 50,
    });
  }

  @Get('inbox')
  inbox(@Req() req: Request) {
    const me = req.user as AuthUser;
    return this.service.inbox(me.userId);
  }

  @Get('outbox')
  outbox(@Req() req: Request) {
    const me = req.user as AuthUser;
    return this.service.outbox(me.userId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  // DIRECT: accept/reject by invited opponent
  @Patch(':id/accept')
  acceptDirect(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.acceptDirect(id, me.userId);
  }

  @Patch(':id/reject')
  rejectDirect(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.rejectDirect(id, me.userId);
  }

  @Patch(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.cancel(id, me.userId);
  }

  // OPEN: accept by any eligible user
  @Patch(':id/accept-open')
  acceptOpen(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.acceptOpen(id, me.userId);
  }
}
