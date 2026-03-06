# League Contract v1

Last updated: 2026-03-06

This document is the source of truth for the current League pillar behavior as implemented today.

Scope:

- League domain inventory (entities, statuses, modes)
- Endpoint inventory and behavior
- League x Intent/Match seams and integration
- Hardening checklist
- Error matrix
- State transitions

Constraints honored by this audit:

- Storage changes are additive only
- Existing API contracts remain backward compatible
- Legacy `mode`/`status` fields remain; normalized `modeKey`/`statusKey` are additive

## 1) Domain inventory

### 1.1 Core entities

1. `leagues` (`League`)

- Key fields: `id`, `name`, `creatorId`, `mode`, `startDate`, `endDate`, `isPermanent`, `status`, `settings`, `shareToken`, `avatarMediaAssetId`, `avatarUrl`, `createdAt`, `updatedAt`
- Enums:
  - `status`: `draft | active | finished`
  - `mode`: `open | scheduled | mini`

2. `league_members` (`LeagueMember`)

- Key fields: `id`, `leagueId`, `userId`, `role`, stats (`points`, `wins`, `losses`, `draws`, `setsDiff`, `gamesDiff`, `position`), `joinedAt`
- Enums:
  - `role`: `owner | admin | member`
- Constraint:
  - Unique membership on (`leagueId`, `userId`)

3. `league_invites` (`LeagueInvite`)

- Key fields: `id`, `leagueId`, `invitedUserId`, `invitedEmail`, `token`, `status`, `expiresAt`, `createdAt`
- Enums:
  - `status`: `pending | accepted | declined | expired`
- Constraint:
  - Unique `token`

4. `league_standings_snapshots` (`LeagueStandingsSnapshot`)

- Key fields: `id`, `leagueId`, `version`, `computedAt`, `rows` (jsonb)
- Constraint:
  - Unique (`leagueId`, `version`)
- Row payload includes ranking metrics and movement metadata (`delta`, `oldPosition`, `movementType`) when available

5. `league_standings_snapshot` (`LeagueStandingsReadModel`)

- Purpose:
  - Persisted current read model for fast standings reads
- Key fields:
  - `id`, `leagueId`, `userId`, `position`, `played`, `wins`, `losses`, `draws`, `points`, `setsDiff`, `gamesDiff`, `winRate`, `lastWinAt`, `lastMatchAt`, `delta`, `deltaPosition`, `oldPosition`, `movementType`, `snapshotVersion`, `computedAt`, `updatedAt`
- Constraints / indexes:
  - Unique (`leagueId`, `userId`)
  - Read index on (`leagueId`, `position`)
  - Read index on (`leagueId`, `snapshotVersion`)

6. `league_activity` (`LeagueActivity`)

- Key fields: `id`, `leagueId`, `type`, `actorId`, `entityId`, `payload`, `createdAt`
- Types currently in enum:
  - `match_reported`, `match_confirmed`, `match_rejected`, `match_disputed`, `match_resolved`
  - `member_joined`, `member_declined`, `settings_updated`
  - `challenge_created`, `challenge_accepted`, `challenge_declined`, `challenge_expired`
  - `rankings_updated`

7. `league_challenges` (`LeagueChallenge`)

- Key fields: `id`, `leagueId`, `createdById`, `opponentId`, `status`, `message`, `expiresAt`, `acceptedAt`, `completedAt`, `matchId`, `createdAt`
- Enums:
  - `status`: `PENDING | ACCEPTED | DECLINED | EXPIRED | COMPLETED`
- Constraints:
  - Partial unique pair index for active challenges (`PENDING`, `ACCEPTED`) per league

8. `match_results` (`MatchResult`) linkage

- `match_results.leagueId` is nullable FK to `leagues`
- `match_results.challengeId` links to generic `challenges`
- League linkage for standings/activity is driven by `match_results.leagueId`

9. Generic `challenges` (`Challenge`) linkage

- No native `leagueId` column in entity/table
- League-scoped challenge lifecycle exists separately in `league_challenges`

### 1.2 Status and lifecycle inventory

League lifecycle (storage):

- `draft -> active -> finished`

League lifecycle (API mapping):

- Legacy `status` field is preserved as-is per endpoint behavior (list/detail casing remains backward compatible)
- New normalized `statusKey` is always `UPCOMING | ACTIVE | FINISHED`
- `draft` maps to `UPCOMING`

Invite lifecycle:

- `pending -> accepted`
- `pending -> declined`
- `pending -> expired`
- Accept/decline are idempotent in repeated same-state calls

