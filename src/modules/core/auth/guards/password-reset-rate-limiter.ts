import { Injectable } from '@nestjs/common';

const MAX_REQUESTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Lightweight in-memory rate limiter for the password reset request endpoint.
 * Key: lowercase(email) + ip.  Window: 15 min, max 5 requests.
 * Returns true when the limit is exceeded — callers should return { ok: true }
 * without sending the email (prevents abuse without leaking user existence).
 */
@Injectable()
export class PasswordResetRateLimiter {
  private readonly store = new Map<string, number[]>();

  isLimited(email: string, ip: string): boolean {
    const key = `${email.toLowerCase()}:${ip}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const timestamps = (this.store.get(key) ?? []).filter(
      (t) => t > windowStart,
    );

    if (timestamps.length >= MAX_REQUESTS) {
      this.store.set(key, timestamps);
      return true;
    }

    timestamps.push(now);
    this.store.set(key, timestamps);
    return false;
  }
}
