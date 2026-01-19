import { Controller, Get, Param } from '@nestjs/common';
import { CourtsService } from './courts.service';

@Controller('public/courts')
export class PublicCourtsController {
  constructor(private readonly service: CourtsService) {}

  @Get('club/:clubId')
  findByClubPublic(@Param('clubId') clubId: string) {
    return this.service.findByClubPublic(clubId);
  }

  @Get(':id')
  findOnePublic(@Param('id') id: string) {
    return this.service.findOnePublic(id);
  }
}
