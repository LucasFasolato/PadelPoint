import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CheckoutTokenDto } from './dto/checkout-token.dto';
import { PublicReservationQueryDto } from './dto/public-get-query.dto';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: ReservationsService) {}

  // Ver resumen para checkout (requiere token)
  @Get(':id')
  getPublic(@Param('id') id: string, @Query() q: PublicReservationQueryDto) {
    return this.service.getPublicById(id, q.token ?? null);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() body: CheckoutTokenDto) {
    return this.service.confirmPublic(id, body.token);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: CheckoutTokenDto) {
    return this.service.cancelPublic(id, body.token);
  }
}
