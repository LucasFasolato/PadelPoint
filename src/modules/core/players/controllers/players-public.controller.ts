import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { PlayerCompetitiveProfileDto } from '../dto/player-competitive-profile.dto';
import { PlayerCompetitiveSummaryDto } from '../dto/player-competitive-summary.dto';
import { PlayerCompetitiveProfileService } from '../services/player-competitive-profile.service';
import { PlayerCompetitiveSummaryService } from '../services/player-competitive-summary.service';

@ApiTags('players')
@ApiBearerAuth()
@Controller('players')
@UseGuards(JwtAuthGuard)
export class PlayersPublicController {
  constructor(
    private readonly summaryService: PlayerCompetitiveSummaryService,
    private readonly competitiveProfileService: PlayerCompetitiveProfileService,
  ) {}

  @Get(':id/competitive-summary')
  @ApiOperation({
    summary: 'Get rival scouting profile (competitive summary)',
    description:
      'Returns a compact, UI-ready competitive snapshot for a given player. ' +
      'Includes ELO, category, recent form, top strengths/endorsements and last confirmed matches. ' +
      'Use this for scouting hover cards, compact quick previews and ranking list context. ' +
      'For a public full-page profile, use GET /players/:id/competitive-profile. ' +
      'All sections that lack data return null/empty and are never invented.',
  })
  @ApiOkResponse({ type: PlayerCompetitiveSummaryDto })
  @ApiNotFoundResponse({ description: 'Player not found' })
  getCompetitiveSummary(
    @Param('id', new ParseRequiredUuidPipe('id')) targetId: string,
  ): Promise<PlayerCompetitiveSummaryDto> {
    return this.summaryService.getSummary(targetId);
  }

  @Get(':id/competitive-profile')
  @ApiOperation({
    summary: 'Get public competitive profile',
    description:
      'Returns the public full-page competitive profile for a given player, including career totals, ranking positions, streaks and recent activity. ' +
      'Use GET /players/:id/competitive-summary for compact scouting/hover-card data such as recent form, strengths and recent match previews. ' +
      'This endpoint intentionally overlaps only on core identity and top-level competitive indicators.',
  })
  @ApiOkResponse({ type: PlayerCompetitiveProfileDto })
  @ApiNotFoundResponse({ description: 'Player not found' })
  getCompetitiveProfile(
    @Param('id', new ParseRequiredUuidPipe('id')) targetId: string,
  ): Promise<PlayerCompetitiveProfileDto> {
    return this.competitiveProfileService.getProfile(targetId);
  }
}
