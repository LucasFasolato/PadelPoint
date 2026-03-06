import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { ensureRequestContext } from '@/common/observability/request-context.util';
import { LeaguesService } from '../services/leagues.service';
import { LeagueStandingsService } from '../services/league-standings.service';
import { LeagueActivityService } from '../services/league-activity.service';
import { CreateLeagueDto } from '../dto/create-league.dto';
import { CreateMiniLeagueDto } from '../dto/create-mini-league.dto';
import { CreateInvitesDto } from '../dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from '../dto/update-league-settings.dto';
import { UpdateLeagueProfileDto } from '../dto/update-league-profile.dto';
import { SetLeagueAvatarDto } from '../dto/set-league-avatar.dto';
import { UpdateMemberRoleDto } from '../dto/update-member-role.dto';
import { LeagueActivityQueryDto } from '../dto/league-activity-query.dto';
import { LeagueStandingsHistoryQueryDto } from '../dto/league-standings-history-query.dto';
import { StandingsWithMovementDto } from '../dto/standings-row.dto';
import { ActivityListResponseDto } from '../dto/activity-view.dto';
import { ListLeaguesResponseDto } from '../dto/list-leagues.dto';
import { DiscoverLeaguesQueryDto } from '../dto/discover-leagues-query.dto';
import { DiscoverLeaguesResponseDto } from '../dto/discover-leagues.dto';
import { CreateLeagueJoinRequestDto } from '../dto/create-league-join-request.dto';
import { ListLeagueJoinRequestsQueryDto } from '../dto/list-league-join-requests-query.dto';
import {
  LeagueJoinRequestApproveResponseDto,
  LeagueJoinRequestItemDto,
  LeagueJoinRequestListResponseDto,
} from '../dto/league-join-request.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
@ApiTags('leagues')
@ApiBearerAuth()
export class LeaguesController {
  constructor(
    private readonly leaguesService: LeaguesService,
    private readonly standingsService: LeagueStandingsService,
    private readonly activityService: LeagueActivityService,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateLeagueDto) {
    const user = req.user as AuthUser;
    return this.leaguesService.createLeague(user.userId, dto);
  }

