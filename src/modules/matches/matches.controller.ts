import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchesService } from './matches.service';
import { ReportMatchDto, RejectMatchDto } from './dto/report-match.dto';

type AuthUser = { userId: string; email: string; role: string };

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly service: MatchesService) {}

  @Post()
  report(@Req() req: Request, @Body() dto: ReportMatchDto) {
    const user = req.user as AuthUser;
    return this.service.reportMatch(user.userId, dto);
  }

  @Patch(':id/confirm')
  confirm(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.service.confirmMatch(user.userId, id);
  }

  @Patch(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RejectMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.rejectMatch(user.userId, id, dto.reason);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get()
  getByChallenge(@Query('challengeId') challengeId?: string) {
    if (!challengeId) return [];
    return this.service.getByChallenge(challengeId);
  }
}
