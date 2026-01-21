import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { BulkCreateAvailabilityDto } from './dto/bulk-create-availability.dto';
import { AvailabilityRangeQueryDto } from './dto/availability-range-query.dto';
import { AvailabilitySlotDto } from './dto/availability-slot.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  // --- CONFIGURATION (Protected) ---

  @Post('rules')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  createRule(@Body() dto: CreateAvailabilityRuleDto) {
    return this.service.createRule(dto);
  }

  @Post('rules/bulk')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  bulk(@Body() dto: BulkCreateAvailabilityDto) {
    return this.service.bulkCreate(dto);
  }

  @Get('rules/court/:courtId')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  listByCourt(@Param('courtId') courtId: string) {
    return this.service.listByCourt(courtId);
  }

  @Post('overrides')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  createOverride(@Body() dto: CreateOverrideDto) {
    return this.service.createOverride(dto);
  }

  @Delete('overrides/:id')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  deleteOverride(@Param('id') id: string) {
    return this.service.deleteOverride(id);
  }

  // --- CALCULATION (Public / Dashboard) ---

  @Get('slots')
  async getSlots(
    @Query() q: AvailabilityRangeQueryDto,
  ): Promise<AvailabilitySlotDto[]> {
    return this.service.calculateAvailability(q);
  }
}
