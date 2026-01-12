import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { PeakHoursQueryDto } from './dto/peak-hours-query.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

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
}
