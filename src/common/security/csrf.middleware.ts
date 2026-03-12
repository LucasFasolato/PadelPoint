import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  CSRF_COOKIE_NAME,
  CSRF_FALLBACK_HEADER_NAME,
  CSRF_HEADER_NAME,
} from './security.constants';
import { isCsrfExemptRequest } from './csrf-route.util';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function readTokenHeader(req: Request): string | null {
  const primary = req.header(CSRF_HEADER_NAME);
  if (typeof primary === 'string' && primary.trim().length > 0) {
    return primary.trim();
  }

  const fallback = req.header(CSRF_FALLBACK_HEADER_NAME);
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim();
  }

  return null;
}

function readCookieToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[CSRF_COOKIE_NAME];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function hasSessionCookies(req: Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  return Boolean(cookies?.pp_at || cookies?.pp_rt);
}

function shouldProtectRequest(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return false;
  }

  if (isCsrfExemptRequest(req)) {
    return false;
  }

  return hasSessionCookies(req) || req.path.startsWith('/auth');
}

export function createCsrfMiddleware(configService: ConfigService) {
  const trustedOriginRaw =
    configService.get<string>('email.appUrl') ?? process.env.APP_URL ?? '';
  const trustedOrigin = trustedOriginRaw
    ? normalizeOrigin(trustedOriginRaw)
    : null;
  const secure =
    (configService.get<string>('nodeEnv') ?? 'development') === 'production';

  return (req: Request, res: Response, next: NextFunction): void => {
    let cookieToken = readCookieToken(req);

    if (!cookieToken) {
      cookieToken = randomBytes(32).toString('base64url');
      res.cookie(CSRF_COOKIE_NAME, cookieToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure,
        path: '/',
      });
      req.cookies = {
        ...((req.cookies as Record<string, unknown> | undefined) ?? {}),
        [CSRF_COOKIE_NAME]: cookieToken,
      };
    }

    if (cookieToken && !res.getHeader(CSRF_HEADER_NAME)) {
      res.setHeader(CSRF_HEADER_NAME, cookieToken);
    }

    if (!shouldProtectRequest(req)) {
      next();
      return;
    }

    const origin = req.header('origin');
    const normalizedOrigin =
      typeof origin === 'string' && origin.trim().length > 0
        ? normalizeOrigin(origin)
        : null;
    const headerToken = readTokenHeader(req);
    const hasValidDoubleSubmit =
      Boolean(cookieToken) &&
      Boolean(headerToken) &&
      cookieToken === headerToken;
    const hasTrustedOrigin =
      Boolean(trustedOrigin) &&
      Boolean(normalizedOrigin) &&
      normalizedOrigin === trustedOrigin;

    if (hasValidDoubleSubmit || hasTrustedOrigin) {
      next();
      return;
    }

    res.status(403).json({
      statusCode: 403,
      message: 'Invalid CSRF token',
      error: 'Forbidden',
    });
  };
}
