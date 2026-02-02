import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: ReservationsService) {}

  // Checkout (hold/cancelled) - requiere checkout token
  @Get(':id')
  getPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getPublicById(id, token ?? null);
  }

  // Receipt (confirmed) - requiere receiptToken
  @Get(':id/receipt')
  getReceipt(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getReceiptById(id, token ?? null);
  }

  // Confirm (hold -> confirmed) - token preferentemente por query, fallback por body
  @Post(':id/confirm')
  confirmPublic(
    @Param('id') id: string,
    @Query('token') tokenQ: string,
    @Body('token') tokenB: string,
  ) {
    const token = tokenQ ?? tokenB;
    return this.service.confirmPublic(id, token);
  }
}
