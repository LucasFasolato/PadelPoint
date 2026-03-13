import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { PeakHoursQueryDto } from './dto/peak-hours-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { RevenueReportDto } from './dto/revenue-response.dto';
import { OccupancyReportDto } from './dto/occupancy-response.dto';
import { PeakHoursReportDto } from './dto/peak-hours-response.dto';
import { SummaryResponseDto } from './dto/summary-response.dto';

import { ClubAccessGuard } from '@legacy/club-members/club-access.guard';
import { ClubRoles } from '@legacy/club-members/club-roles.decorator';
import { ClubMemberRole } from '@legacy/club-members/enums/club-member-role.enum';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  @ApiOperation({
    summary: 'Club-admin revenue report',
    description:
      'Club-admin and club-staff reporting surface. Requires authenticated club access for the queried clubId.',
  })
  @ApiOkResponse({ type: RevenueReportDto })
  @ApiForbiddenResponse({
    description:
      'Only club admins/staff with access to the club can read this report.',
  })
  @Get('revenue')
  revenue(@Query() q: RevenueQueryDto) {
    return this.reportsService.revenueReport(q);
  }

  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  @ApiOperation({
    summary: 'Club-admin occupancy report',
    description:
      'Club-admin and club-staff reporting surface. Requires authenticated club access for the queried clubId.',
  })
  @ApiOkResponse({ type: OccupancyReportDto })
  @ApiForbiddenResponse({
    description:
      'Only club admins/staff with access to the club can read this report.',
  })
  @Get('occupancy')
  occupancy(@Query() q: OccupancyQueryDto) {
    return this.reportsService.occupancyReport(q);
  }

  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  @ApiOperation({
    summary: 'Club-admin peak-hours report',
    description:
      'Club-admin and club-staff reporting surface. Requires authenticated club access for the queried clubId.',
  })
  @ApiOkResponse({ type: PeakHoursReportDto })
  @ApiForbiddenResponse({
    description:
      'Only club admins/staff with access to the club can read this report.',
  })
  @Get('peak-hours')
  peakHours(@Query() q: PeakHoursQueryDto) {
    return this.reportsService.peakHoursReport(q);
  }

  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  @ApiOperation({
    summary: 'Club-admin summary report',
    description:
      'Club-admin and club-staff dashboard summary. Requires authenticated club access for the queried clubId.',
  })
  @ApiOkResponse({ type: SummaryResponseDto })
  @ApiForbiddenResponse({
    description:
      'Only club admins/staff with access to the club can read this report.',
  })
  @Get('summary')
  summary(@Query() q: SummaryQueryDto) {
    return this.reportsService.summaryReport(q);
  }
}
