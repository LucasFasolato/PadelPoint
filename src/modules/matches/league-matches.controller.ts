import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchesService } from './matches.service';
import { ReportFromReservationDto } from './dto/report-from-reservation.dto';
import { ReportManualDto } from './dto/report-manual.dto';
import { CreateLeagueMatchDto } from './dto/create-league-match.dto';
import {
  SubmitLeagueMatchResultCanonicalBodyDto,
  SubmitLeagueMatchResultDto,
} from './dto/submit-league-match-result.dto';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { PendingConfirmationsResponseDto } from './dto/pending-confirmation.dto';
import { PendingConfirmationsQueryDto } from './dto/pending-confirmations-query.dto';

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

  @Get(':leagueId/pending-confirmations')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: PendingConfirmationsResponseDto })
  getLeaguePendingConfirmations(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Query() query: PendingConfirmationsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.getLeaguePendingConfirmations(user.userId, leagueId, {
      cursor: query.cursor,
      limit: query.limit,
    });
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
  @ApiBody({
    type: SubmitLeagueMatchResultCanonicalBodyDto,
    description:
      'Canonical contract: { playedAt, score: { sets } }. Runtime also tolerates legacy { playedAt, sets } for backward compatibility.',
  })
  submitLeagueMatchResult(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('matchId', new ParseRequiredUuidPipe('matchId')) matchId: string,
    @Body() dto: SubmitLeagueMatchResultDto,
  ) {
    const user = req.user as AuthUser;
    const normalizedDto = this.normalizeSubmitLeagueMatchResultDto(dto);
    return this.matchesService.submitLeagueMatchResult(
      user.userId,
      leagueId,
      matchId,
      normalizedDto,
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

  private normalizeSubmitLeagueMatchResultDto(
    dto: SubmitLeagueMatchResultDto,
  ): SubmitLeagueMatchResultDto {
    const nestedSets = dto.score?.sets;
    const topLevelSets = dto.sets;

    if (nestedSets?.length && topLevelSets?.length) {
      const samePayload =
        JSON.stringify(nestedSets) === JSON.stringify(topLevelSets);
      if (!samePayload) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_RESULT_PAYLOAD_INVALID',
          message:
            'Provide either score.sets or sets, but not conflicting values for both',
        });
      }
    }

    if (nestedSets?.length) {
      return { playedAt: dto.playedAt, score: dto.score };
    }

    if (topLevelSets?.length) {
      return {
        playedAt: dto.playedAt,
        score: { sets: topLevelSets },
      };
    }

    throw new BadRequestException({
      statusCode: 400,
      code: 'MATCH_RESULT_PAYLOAD_INVALID',
      message: 'Provide match result sets in score.sets or sets',
    });
  }
}
