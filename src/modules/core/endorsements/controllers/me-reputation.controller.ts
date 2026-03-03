import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { MatchEndorsementsService } from '../services/match-endorsements.service';
import { PendingEndorsementsQueryDto } from '../dto/pending-endorsements-query.dto';
import { PendingEndorsementsResponseDto } from '../dto/pending-endorsements-response.dto';
import { ReputationResponseDto } from '../dto/reputation-response.dto';

type AuthUser = { userId: string; email: string; role: string };

@ApiTags('endorsements')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeReputationController {
  constructor(private readonly service: MatchEndorsementsService) {}

  @Get('reputation')
  @ApiOkResponse({ type: ReputationResponseDto })
  getMyReputation(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.service.getMyReputation(user.userId);
  }

  @Get('endorsements/pending')
  @ApiOkResponse({ type: PendingEndorsementsResponseDto })
  getPendingEndorsements(
    @Req() req: Request,
    @Query() query: PendingEndorsementsQueryDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.getPendingEndorsements(user.userId, query.limit ?? 20);
  }
}
