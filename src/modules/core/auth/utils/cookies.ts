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

  // NOTE:
  // We are using SameSite='none' because frontend (vercel.app)
  // and backend (railway.app) are on different domains.
  // When we migrate to a shared root domain (e.g. app.padelpoint.com + api.padelpoint.com),
  // we should switch this to:
  //   sameSite: 'lax'
  //   and optionally set domain: '.padelpoint.com'
  // This will improve security and avoid third-party cookie behavior.
  return {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
  };
}
