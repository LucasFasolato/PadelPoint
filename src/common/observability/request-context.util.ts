import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const FALLBACK_REQUEST_ID_HEADERS = [
  REQUEST_ID_HEADER,
  'x-railway-request-id',
] as const;
const REQUEST_CONTEXT_KEY = '__requestContext';

export type RequestContext = {
  requestId: string;
};

type RequestWithContext = Request & {
  [REQUEST_CONTEXT_KEY]?: RequestContext;
};

function pickHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function ensureRequestContext(
  req: Request,
  res?: Response,
): RequestContext {
  const scopedReq = req as RequestWithContext;
  if (scopedReq[REQUEST_CONTEXT_KEY]?.requestId) {
    const existing = scopedReq[REQUEST_CONTEXT_KEY];
    if (res && !res.getHeader(REQUEST_ID_HEADER)) {
      res.setHeader(REQUEST_ID_HEADER, existing.requestId);
    }
    return existing;
  }

  const requestId =
    FALLBACK_REQUEST_ID_HEADERS.map((header) =>
      pickHeaderValue(req.headers[header]),
    ).find(Boolean) ?? randomUUID();

  const context = { requestId };
  scopedReq[REQUEST_CONTEXT_KEY] = context;

  if (res && !res.getHeader(REQUEST_ID_HEADER)) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }

  return context;
}

export function getRequestContext(req?: Request | null): RequestContext | null {
  if (!req) return null;
  return (req as RequestWithContext)[REQUEST_CONTEXT_KEY] ?? null;
}
