import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ClubAccessGuard } from '../club-members/club-access.guard';
import { ReservationsRangeQueryDto } from './dto/reservations-range-query.dto';
import { ReservationStatus } from './reservation.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const RES_STATUS_VALUES = new Set<string>(['hold', 'confirmed', 'cancelled']);

function parseReservationStatus(raw?: string): ReservationStatus | undefined {
  if (!raw) return undefined;
  if (!RES_STATUS_VALUES.has(raw)) {
    throw new BadRequestException('Invalid status filter');
  }
  return raw as ReservationStatus;
}

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Post('hold')
  createHold(@Body() dto: CreateHoldDto) {
    return this.service.createHold(dto);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get()
  list() {
    return this.service.listAll();
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
