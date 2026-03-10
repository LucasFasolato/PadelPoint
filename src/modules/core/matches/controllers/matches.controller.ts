import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { MatchesService } from '../services/matches.service';
import { ReportMatchDto, RejectMatchDto } from '../dto/report-match.dto';
import { DisputeMatchDto } from '../dto/dispute-match.dto';
import { ResolveDisputeDto } from '../dto/resolve-dispute.dto';
import { UserRole } from '../../users/enums/user-role.enum';
import { MyPendingConfirmationsResponseDto } from '../dto/my-pending-confirmation.dto';
import { PendingConfirmationsQueryDto } from '../dto/pending-confirmations-query.dto';
import { ensureRequestContext } from '@/common/observability/request-context.util';
import { MatchRankingImpactResponseDto } from '../dto/match-ranking-impact-response.dto';
import { MatchesV2BridgeService } from '../services/matches-v2-bridge.service';

type AuthUser = { userId: string; email: string; role: string };

@Controller('matches')
@UseGuards(JwtAuthGuard, CityRequiredGuard)
export class MatchesController {
  constructor(
    private readonly service: MatchesService,
    private readonly matchesV2BridgeService: MatchesV2BridgeService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary:
      'List current user matches. Canonical contract returns { items, nextCursor }.',
  })
  @ApiQuery({
    name: 'legacy',
    required: false,
    type: String,
    description:
      'Compatibility flag. Use legacy=1 to return a plain array instead of the canonical wrapper.',
    example: '1',
  })
  @ApiOkResponse({
    description:
      'Canonical wrapper by default. Legacy clients can request a plain array with legacy=1.',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
            nextCursor: {
              type: 'string',
              nullable: true,
            },
          },
        },
        {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      ],
    },
  })
  async getMyMatches(@Req() req: Request, @Query('legacy') legacy?: string) {
    const user = req.user as AuthUser;
    if (legacy === '1' || legacy?.toLowerCase() === 'true') {
      return this.service.getMyMatches(user.userId);
    }
    return this.matchesV2BridgeService.listMyMatches(user.userId);
  }

  @Get('me/pending-confirmations')
  @ApiQuery({
    name: 'legacy',
    required: false,
    type: String,
    description:
      'Compatibility flag. Use legacy=1 to force the legacy pending confirmations query path.',
    example: '1',
  })
  @ApiOkResponse({ type: MyPendingConfirmationsResponseDto })
  async getPendingConfirmations(
    @Req() req: Request,
    @Query() query: PendingConfirmationsQueryDto,
    @Query('legacy') legacy?: string,
  ) {
    const user = req.user as AuthUser;
    const { requestId } = ensureRequestContext(req, req.res);
    if (legacy === '1' || legacy?.toLowerCase() === 'true') {
      return this.service.getPendingConfirmations(user.userId, {
        cursor: query.cursor,
        limit: query.limit,
        requestId,
      });
    }
    return this.matchesV2BridgeService.listPendingConfirmations(user.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post()
  report(@Req() req: Request, @Body() dto: ReportMatchDto) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.reportResult(user.userId, dto);
  }

  @Patch(':id/confirm')
  confirm(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.confirmResult(user.userId, id);
  }

  @Patch(':id/admin-confirm')
  adminConfirm(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.adminConfirmMatch(user.userId, id);
  }

  @Patch(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RejectMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.rejectResult(
      user.userId,
      id,
      dto.reason,
    );
  }

  @Post(':id/dispute')
  dispute(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DisputeMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.openDispute(user.userId, id, dto);
  }

  @Post(':id/resolve')
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    const user = req.user as AuthUser;
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'RESOLVE_FORBIDDEN',
        message: 'Only admins can resolve disputes',
      });
    }
    return this.matchesV2BridgeService.resolveDispute(user.userId, id, dto);
  }

  @Post(':id/resolve-confirm-as-is')
  resolveConfirmAsIs(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.resolveConfirmAsIs(user.userId, id);
  }

  @Get(':id/ranking-impact')
  @ApiOperation({
    summary: 'Get ranking impact for the authenticated player',
    description:
      'Returns the competitive impact of a confirmed match from the authenticated participant perspective. ' +
      'Position fields are only populated when exact snapshot context exists; otherwise they are null.',
  })
  @ApiOkResponse({ type: MatchRankingImpactResponseDto })
  getRankingImpact(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('id')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.service.getRankingImpact(id, user.userId);
  }

  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.getById(id, user.userId);
  }

  @Get()
  getByChallenge(@Query('challengeId') challengeId?: string) {
    if (!challengeId) return [];
    return this.service.getByChallenge(challengeId);
  }
}
