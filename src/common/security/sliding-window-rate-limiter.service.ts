import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

type RateLimitResult = {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: number;
};

type MemoryWindow = {
  timestamps: number[];
};

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest[2] ~= nil then
    resetAt = tonumber(oldest[2]) + window
  end
  redis.call('PEXPIRE', key, window)
  return {0, count, resetAt}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local newCount = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = now + window
if oldest[2] ~= nil then
  resetAt = tonumber(oldest[2]) + window
end
return {1, newCount, resetAt}
`;

@Injectable()
export class SlidingWindowRateLimiterService {
  private readonly memoryStore = new Map<string, MemoryWindow>();

  constructor(private readonly redisService: RedisService) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const client = await this.redisService.getClient();

    if (!client) {
      return this.consumeInMemory(key, limit, windowMs, now);
    }

    const member = `${now}:${randomUUID()}`;
    const [allowedRaw, countRaw, resetAtRaw] = (await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(windowMs),
      String(limit),
      member,
    )) as [number, number, number];

    const count = Number(countRaw);
    const allowed = Number(allowedRaw) === 1;
    const resetAt = Number(resetAtRaw);

    return {
      allowed,
      count,
      remaining: Math.max(limit - count, 0),
      resetAt,
    };
  }

  private consumeInMemory(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): RateLimitResult {
    const window = this.memoryStore.get(key) ?? { timestamps: [] };
    const minTs = now - windowMs;
    window.timestamps = window.timestamps.filter(
      (timestamp) => timestamp > minTs,
    );

    if (window.timestamps.length >= limit) {
      this.memoryStore.set(key, window);
      const resetAt = (window.timestamps[0] ?? now) + windowMs;
      return {
        allowed: false,
        count: window.timestamps.length,
        remaining: 0,
        resetAt,
      };
    }

    window.timestamps.push(now);
    this.memoryStore.set(key, window);

    return {
      allowed: true,
      count: window.timestamps.length,
      remaining: Math.max(limit - window.timestamps.length, 0),
      resetAt: (window.timestamps[0] ?? now) + windowMs,
    };
  }
}
