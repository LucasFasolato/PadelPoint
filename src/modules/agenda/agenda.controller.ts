import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';
import { AgendaBlockDto } from './dto/agenda-block.dto';
import { AgendaUpdateBlockDto } from './dto/agenda-update-block.dto';

@Controller('clubs/:clubId/agenda')
export class AgendaController {
  constructor(private readonly agendaService: AgendaService) {}

  @Get()
  getDailyAgenda(
    @Param('clubId') clubId: string,
    @Query() query: AgendaQueryDto,
  ) {
    return this.agendaService.getDailyAgenda({
      clubId,
      date: query.date,
      statuses: query.statuses,
      mode: query.mode ?? 'full',
    });
  }

  @Post('block')
  blockSlot(@Param('clubId') clubId: string, @Body() dto: AgendaBlockDto) {
    return this.agendaService.blockSlot({
      clubId,
      courtId: dto.courtId,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      reason: dto.reason,
      blocked: dto.blocked ?? true,
    });
  }

  @Patch('blocks/:overrideId')
  updateBlock(
    @Param('clubId') clubId: string,
    @Param('overrideId') overrideId: string,
    @Body() dto: AgendaUpdateBlockDto,
  ) {
    return this.agendaService.updateBlock({
      clubId,
      overrideId,
      blocked: dto.blocked,
      reason: dto.reason,
    });
  }
}
