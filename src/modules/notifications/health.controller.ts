import { Controller, Get } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('health')
export class HealthController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  health() {
    const email = this.notificationService.getEmailStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        email: {
          enabled: email.enabled,
          provider: email.provider,
          logOnly: email.logOnly,
        },
        websocket: {
          enabled: true,
        },
      },
    };
  }
}
