import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: ReservationsService) {}

  // Used by the Checkout Page to show booking summary
  @Get(':id')
  getPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.service.getPublicById(id, token);
  }

  @Post(':id/confirm')
  confirmPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.service.confirmPublic(id, token);
  }
}
