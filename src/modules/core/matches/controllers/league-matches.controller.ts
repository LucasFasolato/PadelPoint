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
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MatchesService } from '../services/matches.service';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { ReportFromReservationDto } from '../dto/report-from-reservation.dto';
import { ReportManualDto } from '../dto/report-manual.dto';
import { CreateLeagueMatchDto } from '../dto/create-league-match.dto';
import {
  SubmitLeagueMatchResultCanonicalBodyDto,
  SubmitLeagueMatchResultDto,
} from '../dto/submit-league-match-result.dto';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PendingConfirmationsQueryDto } from '../dto/pending-confirmations-query.dto';
import {
  ConfirmLeaguePendingConfirmationResponseDto,
  LeaguePendingConfirmationsResponseDto,
  RejectLeaguePendingConfirmationDto,
  RejectLeaguePendingConfirmationResponseDto,
} from '../dto/league-pending-confirmations.dto';
import { LeagueMatchResponseDto } from '../dto/league-match-response.dto';

type AuthUser = { userId: string; email: string; role: string };

@ApiTags('league-matches')
@ApiBearerAuth()
@Controller('leagues')
@UseGuards(JwtAuthGuard, CityRequiredGuard)
export class LeagueMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':leagueId/matches')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ type: LeagueMatchResponseDto, isArray: true })
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
  @ApiOkResponse({ type: LeaguePendingConfirmationsResponseDto })
  getLeaguePendingConfirmations(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Query() query: PendingConfirmationsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.getLeaguePendingConfirmations(
      user.userId,
      leagueId,
      {
        cursor: query.cursor,
        limit: query.limit,
      },
    );
  }

  @Post(':leagueId/pending-confirmations/:confirmationId/confirm')
  @ApiOperation({
    summary: 'Confirm league pending confirmation (canonical)',
  })
  @ApiOkResponse({ type: ConfirmLeaguePendingConfirmationResponseDto })
  @ApiConflictResponse({
    description: 'Pending confirmation is not in a confirmable state',
  })
  confirmLeaguePendingConfirmation(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('confirmationId', new ParseRequiredUuidPipe('confirmationId'))
    confirmationId: string,
  ) {
    return this.confirmLeaguePendingConfirmationAction(
      req,
      leagueId,
      confirmationId,
    );
  }

  @Patch(':leagueId/pending-confirmations/:confirmationId/confirm')
  @ApiOperation({
    summary: 'Confirm league pending confirmation (compat PATCH alias)',
    deprecated: true,
  })
  @ApiOkResponse({ type: ConfirmLeaguePendingConfirmationResponseDto })
  @ApiConflictResponse({
    description: 'Pending confirmation is not in a confirmable state',
  })
  confirmLeaguePendingConfirmationPatch(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('confirmationId', new ParseRequiredUuidPipe('confirmationId'))
    confirmationId: string,
  ) {
    return this.confirmLeaguePendingConfirmationAction(
      req,
      leagueId,
      confirmationId,
    );
  }

  @Post(':leagueId/pending-confirmations/:confirmationId/reject')
  @ApiOperation({
    summary: 'Reject league pending confirmation (canonical)',
  })
  @ApiOkResponse({ type: RejectLeaguePendingConfirmationResponseDto })
  @ApiConflictResponse({
    description: 'Pending confirmation is not in a rejectable state',
  })
  rejectLeaguePendingConfirmation(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('confirmationId', new ParseRequiredUuidPipe('confirmationId'))
    confirmationId: string,
    @Body() dto: RejectLeaguePendingConfirmationDto,
  ) {
    return this.rejectLeaguePendingConfirmationAction(
      req,
      leagueId,
      confirmationId,
      dto,
    );
  }

  @Patch(':leagueId/pending-confirmations/:confirmationId/reject')
  @ApiOperation({
    summary: 'Reject league pending confirmation (compat PATCH alias)',
    deprecated: true,
  })
  @ApiOkResponse({ type: RejectLeaguePendingConfirmationResponseDto })
  @ApiConflictResponse({
    description: 'Pending confirmation is not in a rejectable state',
  })
  rejectLeaguePendingConfirmationPatch(
    @Req() req: Request,
    @Param('leagueId', new ParseRequiredUuidPipe('leagueId')) leagueId: string,
    @Param('confirmationId', new ParseRequiredUuidPipe('confirmationId'))
    confirmationId: string,
    @Body() dto: RejectLeaguePendingConfirmationDto,
  ) {
    return this.rejectLeaguePendingConfirmationAction(
      req,
      leagueId,
      confirmationId,
      dto,
    );
  }

  private confirmLeaguePendingConfirmationAction(
    req: Request,
    leagueId: string,
    confirmationId: string,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.confirmLeaguePendingConfirmation(
      user.userId,
      leagueId,
      confirmationId,
    );
  }

  private rejectLeaguePendingConfirmationAction(
    req: Request,
    leagueId: string,
    confirmationId: string,
    dto: RejectLeaguePendingConfirmationDto,
  ) {
    const user = req.user as AuthUser;
    return this.matchesService.rejectLeaguePendingConfirmation(
      user.userId,
      leagueId,
      confirmationId,
      dto.reason,
    );
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
  @ApiBody({
    type: ReportManualDto,
    description:
      'Supports singles (1v1) and doubles (2v2). For doubles, provide both teamA2Id and teamB2Id. For singles, omit both.',
    examples: {
      singles: {
        summary: 'Singles (1v1)',
        value: {
          teamA1Id: '11111111-1111-4111-8111-111111111111',
          teamB1Id: '22222222-2222-4222-8222-222222222222',
          sets: [
            { a: 6, b: 4 },
            { a: 6, b: 4 },
          ],
        },
      },
      doubles: {
        summary: 'Doubles (2v2)',
        value: {
          teamA1Id: '11111111-1111-4111-8111-111111111111',
          teamA2Id: '33333333-3333-4333-8333-333333333333',
          teamB1Id: '22222222-2222-4222-8222-222222222222',
          teamB2Id: '44444444-4444-4444-8444-444444444444',
          sets: [
            { a: 6, b: 4 },
            { a: 3, b: 6 },
            { a: 7, b: 6 },
          ],
        },
      },
    },
  })
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