League challenge lifecycle:

- `PENDING -> ACCEPTED -> COMPLETED`
- `PENDING -> DECLINED`
- `PENDING/ACCEPTED -> EXPIRED`

Match statuses relevant to leagues:

- `scheduled`, `pending_confirm`, `confirmed`, `rejected`, `disputed`, `resolved`

### 1.3 Modes

League modes currently implemented:

- `open`
- `scheduled`
- `mini`

Behavior highlights:

- `open` and `mini` are created active and effectively permanent (`isPermanent=true`)
- `scheduled` supports date-range and permanent variants
- New normalized `modeKey` is always `OPEN | SCHEDULED | MINI` (legacy `mode` kept)

## 2) API inventory and correctness

All endpoints below require JWT auth unless prefixed with `/public`.

### 2.1 League core endpoints

1. `GET /leagues`

- Behavior:
  - Returns caller leagues list
  - Uses safe normalization (mode/status/role), null-safe city/province/activity fields
  - On unexpected failures returns typed `500` with `code=LEAGUES_UNAVAILABLE` and `errorId`
  - If `league_activity` relation is temporarily unavailable, degrades `lastActivityAt` to `null` instead of failing the list
  - Sets `Cache-Control: no-store`
- Response shape:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Summer League",
      "mode": "SCHEDULED",
      "modeKey": "SCHEDULED",
      "status": "UPCOMING",
      "statusKey": "UPCOMING",
      "role": "OWNER",
      "membersCount": 8,
      "cityName": "Rosario",
      "provinceCode": "AR-S",
      "lastActivityAt": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

2. `POST /leagues`

- Behavior:
  - Creates league + creator membership (`OWNER`)
  - Validates name/mode/date semantics
  - Supports `isPermanent` and `dateRangeEnabled`

3. `POST /leagues/mini`

- Behavior:
  - Creates `mini` league and optional invite batch
  - Caps invite volume by mini slot limits

4. `GET /leagues/:id`

- Behavior:
  - Member-only
  - Returns full league detail including `members`, `settings`, `canRecordMatches`
  - Sets `Cache-Control: no-store`
- Response shape:

