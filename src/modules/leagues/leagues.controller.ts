import {
  Body,
  Controller,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '../../common/pipes/parse-required-uuid.pipe';
import { LeaguesService } from './leagues.service';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { CreateLeagueDto } from './dto/create-league.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { LeagueActivityQueryDto } from './dto/league-activity-query.dto';
import { LeagueStandingsHistoryQueryDto } from './dto/league-standings-history-query.dto';

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
  async getStandings(
    @Req() req: Request,
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
  ) {
    const user = req.user as AuthUser;
    await this.leaguesService.getLeagueDetail(user.userId, id);
    return this.standingsService.getStandingsWithMovement(id);
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
