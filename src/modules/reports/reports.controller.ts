import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { PeakHoursQueryDto } from './dto/peak-hours-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

import { ClubAccessGuard } from '../club-members/club-access.guard';
import { ClubRoles } from '../club-members/club-roles.decorator';
import { ClubMemberRole } from '../club-members/enums/club-member-role.enum';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  @Get('revenue')
  revenue(@Query() q: RevenueQueryDto) {
    return this.reportsService.revenueReport(q);
  }

  @Get('occupancy')
  occupancy(@Query() q: OccupancyQueryDto) {
    return this.reportsService.occupancyReport(q);
  }

  @Get('peak-hours')
  peakHours(@Query() q: PeakHoursQueryDto) {
    return this.reportsService.peakHoursReport(q);
  }

  @Get('summary')
  summary(@Query() q: SummaryQueryDto) {
    return this.reportsService.summaryReport(q);
  }
}
