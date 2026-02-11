import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LeaguesService } from './leagues.service';
import { LeagueStandingsService } from './league-standings.service';
import { CreateLeagueDto } from './dto/create-league.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
export class LeaguesController {
  constructor(
    private readonly leaguesService: LeaguesService,
    private readonly standingsService: LeagueStandingsService,
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

  @Post('invites/:token/accept')
  acceptInvite(@Req() req: Request, @Param('token') token: string) {
    const user = req.user as AuthUser;
    return this.leaguesService.acceptInvite(user.userId, token);
  }

  @Post('invites/:token/decline')
  declineInvite(@Req() req: Request, @Param('token') token: string) {
    const user = req.user as AuthUser;
    return this.leaguesService.declineInvite(user.userId, token);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  detail(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.leaguesService.getLeagueDetail(user.userId, id);
  }

  @Get(':id/settings')
  getSettings(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.leaguesService.getLeagueSettings(user.userId, id);
  }

  @Patch(':id/settings')
  updateSettings(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateLeagueSettingsDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateLeagueSettings(user.userId, id, dto);
  }

  @Patch(':id/members/:memberId/role')
  updateMemberRole(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.updateMemberRole(
      user.userId,
      id,
      memberId,
      dto,
    );
  }

  @Post(':id/invites')
  invite(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateInvitesDto,
  ) {
    const user = req.user as AuthUser;
    return this.leaguesService.createInvites(user.userId, id, dto);
  }

  @Post(':id/recompute')
  async recompute(@Req() req: Request, @Param('id') id: string) {
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
