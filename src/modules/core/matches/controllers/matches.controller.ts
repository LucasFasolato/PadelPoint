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
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Report a match result through the public compatibility edge',
    description:
      'Hybrid endpoint. Delegates to matches-v2 only when legacy correlation preserves the observable public ids; otherwise falls back to MatchesService.',
  })
  @ApiCreatedResponse({
    description:
      'Legacy-shaped match result response. Public contract remains compatibility-first even when the write delegates canonically.',
    schema: {
      type: 'object',
      additionalProperties: true,
    },
  })
  report(@Req() req: Request, @Body() dto: ReportMatchDto) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.reportResult(user.userId, dto);
  }

  @Patch(':id/confirm')
  @ApiOperation({
    summary: 'Confirm a reported match result',
    description:
      'Hybrid endpoint. Delegates to matches-v2 only when the legacy match-result id resolves safely to the canonical aggregate.',
  })
  @ApiOkResponse({
    description: 'Legacy-shaped match result response.',
    schema: {
      type: 'object',
      additionalProperties: true,
    },
  })
  confirm(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.confirmResult(user.userId, id);
  }

  @Patch(':id/admin-confirm')
  adminConfirm(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    // League-admin override semantics still depend on legacy RBAC/audit rules.
    return this.service.adminConfirmMatch(user.userId, id);
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Reject a reported match result',
    description:
      'Hybrid endpoint. Delegates to matches-v2 only when the legacy match-result id resolves safely; otherwise falls back to MatchesService.',
  })
  @ApiOkResponse({
    description: 'Legacy-shaped match result response.',
    schema: {
      type: 'object',
      additionalProperties: true,
    },
  })
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
  @ApiOperation({
    summary: 'Open a dispute for a match result',
    description:
      'Legacy-owned public contract. The bridge entrypoint exists, but current runtime behavior always falls back to MatchesService because canonical dispute semantics do not match the legacy confirmed-only, windowed contract.',
  })
  @ApiCreatedResponse({
    description: 'Legacy dispute-open response shape.',
    schema: {
      type: 'object',
      properties: {
        dispute: {
          type: 'object',
          nullable: true,
          additionalProperties: true,
        },
        matchStatus: {
          type: 'string',
        },
      },
    },
  })
  dispute(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DisputeMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesV2BridgeService.openDispute(user.userId, id, dto);
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Resolve a disputed match result',
    description:
      'Admin-only hybrid endpoint. Delegates to matches-v2 only for a narrow safe subset; all other cases remain on MatchesService.',
  })
  @ApiForbiddenResponse({
    description: 'Only admins can resolve disputes on the public edge.',
  })
  @ApiCreatedResponse({
    description: 'Legacy-compatible dispute-resolution response shape.',
    schema: {
      type: 'object',
      properties: {
        dispute: {
          type: 'object',
          nullable: true,
          additionalProperties: true,
        },
        matchStatus: {
          type: 'string',
        },
        resolution: {
          type: 'string',
        },
      },
    },
  })
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
    // This flow remains legacy until matches-v2 models the league-admin path.
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
  @ApiOperation({
    summary: 'Get match detail by legacy public id',
    description:
      'Legacy read endpoint over match_results. This route does not expose the canonical matches-v2 aggregate directly.',
  })
  @ApiOkResponse({
    description:
      'Legacy match-result detail response enriched with normalized matchType, impactRanking, and computed action flags.',
    schema: {
      type: 'object',
      additionalProperties: true,
    },
  })
  getById(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.getById(id, user.userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Compatibility lookup by challenge id',
    description:
      'Legacy lookup endpoint. Returns an empty array when challengeId is omitted, and otherwise returns the legacy match-result detail for that challenge.',
  })
  @ApiQuery({
    name: 'challengeId',
    required: false,
    type: String,
    description:
      'Legacy challenge identifier. When omitted, the controller returns [] for compatibility.',
  })
  @ApiOkResponse({
    description:
      'Compatibility response: [] when challengeId is missing, otherwise a legacy match-result detail object.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        {
          type: 'object',
          additionalProperties: true,
        },
      ],
    },
  })
  getByChallenge(@Query('challengeId') challengeId?: string) {
    if (!challengeId) return [];
    return this.service.getByChallenge(challengeId);
  }
}
