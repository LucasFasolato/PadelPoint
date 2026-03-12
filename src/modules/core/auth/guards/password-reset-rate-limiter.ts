import { createHash } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiterService } from '@common/security/sliding-window-rate-limiter.service';

const WINDOW_MS = 15 * 60 * 1000;
const REQUEST_EMAIL_LIMIT = 5;
const REQUEST_IP_LIMIT = 20;
const CONFIRM_EMAIL_LIMIT = 8;
const CONFIRM_TOKEN_LIMIT = 10;
const CONFIRM_IP_LIMIT = 20;

function normalizeIp(ip: string): string {
  return ip?.trim() || 'unknown';
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

@Injectable()
export class PasswordResetRateLimiter {
  constructor(private readonly limiter: SlidingWindowRateLimiterService) {}

  async isRequestLimited(email: string, ip: string): Promise<boolean> {
    const [emailResult, ipResult] = await Promise.all([
      this.limiter.consume(
        `password-reset:request:email:${normalizeEmail(email)}`,
        REQUEST_EMAIL_LIMIT,
        WINDOW_MS,
      ),
      this.limiter.consume(
        `password-reset:request:ip:${normalizeIp(ip)}`,
        REQUEST_IP_LIMIT,
        WINDOW_MS,
      ),
    ]);

    return !emailResult.allowed || !ipResult.allowed;
  }

  async assertConfirmAllowed(input: {
    email: string | null;
    token: string;
    ip: string;
  }): Promise<void> {
    const checks = [
      this.limiter.consume(
        `password-reset:confirm:ip:${normalizeIp(input.ip)}`,
        CONFIRM_IP_LIMIT,
        WINDOW_MS,
      ),
      this.limiter.consume(
        `password-reset:confirm:token:${this.hashToken(input.token)}`,
        CONFIRM_TOKEN_LIMIT,
        WINDOW_MS,
      ),
    ];

    if (input.email) {
      checks.push(
        this.limiter.consume(
          `password-reset:confirm:email:${normalizeEmail(input.email)}`,
          CONFIRM_EMAIL_LIMIT,
          WINDOW_MS,
        ),
      );
    }

    const results = await Promise.all(checks);
    if (results.some((result) => !result.allowed)) {
      throw new HttpException(
        'Too many password reset attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
