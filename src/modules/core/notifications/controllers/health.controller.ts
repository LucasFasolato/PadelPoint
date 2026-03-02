import { Controller, Get } from '@nestjs/common';
import { NotificationService } from '../services/notification.service';

@Controller('health')
export class HealthController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  health() {
    const email = this.notificationService.getEmailStatus();
    // Prefer Railway's native commit SHA, then keep backward-compatible fallbacks.
    const sha =
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.COMMIT_SHA ??
      process.env.GIT_SHA ??
      'unknown';
    const env = process.env.NODE_ENV ?? 'development';

    return {
      status: 'ok',
      sha,
      env,
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
