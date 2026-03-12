import type { NextFunction, Request, Response } from 'express';
import { SlidingWindowRateLimiterService } from './sliding-window-rate-limiter.service';

type RateLimitRule = {
  id: string;
  limit: number;
  windowMs: number;
  match: (req: Request) => boolean;
};

const OAUTH_CALLBACK_PATHS = new Set([
  '/auth/google/callback',
  '/auth/apple/callback',
]);

const RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    id: 'auth',
    limit: 30,
    windowMs: 60_000,
    match: (req) =>
      req.path.startsWith('/auth') && !OAUTH_CALLBACK_PATHS.has(req.path),
  },
  {
    id: 'matches-report',
    limit: 15,
    windowMs: 60_000,
    match: (req) =>
      req.method.toUpperCase() === 'POST' && req.path === '/matches',
  },
  {
    id: 'availability-slots',
    limit: 120,
    windowMs: 60_000,
    match: (req) => req.path === '/availability/slots',
  },
  {
    id: 'challenges',
    limit: 60,
    windowMs: 60_000,
    match: (req) => req.path.startsWith('/challenges'),
  },
];

function getClientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip ?? 'unknown';
}

export function createApiRateLimitMiddleware(
  rateLimiter: SlidingWindowRateLimiterService,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method.toUpperCase() === 'OPTIONS') {
      next();
      return;
    }

    const rule = RATE_LIMIT_RULES.find((candidate) => candidate.match(req));
    if (!rule) {
      next();
      return;
    }

    void rateLimiter
      .consume(
        `ratelimit:${rule.id}:${getClientIp(req)}`,
        rule.limit,
        rule.windowMs,
      )
      .then((result) => {
        res.setHeader('x-ratelimit-limit', String(rule.limit));
        res.setHeader('x-ratelimit-remaining', String(result.remaining));

        if (result.allowed) {
          next();
          return;
        }

        const retryAfterSeconds = Math.max(
          Math.ceil((result.resetAt - Date.now()) / 1000),
          1,
        );
        res.setHeader('retry-after', String(retryAfterSeconds));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests',
          error: 'Too Many Requests',
        });
      })
      .catch(next);
  };
}
