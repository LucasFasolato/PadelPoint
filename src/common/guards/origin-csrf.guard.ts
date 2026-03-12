import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { isCsrfExemptRequest } from '@common/security/csrf-route.util';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

@Injectable()
export class OriginCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType<'http'>() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();

    if (SAFE_METHODS.has(method)) return true;
    if (isCsrfExemptRequest(req)) return true;

    const origin = req.header('origin');
    if (!origin) return true;

    const allowedOriginRaw = process.env.APP_URL ?? '';
    const allowedOrigin = allowedOriginRaw
      ? normalizeOrigin(allowedOriginRaw)
      : '';
    const requestOrigin = normalizeOrigin(origin);

    if (requestOrigin !== allowedOrigin) {
      throw new ForbiddenException('Invalid origin');
    }

    return true;
  }
}
