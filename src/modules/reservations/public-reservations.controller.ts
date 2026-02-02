import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: ReservationsService) {}

  // Checkout (hold) - requiere token checkout
  @Get(':id')
  getPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getPublicById(id, token ?? null);
  }

  // ✅ Receipt (confirmed) - requiere receiptToken
  @Get(':id/receipt')
  getReceipt(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getReceiptById(id, token ?? null);
  }

  @Post(':id/confirm')
  confirmPublic(@Param('id') id: string, @Body('token') token: string) {
    return this.service.confirmPublic(id, token);
  }
}
