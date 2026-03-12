import type { Request } from 'express';

const CSRF_EXEMPT_ROUTES = new Set(['POST /auth/apple/callback']);

export function isCsrfExemptRequest(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = req.path;
  return CSRF_EXEMPT_ROUTES.has(`${method} ${path}`);
}
