import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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

  @Get(':userId/strengths/summary')
  @ApiOkResponse({ type: StrengthSummaryResponseDto })
  getSummary(
    @Param('userId', new ParseRequiredUuidPipe('userId')) userId: string,
    @Query() query: StrengthSummaryQueryDto,
  ) {
    return this.service.getStrengthSummary(userId, query.days ?? 90);
  }
}
