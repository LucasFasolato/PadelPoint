import {
  Body,
  Controller,
  Get,
  Header,
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

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
export class LeagueMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':leagueId/eligible-reservations')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getEligibleReservations(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.getEligibleReservations(user.userId, leagueId);
  }

  @Post(':leagueId/report-from-reservation')
  reportFromReservation(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
    @Body() dto: ReportFromReservationDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.reportFromReservation(user.userId, leagueId, dto);
  }

  @Post(':leagueId/report-manual')
  reportManual(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
    @Body() dto: ReportManualDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.reportManual(user.userId, leagueId, dto);
  }
}
