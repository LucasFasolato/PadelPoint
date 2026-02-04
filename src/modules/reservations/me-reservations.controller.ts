import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { ReservationsService } from './reservations.service';

type AuthUser = { userId: string; email: string; role: UserRole };

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('reservations')
  @Roles(UserRole.PLAYER)
  listMine(@Req() req: Request, @Query() q: Record<string, string>) {
    const user = req.user as AuthUser;
    const page = clampInt(q.page, 1);
    const limit = clampInt(q.limit, 10, 50);

    return this.reservations.listMyReservations({
      email: user.email,
      page,
      limit,
    });
  }

  @Post('reservations/:reservationId/receipt-link')
  @Roles(UserRole.PLAYER)
  getReceiptLink(
    @Req() req: Request,
    @Param('reservationId') reservationId: string,
  ) {
    const user = req.user as AuthUser;
    return this.reservations.createReceiptLinkForUser({
      reservationId,
      email: user.email,
    });
  }
}

function clampInt(raw: string | undefined, fallback: number, max?: number) {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (!max) return value;
  return Math.min(value, max);
}
