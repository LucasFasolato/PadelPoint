import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchesService } from './matches.service';
import { ReportFromReservationDto } from './dto/report-from-reservation.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('leagues')
@UseGuards(JwtAuthGuard)
export class LeagueMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post(':leagueId/report-from-reservation')
  reportFromReservation(
    @Req() req: Request,
    @Param('leagueId') leagueId: string,
    @Body() dto: ReportFromReservationDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.reportFromReservation(user.userId, leagueId, dto);
  }
}
