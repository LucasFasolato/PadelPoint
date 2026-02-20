import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchesService } from './matches.service';
import { ReportFromReservationDto } from './dto/report-from-reservation.dto';
import { ReportManualDto } from './dto/report-manual.dto';
import { CreateLeagueMatchDto } from './dto/create-league-match.dto';
import { SubmitLeagueMatchResultDto } from './dto/submit-league-match-result.dto';
import { ParseRequiredUuidPipe } from '../../common/pipes/parse-required-uuid.pipe';

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
export class LeagueMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':leagueId/matches')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  listLeagueMatches(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.listLeagueMatches(user.userId, leagueId);
  }

  @Post(':leagueId/matches')
  createLeagueMatch(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Body() dto: CreateLeagueMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.createLeagueMatch(user.userId, leagueId, dto);
  }

  @Patch(':leagueId/matches/:matchId/result')
  submitLeagueMatchResult(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('matchId', new ParseRequiredUuidPipe('matchId')) matchId: string,
    @Body() dto: SubmitLeagueMatchResultDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.submitLeagueMatchResult(
      user.userId,
      leagueId,
      matchId,
      dto,
    );
  }

  @Get(':leagueId/eligible-reservations')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getEligibleReservations(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.getEligibleReservations(user.userId, leagueId);
  }

  @Post(':leagueId/report-from-reservation')
  reportFromReservation(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Body() dto: ReportFromReservationDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.reportFromReservation(
      user.userId,
      leagueId,
      dto,
    );
  }

  @Post(':leagueId/report-manual')
  reportManual(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Body() dto: ReportManualDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.reportManual(user.userId, leagueId, dto);
  }
}
