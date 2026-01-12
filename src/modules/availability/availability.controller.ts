import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { BulkCreateAvailabilityDto } from './dto/bulk-create-availability.dto';
import { AvailabilityRangeQueryDto } from './dto/availability-range-query.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { OverrideRangeQueryDto } from './dto/override-range-query.dto';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  // Crear una regla (1 día)
  @Post('rules')
  createRule(@Body() dto: CreateAvailabilityRuleDto) {
    return this.service.createRule(dto);
  }

  // Crear reglas en lote (varios días)
  @Post('rules/bulk')
  bulk(@Body() dto: BulkCreateAvailabilityDto) {
    return this.service.bulkCreate(dto);
  }

  // Listar reglas por cancha
  @Get('rules/court/:courtId')
  listByCourt(@Param('courtId') courtId: string) {
    return this.service.listByCourt(courtId);
  }

  // Disponibilidad por rango (slots on-the-fly)
  @Get()
  availabilityRange(@Query() q: AvailabilityRangeQueryDto) {
    return this.service.availabilityRange(q);
  }

  // Overrides (bloqueos comerciales)
  @Post('overrides')
  createOverride(@Body() dto: CreateOverrideDto) {
    return this.service.createOverride(dto);
  }

  @Get('overrides')
  listOverrides(@Query() q: OverrideRangeQueryDto) {
    return this.service.listOverrides(q);
  }

  @Delete('overrides/:id')
  deleteOverride(@Param('id') id: string) {
    return this.service.deleteOverride(id);
  }
}
