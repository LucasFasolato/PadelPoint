import type { CookieOptions } from 'express';

export const AT_MAX_AGE = 15 * 60 * 1000; // 15 minutes in ms
export const RT_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

export function cookieBaseOptions(): CookieOptions {
  const appUrl = process.env.APP_URL ?? '';
  const isLocal =
    process.env.NODE_ENV !== 'production' && appUrl.includes('localhost');

  if (isLocal) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    };
  }

  return {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
  };
}
