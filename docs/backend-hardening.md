# Backend Hardening

## Scope

This hardening pass preserves the existing public API contract and business semantics.

- No response shapes were redesigned.
- No matches-v2 lifecycle logic was rewritten.
- Public routing remains unchanged.

## Security Improvements

### CSRF

- Added a global CSRF middleware using a double-submit token.
- The CSRF token is issued as `pp_csrf`.
- The CSRF cookie uses `SameSite=Strict`.
- Unsafe requests now require one of:
  - a trusted frontend `Origin` matching `APP_URL`
  - a matching `x-csrf-token` / `x-xsrf-token` header and `pp_csrf` cookie
- `POST /auth/apple/callback` is explicitly exempt because Apple posts back cross-site.
- The response exposes `x-csrf-token` so browser clients can bootstrap the token without changing JSON payloads.

Compatibility note:

- The current deployment still uses cross-site auth cookies (`pp_at`, `pp_rt`), so trusted-origin validation remains the compatibility path until frontend and backend are same-site.
- The strict CSRF cookie is present now to close the public contract boundary and support future same-site enforcement without another server rewrite.

### Refresh Token Reuse Detection

- Refresh tokens now carry:
  - `tokenFamilyId`
  - `revoked`
  - `revokedAt`
- Login/register/OAuth create a new refresh-token family.
- Refresh rotation stays inside the same family.
- If a previously rotated token is reused, the backend revokes the whole family and forces a full re-login.
- `/auth/refresh` now clears cookies when rotation fails or when the user is no longer active.

### Password Reset Hardening

- Replaced the in-memory password-reset limiter with a Redis-backed sliding-window limiter.
- Fallback remains in-memory when `REDIS_URL` is missing, so local/dev flows keep working.
- Request reset limits:
  - per email: 5 / 15 minutes
  - per IP: 20 / 15 minutes
- Confirm reset limits:
  - per email when resolvable from the reset token: 8 / 15 minutes
  - per token hash: 10 / 15 minutes
  - per IP: 20 / 15 minutes

Behavioral note:

- `POST /auth/password/reset/request` still returns `{ ok: true }` when limited, preserving the non-enumeration contract.
- `POST /auth/password/reset/confirm` returns `429` when the limiter blocks the request.

## API Rate Limits

Global sliding-window middleware now protects:

- `/auth/*`
  - 30 requests / minute / IP
  - OAuth callbacks are excluded
- `POST /matches`
  - 15 requests / minute / IP
- `GET /availability/slots`
  - 120 requests / minute / IP
- `/challenges/*`
  - 60 requests / minute / IP

Responses expose:

- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `retry-after` on `429`

## Performance Changes

The heavy read paths were reviewed. The low-risk changes applied here are index-only.

Added indexes:

- `refresh_tokens (tokenFamilyId)`
- `refresh_tokens (userId, tokenFamilyId)`
- `refresh_tokens (tokenFamilyId, revoked)`
- `user_notifications (userId, readAt, createdAt desc)`
- `court_availability_overrides (courtId, fecha, bloqueado, horaInicio, horaFin)`

No response-shape or query-contract changes were introduced for:

- `GET /matches/me`
- league standings
- notifications feed
- challenge coordination
- availability slots

## Observability

### Structured Request Logging

Every HTTP request now logs structured fields:

- `requestId`
- `userId`
- `endpoint`
- `method`
- `status`
- `durationMs`

Slow requests emit a separate structured warning event.

### Query Logging

TypeORM now uses a structured logger for:

- query errors
- slow queries
- migrations
- schema operations when DB query logging is enabled

### Metrics Hooks

The request metrics service aggregates rolling endpoint windows and emits:

- p95 latency
- request count
- 5xx error rate

Current emission cadence:

- every 5 minutes

## Environment

New env vars:

- `REDIS_URL`
- `SLOW_QUERY_MS`
- `SLOW_REQUEST_MS`

## Monitoring Recommendations

- Alert on repeated `db.query.slow` events above the configured threshold.
- Alert when `http.metrics.window.errorRate` is elevated for `/auth/*`, `/matches`, or `/challenges/*`.
- Watch for spikes in `429` responses on password-reset and auth routes.
- Treat refresh-token family revocations as security signals worth dashboarding.
