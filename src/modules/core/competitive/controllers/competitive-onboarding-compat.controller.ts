import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { SkipCityRequired } from '@common/decorators/skip-city-required.decorator';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { CompetitiveService } from '../services/competitive.service';
import { UpsertOnboardingDto } from '../dto/upsert-onboarding.dto';

type AuthUser = { userId: string; email: string; role: string };

/**
 * Backward-compatibility shim.
 * Canon: PUT /competitive/onboarding
 * Frontend legacy path: POST /players/me/onboarding
 *
 * Keep until frontend migrates to the canon path.
 */
@ApiTags('players')
@UseGuards(JwtAuthGuard, CityRequiredGuard)
@Controller('players/me')
export class CompetitiveOnboardingCompatController {
  constructor(private readonly competitive: CompetitiveService) {}

  @Post('onboarding')
  @SkipCityRequired()
  @ApiOperation({
    summary: '[COMPAT] Upsert onboarding — delegates to PUT /competitive/onboarding',
    deprecated: true,
    description:
      'Backward-compatible alias. Canon endpoint: PUT /competitive/onboarding. ' +
      'This route will be removed once the frontend migrates.',
  })
  upsertOnboarding(@Req() req: Request, @Body() dto: UpsertOnboardingDto) {
    const user = req.user as AuthUser;
    return this.competitive.upsertOnboarding(user.userId, dto);
  }
}
