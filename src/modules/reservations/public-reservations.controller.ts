import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';
import { CheckoutTokenDto } from '../reservations/dto/checkout-token.dto';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: ReservationsService) {}

  // Used by the Checkout Page to show booking summary
  @Get(':id')
  getPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getPublicById(id, token);
  }

  // Webhook or Checkout success callback
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() body: CheckoutTokenDto) {
    return this.service.confirmPublic(id, body.token);
  }
}
