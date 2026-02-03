import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ClubAccessGuard } from '../club-members/club-access.guard';
import { ReservationsRangeQueryDto } from './dto/reservations-range-query.dto';
import { ReservationStatus } from './reservation.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const RES_STATUS_VALUES = new Set<string>([
  'hold',
  'payment_pending',
  'confirmed',
  'cancelled',
  'expired',
]);

function parseReservationStatus(raw?: string): ReservationStatus | undefined {
  if (!raw) return undefined;
  if (!RES_STATUS_VALUES.has(raw)) {
    throw new BadRequestException('Invalid status filter');
  }
  return raw as ReservationStatus;
}

interface RequestWithUser extends Request {
  user: { email: string; userId: string; role: string };
}

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async findMine(@Req() req: RequestWithUser) {
    // We search by email because reservations are linked to 'clienteEmail'
    return this.service.listUserMatches(req.user.email);
  }
  // 1. Creation (Public or Private depending on logic, usually Public for Booking)
  @Post('hold')
  createHold(@Body() dto: CreateHoldDto) {
    // Service MUST use a Transaction (QueryRunner) here to prevent double booking
    return this.service.createHold(dto);
  }

  // 2. Admin Actions
  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard)
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  // 3. Consolidated List Endpoint (Dashboard)
  // Replaces listByClub, listByCourt, and listByClubRange duplications
  @Get('list')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  list(
    @Query('clubId') clubId: string, // Guard checks if user has access to this club
    @Query('courtId') courtId: string, // Optional filter
    @Query() range: ReservationsRangeQueryDto, // contains from, to
    @Query('status', new ParseEnumPipe(ReservationStatus, { optional: true }))
    status?: ReservationStatus,
  ) {
    return this.service.listReservations({
      clubId,
      courtId,
      from: range.from,
      to: range.to,
      status,
      includeExpiredHolds: range.includeExpiredHolds === 'true',
    });
  }

  @Get('club/:clubId')
  @UseGuards(ClubAccessGuard)
  listByClub(
    @Param('clubId') clubId: string,
    @Query() q: ReservationsRangeQueryDto,
  ) {
    return this.service.listByClubRange({
      clubId,
      from: q.from,
      to: q.to,
      status: parseReservationStatus(q.status),
      includeExpiredHolds: q.includeExpiredHolds === 'true',
    });
  }

  @Get('court/:courtId')
  listByCourt(
    @Param('courtId') courtId: string,
    @Query() q: ReservationsRangeQueryDto,
  ) {
    return this.service.listByCourtRange({
      courtId,
      from: q.from,
      to: q.to,
      status: parseReservationStatus(q.status),
      includeExpiredHolds: q.includeExpiredHolds === 'true',
    });
  }

  @Get('club/:clubId/range')
  @UseGuards(JwtAuthGuard)
  async listByClubRange(
    @Param('clubId') clubId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.listByClubRange({
      clubId,
      from,
      to,
      includeExpiredHolds: false, // Opcional: ver holds vencidos
    });
  }
}
