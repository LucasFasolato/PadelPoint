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
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '../../common/pipes/parse-required-uuid.pipe';
import { LeaguesService } from './leagues.service';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { CreateLeagueDto } from './dto/create-league.dto';
import { CreateMiniLeagueDto } from './dto/create-mini-league.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateLeagueProfileDto } from './dto/update-league-profile.dto';
import { SetLeagueAvatarDto } from './dto/set-league-avatar.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { LeagueActivityQueryDto } from './dto/league-activity-query.dto';
import { LeagueStandingsHistoryQueryDto } from './dto/league-standings-history-query.dto';
import { StandingsWithMovementDto } from './dto/standings-row.dto';
import { ActivityListResponseDto } from './dto/activity-view.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
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
  list(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.leaguesService.listMyLeagues(user.userId);
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

  @Get(':id/settings')
  getSettings(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.getLeagueSettings(user.userId, id);
  }

  @Patch(':id/settings')
  updateSettings(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Body() dto: UpdateLeagueSettingsDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateLeagueSettings(user.userId, id, dto);
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
  @ApiForbiddenResponse({ description: 'Caller is not owner/admin of the league' })
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
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.standingsService.getStandingsWithMovement(id);
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
