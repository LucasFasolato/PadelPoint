import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { PlayerCompetitiveSummaryService } from '../services/player-competitive-summary.service';
import { PlayerCompetitiveSummaryDto } from '../dto/player-competitive-summary.dto';

@ApiTags('players')
@ApiBearerAuth()
@Controller('players')
@UseGuards(JwtAuthGuard)
export class PlayersPublicController {
  constructor(
    private readonly summaryService: PlayerCompetitiveSummaryService,
  ) {}

  @Get(':id/competitive-summary')
  @ApiOperation({
    summary: 'Get rival scouting profile (competitive summary)',
    description:
      'Returns a compact, UI-ready competitive snapshot for a given player. ' +
      'Includes ELO, category, recent form, top strengths/endorsements and last confirmed matches. ' +
      'Intended for hover/tap cards from the ranking view. ' +
      'All sections that lack data return null/empty — never invented.',
  })
  @ApiOkResponse({ type: PlayerCompetitiveSummaryDto })
  @ApiNotFoundResponse({ description: 'Player not found' })
  getCompetitiveSummary(
    @Param('id', new ParseRequiredUuidPipe('id')) targetId: string,
  ): Promise<PlayerCompetitiveSummaryDto> {
    return this.summaryService.getSummary(targetId);
  }
}
