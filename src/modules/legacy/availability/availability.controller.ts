import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { ClubAccessGuard } from '@legacy/club-members/club-access.guard';

@ApiTags('Availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  // --- CONFIGURATION (Protected) ---

  @Post('rules')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'Create one availability rule for club-admin tooling',
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  createRule(@Body() dto: CreateAvailabilityRuleDto) {
    return this.service.createRule(dto);
  }

  @Post('rules/bulk')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'Bulk-create availability rules for club-admin tooling',
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  bulk(@Body() dto: BulkCreateAvailabilityDto) {
    return this.service.bulkCreate(dto);
  }

  @Get('rules/court/:courtId')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'List availability rules for one court',
    description:
      'Stable club-admin tooling surface. Requires authenticated club access resolved from the court.',
  })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  listByCourt(@Param('courtId') courtId: string) {
    return this.service.listByCourt(courtId);
  }

  @Post('overrides')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'Create one availability override for club-admin tooling',
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  createOverride(@Body() dto: CreateOverrideDto) {
    return this.service.createOverride(dto);
  }

  @Delete('overrides/:id')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'Delete one availability override for club-admin tooling',
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  deleteOverride(@Param('id') id: string) {
    return this.service.deleteOverride(id);
  }

  // --- CALCULATION (Public / Dashboard) ---

  @Get('slots')
  @ApiOperation({
    summary: 'Calculate public availability slots',
  })
  @ApiOkResponse({ type: AvailabilitySlotDto, isArray: true })
  async getSlots(
    @Query() q: AvailabilityRangeQueryDto,
  ): Promise<AvailabilitySlotDto[]> {
    return this.service.calculateAvailability(q);
  }

  @Delete('admin/cleanup-duplicates')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ApiOperation({
    summary: 'Maintenance cleanup for duplicate availability rows',
  })
  @ApiForbiddenResponse({
    description: 'Requires authenticated club-admin or staff access.',
  })
  cleanupDuplicates() {
    return this.service.cleanupDuplicates();
  }
}
