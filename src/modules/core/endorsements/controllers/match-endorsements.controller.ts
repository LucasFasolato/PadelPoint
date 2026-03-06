import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { MatchEndorsementsService } from '../services/match-endorsements.service';
import { CreateMatchEndorsementDto } from '../dto/create-match-endorsement.dto';
import { CreateMatchEndorsementResponseDto } from '../dto/create-match-endorsement-response.dto';

type AuthUser = { userId: string; email: string; role: string };

@ApiTags('endorsements')
@ApiBearerAuth()
@Controller('matches')
@UseGuards(JwtAuthGuard, CityRequiredGuard)
export class MatchEndorsementsController {
  constructor(private readonly service: MatchEndorsementsService) {}

  @Post(':matchId/endorsements')
  @ApiOperation({
    summary: 'Create post-match endorsement for a rival',
    description:
      'Lets an authenticated participant optionally endorse one rival from a confirmed match with up to 2 strengths. ' +
      'Each rival can only be endorsed once per match.',
  })
  @ApiCreatedResponse({ type: CreateMatchEndorsementResponseDto })
  create(
    @Req() req: Request,
    @Param('matchId', new ParseRequiredUuidPipe('matchId')) matchId: string,
    @Body() dto: CreateMatchEndorsementDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.create(matchId, user.userId, dto);
  }
}
