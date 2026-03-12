import type { NextFunction, Request, Response } from 'express';
import { RequestMetricsService } from './request-metrics.service';
import { ensureRequestContext } from './request-context.util';

function resolveEndpoint(req: Request): string {
  return req.originalUrl.split('?')[0] || req.path;
}

function resolveUserId(req: Request): string | null {
  const maybeUser = req.user as { userId?: string; id?: string } | undefined;
  return maybeUser?.userId ?? maybeUser?.id ?? null;
}

export function createRequestLoggingMiddleware(
  metrics: RequestMetricsService,
  slowRequestMs: number,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    const { requestId } = ensureRequestContext(req, res);

    res.on('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const metric = {
        requestId,
        userId: resolveUserId(req),
        endpoint: resolveEndpoint(req),
        method: req.method.toUpperCase(),
        status: res.statusCode,
        durationMs,
      };

      metrics.recordHttpRequest(metric);
      if (durationMs >= slowRequestMs) {
        metrics.recordSlowRequest(metric);
      }
    });

    next();
  };
}
