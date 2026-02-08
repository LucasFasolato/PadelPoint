import {
  Body,
  Controller,
  ForbiddenException,
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
import { DisputeMatchDto } from './dto/dispute-match.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { UserRole } from '../users/user-role.enum';

type AuthUser = { userId: string; email: string; role: string };

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly service: MatchesService) {}

  @Get('me')
  async getMyMatches(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.service.getMyMatches(user.userId);
  }

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

  @Post(':id/dispute')
  dispute(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DisputeMatchDto,
  ) {
    const user = req.user as AuthUser;
    return this.service.disputeMatch(user.userId, id, dto);
  }

  @Post(':id/resolve')
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    const user = req.user as AuthUser;
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'RESOLVE_FORBIDDEN',
        message: 'Only admins can resolve disputes',
      });
    }
    return this.service.resolveDispute(user.userId, id, dto);
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
