import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateHoldDto } from './dto/create-hold.dto';

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
}
