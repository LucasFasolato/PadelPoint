import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SlidingWindowRateLimiterService } from './sliding-window-rate-limiter.service';

@Global()
@Module({
  providers: [RedisService, SlidingWindowRateLimiterService],
  exports: [RedisService, SlidingWindowRateLimiterService],
})
export class SecurityModule {}