```json
{
  "id": "uuid",
  "name": "Summer League",
  "mode": "scheduled",
  "modeKey": "SCHEDULED",
  "creatorId": "uuid",
  "isPermanent": false,
  "dateRangeEnabled": true,
  "startDate": "2025-06-01",
  "endDate": "2025-06-30",
  "avatarUrl": null,
  "avatarMediaAssetId": null,
  "status": "upcoming",
  "statusKey": "UPCOMING",
  "canRecordMatches": false,
  "reason": "League is not active",
  "settings": {
    "winPoints": 3,
    "drawPoints": 1,
    "lossPoints": 0,
    "tieBreakers": ["points", "wins", "setsDiff", "gamesDiff"],
    "includeSources": { "RESERVATION": true, "MANUAL": true }
  },
  "createdAt": "2025-01-01T12:00:00.000Z",
  "members": [
    {
      "userId": "uuid",
      "displayName": "Creator Player",
      "role": "owner",
      "points": 0,
      "wins": 0,
      "losses": 0,
      "draws": 0,
      "setsDiff": 0,
      "gamesDiff": 0,
      "position": 1,
      "joinedAt": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

5. `PATCH /leagues/:id`

- Behavior:
  - OWNER/ADMIN update of profile fields (`name`, avatar aliases)

6. `PATCH /leagues/:id/avatar`

- Behavior:
  - OWNER/ADMIN avatar update (`mediaAssetId` or direct URL)

7. `DELETE /leagues/:id`

- Behavior:
  - OWNER/ADMIN only
  - Allowed only if no matches and no extra members

8. `GET /leagues/:id/settings`

- Behavior:
  - Member-only
  - Returns scoring/tiebreak/includeSources settings

9. `PATCH /leagues/:id/settings`

- Behavior:
  - OWNER/ADMIN only
  - Updates settings and recomputes standings in one transaction
  - Emits `settings_updated` activity

10. `PATCH /leagues/:id/members/:memberId/role`

- Behavior:
  - OWNER only
  - Allowed target roles: `owner|member` (no direct admin assignment in DTO)
  - Prevents demoting last owner
- Note:
  - There is no dedicated `GET /leagues/:id/members`; membership list is served from `GET /leagues/:id`.

### 2.2 Invite endpoints

1. `POST /leagues/:id/invites`

- Behavior:
  - OWNER/ADMIN only
  - Accepts `userIds[]` and/or `emails[]`
  - Skips existing members, pending duplicates, and slot overflows
  - Sends in-app notifications best effort

2. `GET /leagues/invites/:token`

- Behavior:
  - Returns pending invite summary
  - Moves expired invites to `expired`
  - League summary includes legacy `mode`/`status` plus normalized `modeKey`/`statusKey`

3. `POST /leagues/invites/:inviteId/accept`

- Behavior:
  - Invitee only
  - Transaction + lock
  - Idempotent for already accepted
  - Ensures membership row and emits `member_joined`

4. `POST /leagues/invites/:inviteId/decline`

- Behavior:
  - Invitee only
  - Idempotent for already declined
  - Emits `member_declined`

### 2.3 Standings endpoints

1. `GET /leagues/:id/standings`

- Behavior:
  - Member-only
  - Reads from `league_standings_snapshot` when present
  - Falls back to `recomputeLeague()` + snapshot persistence when the read model is missing
  - Returns latest rows + movement map
  - Additive metadata: `snapshotVersion`, `lastUpdatedAt`

```json
{
  "computedAt": "2026-02-27T18:00:00.000Z",
  "snapshotVersion": 12,
  "lastUpdatedAt": "2026-02-27T18:00:00.000Z",
  "rows": [
    {
      "userId": "uuid",
      "displayName": "Player 1",
      "points": 9,
      "wins": 3,
      "losses": 1,
      "draws": 0,
      "setsDiff": 4,
      "gamesDiff": 12,
      "position": 1,
      "delta": 1,
      "oldPosition": 2,
      "movementType": "UP"
    }
  ],
  "movement": {
    "uuid": { "delta": 1 }
  }
}
```

2. `GET /leagues/:id/standings/latest`

- Behavior:
  - Member-only
  - Returns table + full movement details and top movers

3. `GET /leagues/:id/standings/history?limit=1..50`

- Behavior:
  - Member-only
  - Returns `{ version, computedAt }[]`

4. `GET /leagues/:id/standings/history/:version`

- Behavior:
  - Member-only
  - Returns snapshot rows for exact version

5. `POST /leagues/:id/recompute`

- Behavior:
  - Member check first
  - Manual recompute trigger

### 2.3.1 Standings Snapshot Read Model

- Source of truth:
  - `match_results` linked by `match_results.leagueId`
  - Only matches that are `confirmed` and `impactRanking = true` are counted
- Optimized read model:
  - `league_standings_snapshot` stores the latest per-player standings rows for a league
  - `league_standings_snapshots` remains the historical/versioned snapshot store
- Recompute strategy:
  - Confirming a ranking-impacting league match recomputes standings and persists:
    - a new historical snapshot in `league_standings_snapshots`
    - the latest current read-model rows in `league_standings_snapshot`
  - Rejecting a match does not recompute standings
  - Idempotent confirm/reject operations short-circuit with no new snapshot/read-model write
- Performance notes:
  - League standings reads no longer depend on historical snapshot scans for the common path
  - `recomputeForMatch()` short-circuits directly to `match_results.leagueId` when present instead of scanning active leagues
  - The standings recompute query is indexed on `match_results(leagueId, status, impactRanking, playedAt)`
  - The current-read query is indexed on `league_standings_snapshot(leagueId, position)` and `league_standings_snapshot(leagueId, snapshotVersion)`
  - Match timelines and pending confirmations are additionally indexed for `COALESCE(..., createdAt)` sorts

### 2.4 League activity endpoints

1. `GET /leagues/:id/activity?cursor=&limit=1..100`

- Behavior:
  - Member-only
  - Cursor pagination
  - Returns `items` with resolved `actorName` and UI `title/subtitle`

### 2.5 League challenge endpoints

1. `POST /leagues/:leagueId/challenges`

- Behavior:
  - Creates challenge between league members
  - Enforces no active duplicate pair

2. `GET /leagues/:leagueId/challenges?status=active|history`

- Behavior:
  - `active`: `PENDING|ACCEPTED`
  - `history`: `COMPLETED|DECLINED|EXPIRED`

3. `POST /challenges/:id/accept`
4. `POST /challenges/:id/decline`
5. `POST /challenges/:id/link-match`

- Behavior:
  - Participant-gated actions
  - `link-match` validates same-league finalized match and moves challenge to `COMPLETED`

### 2.6 League match endpoints

1. `GET /leagues/:leagueId/matches`
2. `POST /leagues/:leagueId/matches`
3. `PATCH /leagues/:leagueId/matches/:matchId/result`
4. `GET /leagues/:leagueId/pending-confirmations`
5. `GET /leagues/:leagueId/eligible-reservations`
6. `POST /leagues/:leagueId/report-from-reservation`
7. `POST /leagues/:leagueId/report-manual`

Confirmation and dispute endpoints used by league matches:

- `PATCH /matches/:id/confirm`
- `PATCH /matches/:id/admin-confirm`
- `PATCH /matches/:id/reject`
- `POST /matches/:id/dispute`
- `POST /matches/:id/resolve`
- `POST /matches/:id/resolve-confirm-as-is`

### 2.7 Public league share endpoints

1. `GET /leagues/:id/share`
2. `POST /leagues/:id/share/enable`
3. `POST /leagues/:id/share/disable`
4. `GET /public/leagues/:id/standings?token=...`
5. `GET /public/leagues/:id/og?token=...`

## 3) Intent and Match seams (audit findings)

### 3.1 How leagueId is carried today (truth rule)

Current behavior:

- League-scoped challenge intent is represented by `league_challenges.leagueId`
- Match linkage is represented by `match_results.leagueId`
- Generic `challenges` entity/table has no first-class `leagueId`

Contract truth:

- `leagueId` truth for matches is `match_results.leagueId`
- `reportMatch` must only take `leagueId` from explicit DTO input (if provided)
- `reportMatch` must not infer `leagueId` from generic `Challenge`
- League challenge to match linkage is validated at `league_challenges` level (`link-match` flow)

### 3.2 Accept flow to match creation

League challenge path:

- `POST /challenges/:id/accept` changes challenge to `ACCEPTED`
- Match is not auto-created on accept
- Match creation/linking happens later via:
  - `POST /leagues/:leagueId/matches`
  - `POST /leagues/:leagueId/report-from-reservation`
  - `POST /leagues/:leagueId/report-manual`
  - `POST /challenges/:id/link-match`

### 3.3 Confirmed match side effects

On match confirm/admin-confirm/resolve paths:

- ELO application only when ranking-impacting (`matchType`/`impactRanking`)
- Standings recompute only when `leagueId` exists and ranking-impacting
- League activity emission on report/confirm/dispute/resolve
- Standings snapshot generation includes movement diff and triggers `rankings_updated` activity and movement notifications

## 4) Hardening checklist

### 4.1 Null safety and DTO stability

Already in place:

- List mapping (`GET /leagues`) is defensive for null/invalid raw fields
- `GET /leagues` logs include `errorId`, `userId`, `route`, `stack`, and sanitized row samples (no PII)
- Public standings never leak emails and tolerate missing snapshots
- Normalized keys (`modeKey`, `statusKey`) are present while legacy `mode`/`status` remain

Audit risk:

- No dedicated members list endpoint despite product wording (`GET /leagues/:id/members`)

### 4.2 Permissions by role

Current behavior:

- Member-only read for detail/activity/standings/settings
- OWNER/ADMIN for invites/settings/profile/delete
- OWNER-only member role changes and last-owner protection

### 4.3 Idempotency

Already in place:

- Invite accept idempotent when already accepted
- Invite decline idempotent when already declined
- League challenge link-match idempotent when same match already linked

### 4.4 Data constraints

Already enforced:

- Unique membership (`leagueId`, `userId`)
- Unique invite token
- Unique active challenge pair per league (partial index)
- Unique standings snapshot version per league

Recommended (not DB-enforced yet):

- Partial unique pending invite per (`leagueId`, `invitedUserId`) where `status='pending'`
- Partial unique pending invite per (`leagueId`, lower(`invitedEmail`)) where `status='pending'`
- These are currently enforced at service level only

### 4.5 Performance indexes

Already present and relevant:

- `match_results(leagueId)`
- `match_results(status, matchType, playedAt)`
- `league_members(leagueId)` and unique (`leagueId`, userId)
- `league_standings_snapshots(leagueId)` and unique (`leagueId`, version)
- `league_activity(leagueId, createdAt desc)`
- `league_challenges` indexes by `leagueId`, participants, `status`, `expiresAt`, `matchId`

Potential additions if traffic grows:

- Partial pending invites indexes described above

Added now for pending confirmations:

- Partial index on `match_results(leagueId, createdAt desc)` where `status='pending_confirm'`

## 5) Error code matrix

Representative typed errors currently emitted by league APIs:

| Endpoint                                                      |  Status | Code                                                                   |
| ------------------------------------------------------------- | ------: | ---------------------------------------------------------------------- |
| `POST /leagues`                                               |     400 | `LEAGUE_NAME_REQUIRED`                                                 |
| `POST /leagues`                                               |     400 | `LEAGUE_DATES_REQUIRED`                                                |
| `POST /leagues`                                               |     400 | `LEAGUE_INVALID_DATES`                                                 |
| `GET /leagues`                                                |     500 | `LEAGUES_UNAVAILABLE`                                                  |
| `GET/PATCH/DELETE /leagues/:id` and most league scoped routes |     404 | `LEAGUE_NOT_FOUND`                                                     |
| Member-protected league routes                                |     403 | `LEAGUE_FORBIDDEN`                                                     |
| `GET /leagues/invites/:token`                                 |     404 | `INVITE_INVALID`                                                       |
| Invite accept/decline                                         |     403 | `INVITE_FORBIDDEN`                                                     |
| Invite accept/decline                                         | 400/409 | `INVITE_ALREADY_USED`                                                  |
| Invite accept/decline                                         |     400 | `INVITE_EXPIRED`                                                       |
| `DELETE /leagues/:id`                                         |     409 | `LEAGUE_DELETE_HAS_MATCHES`                                            |
| `DELETE /leagues/:id`                                         |     409 | `LEAGUE_DELETE_HAS_MEMBERS`                                            |
| `PATCH /leagues/:id/members/:memberId/role`                   |     404 | `MEMBER_NOT_FOUND`                                                     |
| `PATCH /leagues/:id/members/:memberId/role`                   |     400 | `LAST_OWNER`                                                           |
| `GET /public/leagues/:id/standings`                           |     403 | `LEAGUE_SHARE_INVALID_TOKEN`                                           |
| League challenge create                                       |     409 | `CHALLENGE_ALREADY_ACTIVE`                                             |
| League challenge actions                                      |     400 | `CHALLENGE_INVALID_STATE` / `CHALLENGE_EXPIRED`                        |
| League challenge actions                                      |     403 | `CHALLENGE_FORBIDDEN`                                                  |
| League match/report                                           |     400 | `LEAGUE_NOT_ACTIVE` / `LEAGUE_MEMBERS_MISSING` / `MATCH_INVALID_SCORE` |
| League match/report                                           |     409 | `MATCH_ALREADY_REPORTED`                                               |

## 6) State transitions (text diagrams)

League:

- `DRAFT -> ACTIVE -> FINISHED`
- API list projection: `DRAFT => UPCOMING`

Invite:

- `PENDING -> ACCEPTED`
- `PENDING -> DECLINED`
- `PENDING -> EXPIRED`
- repeated `ACCEPTED` accept is idempotent
- repeated `DECLINED` decline is idempotent

League challenge:

- `PENDING -> ACCEPTED -> COMPLETED`
- `PENDING -> DECLINED`
- `PENDING or ACCEPTED -> EXPIRED`

League match result:

- `SCHEDULED -> CONFIRMED` (submit result)
- `PENDING_CONFIRM -> CONFIRMED` (participant/admin confirm)
- `PENDING_CONFIRM -> REJECTED`
- `CONFIRMED -> DISPUTED -> RESOLVED`

## 7) Contract stability targets

Critical contract keys validated by e2e tests:

- `GET /leagues` list item keys
- `GET /leagues/:id` detail keys
- `GET /leagues/:id/standings` keys
- Invite accept/decline response keys
- Member role update response keys

## 8) Observability / Domain Events

### 8.1 Request correlation

- Every HTTP request receives a backend-generated or forwarded `requestId`
- Accepted incoming headers:
  - `x-request-id`
  - `x-railway-request-id`
- The backend echoes `x-request-id` in the response when available
- Structured logs emitted from matches, leagues, and notifications include `requestId`
- Important infrastructure-mapped errors include `errorId` and `requestId` when available

### 8.2 Domain telemetry emitted

The backend emits structured internal telemetry logs for:

- `league_match_reported`
- `league_match_confirmed`
- `league_match_rejected`
- `league_pending_confirmation_fetched`
- `inbox_pending_confirmation_opened`
- `league_standings_recomputed`
- `league_standings_snapshot_persisted`

Recommended metadata captured per event when applicable:

- `requestId`
- `userId`
- `leagueId`
- `matchId`
- `confirmationId`
- `durationMs`
- `totalRows`
- `snapshotVersion`
- `outcome`

### 8.3 Canon vs legacy

Canonical league pending confirmation shape:

- `teams`
- `participants`
- `score.summary`
- `score.sets`

Legacy compatibility retained:

- `sets` is still returned on league pending confirmations for older clients
- `sets` is deprecated and mirrors `score.sets`
