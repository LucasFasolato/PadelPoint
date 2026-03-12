import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly url: string;
  private readonly retryAfterMs = 30_000;
  private client: Redis | null = null;
  private lastAttemptAt = 0;

  constructor(private readonly configService: ConfigService) {
    this.url = (
      this.configService.get<string>('redis.url') ??
      process.env.REDIS_URL ??
      ''
    ).trim();

    if (!this.url) {
      this.logger.warn(
        'REDIS_URL is not configured. Falling back to in-memory limiters.',
      );
    }
  }

  async getClient(): Promise<Redis | null> {
    if (!this.url) {
      return null;
    }

    if (this.client) {
      return this.client;
    }

    if (
      this.lastAttemptAt > 0 &&
      Date.now() - this.lastAttemptAt < this.retryAfterMs
    ) {
      return null;
    }

    this.lastAttemptAt = Date.now();

    const client = new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    client.on('error', (error) => {
      this.logger.error(`redis client error: ${error.message}`);
    });

    try {
      await client.connect();
      this.client = client;
      this.logger.log('Redis limiter client connected');
      return this.client;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown_redis_error';
      this.logger.error(`redis connection failed: ${message}`);
      await client.quit().catch(() => undefined);
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.quit().catch(() => undefined);
    this.client = null;
  }
}