  @Post('mini')
  createMini(@Req() req: Request, @Body() dto: CreateMiniLeagueDto) {
    const user = req.user as AuthUser;
    return this.leaguesService.createMiniLeague(user.userId, dto);
  }

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: ListLeaguesResponseDto })
  list(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.leaguesService.listMyLeagues(user.userId);
  }

  @Get('discover')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: DiscoverLeaguesResponseDto })
  discover(@Req() req: Request, @Query() query: DiscoverLeaguesQueryDto) {
    const user = req.user as AuthUser;
    return this.leaguesService.discoverLeagues(user.userId, query);
  }

  // Invite routes BEFORE :id to avoid NestJS matching "invites" as :id
  @Get('invites/:token')
  getInvite(@Param('token') token: string) {
    return this.leaguesService.getInviteByToken(token);
  }

  @Post('invites/:inviteId/accept')
  @HttpCode(200)
  acceptInvite(
    @Req() req: Request,
    @Param('inviteId', new ParseRequiredUuidPipe('inviteId')) inviteId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.acceptInvite(user.userId, inviteId);
  }

  @Post('invites/:inviteId/decline')
  @HttpCode(200)
  declineInvite(
    @Req() req: Request,
    @Param('inviteId', new ParseRequiredUuidPipe('inviteId')) inviteId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.declineInvite(user.userId, inviteId);
  }

  @Post(':id/join-requests')
  @ApiOkResponse({ type: LeagueJoinRequestItemDto })
  createJoinRequest(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Body() dto: CreateLeagueJoinRequestDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.createJoinRequest(user.userId, id, dto);
  }

  @Get(':id/join-requests')
  @ApiOkResponse({ type: LeagueJoinRequestListResponseDto })
  listJoinRequests(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query() query: ListLeagueJoinRequestsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.listJoinRequests(user.userId, id, query.status);
  }

  @Post(':id/join-requests/:requestId/approve')
  @ApiOkResponse({ type: LeagueJoinRequestApproveResponseDto })
  approveJoinRequest(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Param('requestId', new ParseRequiredUuidPipe('requestId'))
    requestId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.approveJoinRequest(user.userId, id, requestId);
  }

  @Post(':id/join-requests/:requestId/reject')
  @ApiOkResponse({ type: LeagueJoinRequestItemDto })
  rejectJoinRequest(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Param('requestId', new ParseRequiredUuidPipe('requestId'))
    requestId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.rejectJoinRequest(user.userId, id, requestId);
  }

  @Delete(':id/join-requests/:requestId')
  @ApiOkResponse({ type: LeagueJoinRequestItemDto })
  cancelJoinRequest(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Param('requestId', new ParseRequiredUuidPipe('requestId'))
    requestId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.cancelJoinRequest(user.userId, id, requestId);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  detail(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.getLeagueDetail(user.userId, id);
  }

  @Get(':leagueId/settings')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        winPoints: { type: 'integer', minimum: 0, maximum: 10, example: 3 },
        drawPoints: { type: 'integer', minimum: 0, maximum: 10, example: 1 },
        lossPoints: { type: 'integer', minimum: 0, maximum: 10, example: 0 },
        tieBreakers: {
          type: 'array',
          items: { type: 'string' },
          example: ['points', 'wins', 'setsDiff', 'gamesDiff'],
        },
        includeSources: {
          type: 'array',
          items: { type: 'string', enum: ['manual', 'reservation'] },
          example: ['manual', 'reservation'],
        },
      },
      required: [
        'winPoints',
        'drawPoints',
        'lossPoints',
        'tieBreakers',
        'includeSources',
      ],
    },
  })
  getSettings(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId'))
    leagueId: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.getLeagueSettings(user.userId, leagueId);
  }

  @Patch(':leagueId/settings')
  @ApiBody({
    required: false,
    description:
      'Partial update. Send an empty object {} to restore default league settings.',
    schema: {
      type: 'object',
      properties: {
        winPoints: { type: 'integer', minimum: 0, maximum: 10 },
        drawPoints: { type: 'integer', minimum: 0, maximum: 10 },
        lossPoints: { type: 'integer', minimum: 0, maximum: 10 },
        tieBreakers: {
          type: 'array',
          items: { type: 'string', enum: ['points', 'wins', 'setsDiff', 'gamesDiff'] },
        },
        includeSources: {
          type: 'array',
          items: { type: 'string', enum: ['manual', 'reservation'] },
        },
      },
      additionalProperties: false,
    },
    examples: {
      partialUpdate: {
        summary: 'Update parcial',
        value: {
          drawPoints: 2,
          tieBreakers: ['points', 'setsDiff', 'gamesDiff'],
          includeSources: ['manual'],
        },
      },
      resetDefaults: {
        summary: 'Reset a defaults',
        value: {},
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          properties: {
            winPoints: {
              type: 'integer',
              minimum: 0,
              maximum: 10,
              example: 3,
            },
            drawPoints: {
              type: 'integer',
              minimum: 0,
              maximum: 10,
              example: 1,
            },
            lossPoints: {
              type: 'integer',
              minimum: 0,
              maximum: 10,
              example: 0,
            },
            tieBreakers: {
              type: 'array',
              items: { type: 'string' },
              example: ['points', 'wins', 'setsDiff', 'gamesDiff'],
            },
            includeSources: {
              type: 'array',
              items: { type: 'string', enum: ['manual', 'reservation'] },
              example: ['manual', 'reservation'],
            },
          },
          required: [
            'winPoints',
            'drawPoints',
            'lossPoints',
            'tieBreakers',
            'includeSources',
          ],
        },
        recomputeTriggered: { type: 'boolean', example: true },
      },
      required: ['settings', 'recomputeTriggered'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Settings validation failed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        code: { type: 'string', example: 'SETTINGS_INVALID_POINTS_ORDER' },
        message: {
          type: 'string',
          example:
            'Invalid points order: winPoints must be >= drawPoints >= lossPoints',
        },
      },
      required: ['statusCode', 'code', 'message'],
    },
  })
  @ApiForbiddenResponse({ description: 'Only owner/admin can update settings' })
  @ApiNotFoundResponse({ description: 'League not found' })
  updateSettings(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId'))
    leagueId: string,
    @Body() dto: UpdateLeagueSettingsDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateLeagueSettings(user.userId, leagueId, dto);
  }

  @Patch(':id')
  updateProfile(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Body() dto: UpdateLeagueProfileDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateLeagueProfile(user.userId, id, dto);
  }

  @Patch(':id/avatar')
  updateAvatar(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Body() dto: SetLeagueAvatarDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.setLeagueAvatar(user.userId, id, dto);
  }

  @Get(':id/share')
  @ApiOkResponse({
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', example: false },
          },
          required: ['enabled'],
        },
        {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', example: true },
            shareUrl: {
              type: 'string',
              example:
                '/public/leagues/123e4567-e89b-12d3-a456-426614174000/standings?token=abc',
            },
            shareText: {
              type: 'string',
              example:
                'Sumate a mi liga en PadelPoint: /public/leagues/123e4567-e89b-12d3-a456-426614174000/standings?token=abc',
            },
          },
          required: ['enabled', 'shareUrl', 'shareText'],
        },
      ],
    },
  })
  getShare(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.getShareStatus(user.userId, id);
  }

  @Post(':id/share/enable')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        shareToken: { type: 'string' },
        shareUrlPath: { type: 'string' },
        shareUrl: { type: 'string' },
        shareText: { type: 'string' },
      },
      required: ['shareToken', 'shareUrlPath', 'shareUrl', 'shareText'],
    },
  })
  enableShare(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.enableShare(user.userId, id);
  }

  @Post(':id/share/disable')
  disableShare(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.disableShare(user.userId, id);
  }

  @Delete(':id')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
        deletedLeagueId: { type: 'string', format: 'uuid' },
      },
      required: ['ok', 'deletedLeagueId'],
    },
  })
  @ApiConflictResponse({
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 409 },
        code: {
          type: 'string',
          example: 'LEAGUE_DELETE_HAS_MATCHES',
        },
        message: { type: 'string' },
        reason: { type: 'string', example: 'HAS_MATCHES' },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Caller is not owner/admin of the league',
  })
  @ApiNotFoundResponse({ description: 'League not found' })
  deleteLeague(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.deleteLeague(user.userId, id);
  }

  @Patch(':id/members/:memberId/role')
  updateMemberRole(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Param('memberId', new ParseRequiredUuidPipe('memberId')) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateMemberRole(user.userId, id, memberId, dto);
  }

  @Get(':id/activity')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: ActivityListResponseDto })
  async getActivity(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query() query: LeagueActivityQueryDto,
  ) {
    const user = req.user as AuthUser;
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.activityService.list(id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id/standings')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: StandingsWithMovementDto })
  async getStandings(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    const { requestId } = ensureRequestContext(req, req.res);
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.standingsService.getStandingsWithMovement(id, { requestId });
  }

  @Get(':id/standings/latest')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  async getLatestStandings(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.standingsService.getLatestStandings(id);
  }

  @Get(':id/standings/history')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  async getStandingsHistory(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query() query: LeagueStandingsHistoryQueryDto,
  ) {
    const user = req.user as AuthUser;
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.standingsService.getStandingsHistory(id, query.limit);
  }

  @Get(':id/standings/history/:version')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  async getStandingsHistoryVersion(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const user = req.user as AuthUser;
    await this.leaguesService.getLeagueDetail(user.userId, id);
    const snapshot = await this.standingsService.getStandingsSnapshotByVersion(
      id,
      version,
    );
    if (!snapshot) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'STANDINGS_SNAPSHOT_NOT_FOUND',
        message: 'Standings snapshot not found',
      });
    }
    return snapshot;
  }

  @Post(':id/invites')
  invite(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Body() dto: CreateInvitesDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.createInvites(user.userId, id, dto);
  }

  @Post(':id/recompute')
  async recompute(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    // Verify membership first
    await this.leaguesService.getLeagueDetail(user.userId, id);
    // Recompute within a transaction
    const members = await this.standingsService.recomputeLeague(
      this.leaguesService['dataSource'].manager,
      id,
    );
    return { updated: members.length };
  }
}
