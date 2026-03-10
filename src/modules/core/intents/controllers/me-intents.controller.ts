import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { MatchIntentsService } from '../services/match-intents.service';
import { MeIntentsQueryDto } from '../dto/me-intents-query.dto';
import {
  MatchIntentItemResponseDto,
  MatchIntentsResponseDto,
} from '../dto/match-intents.dto';
import {
  CreateDirectIntentDto,
  CreateFindPartnerIntentDto,
  CreateOpenIntentDto,
} from '../dto/create-intent.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeIntentsController {
  constructor(private readonly intentsService: MatchIntentsService) {}

  @Get('intents')
  @ApiOkResponse({ type: MatchIntentsResponseDto })
  listIntents(@Req() req: Request, @Query() query: MeIntentsQueryDto) {
    const user = req.user as AuthUser;
    return this.intentsService.listForUser(user.userId, query);
  }

  @Post('intents/direct')
  @ApiOkResponse({ type: MatchIntentItemResponseDto })
  createDirect(@Req() req: Request, @Body() dto: CreateDirectIntentDto) {
    const user = req.user as AuthUser;
    return this.intentsService.createDirectIntent(user.userId, dto);
  }

  @Post('intents/open')
  @ApiOkResponse({ type: MatchIntentItemResponseDto })
  createOpen(@Req() req: Request, @Body() dto: CreateOpenIntentDto) {
    const user = req.user as AuthUser;
    return this.intentsService.createOpenIntent(user.userId, dto);
  }

  @Post('intents/find-partner')
  @ApiOkResponse({ type: MatchIntentItemResponseDto })
  createFindPartner(
    @Req() req: Request,
    @Body() dto: CreateFindPartnerIntentDto,
  ) {
    const user = req.user as AuthUser;
    return this.intentsService.createFindPartnerIntent(user.userId, dto);
  }
}
