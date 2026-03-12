# Backend Performance Hardening

Date: 2026-03-12

Scope:

- Preserve current public API contracts and DTOs
- Harden critical read/write paths with low-risk query and index changes
- Improve operability visibility for the highest-risk endpoints
- Avoid domain rewrites, ownership changes, and semantic changes

## Hotspot Matrix

| Path / area | Issue | Impact | Proposed fix | Risk |
| --- | --- | --- | --- | --- |
| `GET /matches/me` | Participant filter used four single-player indexes and sorted on `COALESCE(playedAt, scheduledAt, createdAt)` | Higher cost for large user histories and weaker support for cursor scans | Add feed-support expression indexes per participant slot; keep existing cursor and DTO mapping | Low |
| League standings reads | Cached read-model queries were ordered by `position` and `userId`, but no dedicated compound read-order index existed | Avoidable sort work on repeated standings reads | Add read-model rank-order index and structured timing logs | Low |
| Notifications feed / unread-related reads | Feed cursor used `createdAt` only; unread and ranking idempotency lookups relied on broader indexes | Cursor instability on timestamp collisions and avoidable scan cost | Strengthen cursor with `id` tie-breaker; add feed, unread partial, and ranking snapshot lookup indexes | Low |
| Challenge coordination reads | Canonical proposals/messages sort in memory and fallback ownership was not clearly visible in logs | Harder to diagnose read mode and message/proposal fetch cost | Add message/proposal read-order indexes and explicit canonical vs legacy logs | Low |
| `GET /availability/slots` | Raw SQL repeatedly re-scanned overrides/reservations and depended on weak lookup coverage | Expensive date-range reads under busy clubs/courts | Prefilter overrides/reservations with CTEs and add court/rule/reservation support indexes | Low |

## Changes Applied

### Notifications

- Feed ordering is now `createdAt DESC, id DESC`.
- Cursor format is now stable as `timestamp|id`.
- Legacy `createdAt`-only cursors are still accepted and mapped safely.
- Canonical inbox reads now log returned rows, unread count, and duration.

Indexes:

- `idx_user_notifications_user_created_id`
- `idx_user_notifications_unread_feed`
- `idx_user_notifications_ranking_snapshot_lookup`

### Availability

- `calculateAvailability()` now prefilters blocked overrides and active reservations before slot overlap checks.
- Availability reads now emit a structured completion log with date range, scope, slot count, and duration.

Indexes:

- `idx_courts_club_active`
- `idx_court_availability_rules_lookup`
- `idx_reservations_court_status_created`
- `idx_reservations_court_active_overlap`

### Matches Me

- Cursor semantics were already stable on `(sortAt, id)` and were preserved.
- Added feed-support expression indexes for each participant slot using `COALESCE(played_at, scheduled_at, created_at)`.
- Added completion logging for `matches-v2.list`.

Indexes:

- `idx_matches_v2_team_a_player_1_feed`
- `idx_matches_v2_team_a_player_2_feed`
- `idx_matches_v2_team_b_player_1_feed`
- `idx_matches_v2_team_b_player_2_feed`

### League Standings

- Preserved current read-model based responses.
- Added rank-order index to reduce sort pressure on `position ASC, userId ASC` reads.
- Added structured timing logs for cache-hit, cache-miss, and latest-snapshot reads.

Index:

- `idx_league_standings_read_model_rank_order`

### Challenge Coordination

- No contract or ownership changes.
- Added read-order indexes for canonical proposals/messages.
- Added explicit logs to distinguish canonical vs legacy coordination/message reads.

Indexes:

- `idx_match_messages_v2_match_created_id`
- `idx_match_proposals_v2_match_created_id`

## Cursor Stability Notes

- Notifications now use a deterministic secondary tie-breaker (`id`) to avoid duplicate or skipped rows when multiple notifications share the same timestamp.
- `GET /matches/me` already used a stable cursor with `(sortAt, id)` and remains unchanged.
- No external response field names were changed.

## Monitoring Guidance

Use existing structured logs and request metrics to watch:

- `notifications.feed`
- `availability.slots`
- `matches.me`
- `league.standings`
- `challenge.coordination`

Recommended checks:

- Watch `http.metrics.window` for endpoint p95 growth and error rate changes.
- Watch `http.request.slow` for repeated hotspot regressions.
- Watch `league.standings.read`, `league.standings.latest`, `matches-v2.list`, `notifications.list`, `notifications.inbox`, `availability.calculate`, `challenge.coordination.read`, and `challenge.messages.read`.
- Use the structured TypeORM logger for slow-query and query-error events before widening scope into query rewrites.

## Non-Goals Kept Intact

- No DTO shape changes
- No public route changes
- No matches-v2 rewrite
- No ownership redesign
- No player-domain test cleanup included in this epic
