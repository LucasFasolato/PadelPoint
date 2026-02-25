import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@/common/swagger-tags.decorator';

import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/core/auth/guards/roles.guard';
import { Roles } from '@/modules/core/auth/decorators/roles.decorator';
import { UserRole } from '@/modules/core/users/enums/user-role.enum';

import { NotificationEventsService } from '../services/notification-events.service';
import { NotificationEventsQueryDto } from '../dto/notification-events-query.dto';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiTags('Admin', 'Notifications')
export class NotificationsAdminController {
  constructor(private readonly events: NotificationEventsService) {}

  @Get()
  async list(@Query() query: NotificationEventsQueryDto) {
    return this.events.list({
      type: query.type,
      reservationId: query.reservationId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const event = await this.events.findById(id);
    if (!event) throw new NotFoundException('Notification event not found');
    return event;
  }
}
