import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { MatchEndorsementsService } from '../services/match-endorsements.service';
import { StrengthSummaryQueryDto } from '../dto/strength-summary-query.dto';
import { StrengthSummaryResponseDto } from '../dto/strength-summary-response.dto';

@ApiTags('endorsements')
@ApiBearerAuth()
@Controller('players')
@UseGuards(JwtAuthGuard)
export class PlayerStrengthsController {
  constructor(private readonly service: MatchEndorsementsService) {}

  @Get(':userId/strengths')
  @ApiOperation({
    summary: 'Get player strengths from endorsements',
    description:
      'Returns aggregated strengths inferred from post-match endorsements. ' +
      'This data feeds compact scouting and competitive profile surfaces.',
  })
  @ApiOkResponse({ type: StrengthSummaryResponseDto })
  getStrengths(
    @Param('userId', new ParseRequiredUuidPipe('userId')) userId: string,
    @Query() query: StrengthSummaryQueryDto,
  ) {
    return this.service.getStrengthSummary(userId, query.days ?? 90);
  }

  @Get(':userId/strengths/summary')
  @ApiOperation({
    summary: 'Get player strengths summary',
    description:
      'Backward-compatible alias for GET /players/:userId/strengths.',
  })
  @ApiOkResponse({ type: StrengthSummaryResponseDto })
  getSummary(
    @Param('userId', new ParseRequiredUuidPipe('userId')) userId: string,
    @Query() query: StrengthSummaryQueryDto,
  ) {
    return this.service.getStrengthSummary(userId, query.days ?? 90);
  }
}
