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
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ChallengesService } from '../services/challenges.service';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { ChallengesV2CoordinationBridgeService } from '../services/challenges-v2-coordination-bridge.service';

import { CreateDirectChallengeDto } from '../dto/create-direct-challenge.dto';
import { CreateOpenChallengeDto } from '../dto/create-open-challenge.dto';
import { ListOpenQueryDto } from '../dto/list-open-query.dto';
import { CreateChallengeProposalDto } from '../dto/create-challenge-proposal.dto';
import { CreateChallengeMessageDto } from '../dto/create-challenge-message.dto';
import {
  ChallengeCoordinationResponseDto,
  ChallengeMessageResponseDto,
} from '../dto/challenge-coordination-response.dto';

type AuthUser = {
  userId: string;
  email: string;
  role: string;
  cityId?: string | null;
};

@UseGuards(JwtAuthGuard, CityRequiredGuard)
@Controller('challenges')
export class ChallengesController {
  constructor(
    private readonly service: ChallengesService,
    private readonly coordinationBridge: ChallengesV2CoordinationBridgeService,
  ) {}

  @Post('direct')
  createDirect(@Req() req: Request, @Body() dto: CreateDirectChallengeDto) {
    const me = req.user as AuthUser;
    return this.service.createDirect({
      meUserId: me.userId,
      opponentUserId: dto.opponentUserId,
      partnerUserId: dto.partnerUserId ?? null,
      reservationId: dto.reservationId ?? null,
      message: dto.message ?? null,
      matchType: dto.matchType,
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
      matchType: dto.matchType,
    });
  }

  @Get('open')
  listOpen(@Req() req: Request, @Query() q: ListOpenQueryDto) {
    const me = req.user as AuthUser;
    const limit = q.limit ? Number(q.limit) : 50;
    return this.service.listOpen({
      category: q.category,
      limit: Number.isFinite(limit) ? limit : 50,
      cityId: me.cityId,
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

  @Get(':id/coordination')
  @ApiOperation({
    summary: 'Get challenge coordination state',
    description:
      'Hybrid endpoint. Delegates to matches-v2 when the challenge has an exact canonical correlation; otherwise falls back to legacy challenge coordination.',
  })
  @ApiOkResponse({ type: ChallengeCoordinationResponseDto })
  getCoordination(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.getCoordinationState(id, me.userId);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'List challenge coordination messages',
    description:
      'Hybrid endpoint. Reads canonical match messages only when the legacy challenge correlation is exact; otherwise reads legacy challenge messages.',
  })
  @ApiOkResponse({ type: ChallengeMessageResponseDto, isArray: true })
  getMessages(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.listMessages(id, me.userId);
  }

  @Post(':id/proposals')
  @ApiOperation({
    summary: 'Create a challenge schedule proposal',
    description:
      'Hybrid endpoint. Uses canonical scheduling only when the correlated matches-v2 aggregate is safe to mutate.',
  })
  @ApiCreatedResponse({ type: ChallengeCoordinationResponseDto })
  createProposal(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateChallengeProposalDto,
  ) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.createProposal(id, me.userId, dto);
  }

  @Post(':id/proposals/:proposalId/accept')
  @ApiOperation({
    summary: 'Accept a challenge schedule proposal',
    description:
      'Hybrid endpoint. Falls back to legacy when the public proposal id cannot be resolved canonically.',
  })
  @ApiCreatedResponse({ type: ChallengeCoordinationResponseDto })
  acceptProposal(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.acceptProposal(id, proposalId, me.userId);
  }

  @Post(':id/proposals/:proposalId/reject')
  @ApiOperation({
    summary: 'Reject a challenge schedule proposal',
    description:
      'Hybrid endpoint. Falls back to legacy when the public proposal id cannot be resolved canonically.',
  })
  @ApiCreatedResponse({ type: ChallengeCoordinationResponseDto })
  rejectProposal(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.rejectProposal(id, proposalId, me.userId);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Create a challenge coordination message',
    description:
      'Hybrid endpoint. Uses canonical match messaging only when the correlated matches-v2 aggregate is safe to mutate.',
  })
  @ApiCreatedResponse({ type: ChallengeMessageResponseDto })
  createMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateChallengeMessageDto,
  ) {
    const me = req.user as AuthUser;
    return this.coordinationBridge.createMessage(id, me.userId, dto);
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

  @Patch(':id/cancel-open')
  cancelOpen(@Req() req: Request, @Param('id') id: string) {
    const me = req.user as AuthUser;
    return this.service.cancelOpen(id, me.userId);
  }
}
