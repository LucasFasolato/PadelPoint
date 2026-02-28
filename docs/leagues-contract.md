# League Contract v1

Last updated: 2026-02-28

This document is the source of truth for the current League pillar behavior as implemented today.

Scope:
- League domain inventory (entities, statuses, modes)
- Endpoint inventory and behavior
- League x Intent/Match seams and integration
- Hardening checklist
- Error matrix
- State transitions

Constraints honored by this audit:
- No underlying table changes
- Existing API contracts remain backward compatible

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

5. `league_activity` (`LeagueActivity`)
- Key fields: `id`, `leagueId`, `type`, `actorId`, `entityId`, `payload`, `createdAt`
- Types currently in enum:
  - `match_reported`, `match_confirmed`, `match_disputed`, `match_resolved`
  - `member_joined`, `member_declined`, `settings_updated`
  - `challenge_created`, `challenge_accepted`, `challenge_declined`, `challenge_expired`
  - `rankings_updated`

6. `league_challenges` (`LeagueChallenge`)
- Key fields: `id`, `leagueId`, `createdById`, `opponentId`, `status`, `message`, `expiresAt`, `acceptedAt`, `completedAt`, `matchId`, `createdAt`
- Enums:
  - `status`: `PENDING | ACCEPTED | DECLINED | EXPIRED | COMPLETED`
- Constraints:
  - Partial unique pair index for active challenges (`PENDING`, `ACCEPTED`) per league

7. `match_results` (`MatchResult`) linkage
- `match_results.leagueId` is nullable FK to `leagues`
- `match_results.challengeId` links to generic `challenges`
- League linkage for standings/activity is driven by `match_results.leagueId`

8. Generic `challenges` (`Challenge`) linkage
- No native `leagueId` column in entity/table
- League-scoped challenge lifecycle exists separately in `league_challenges`

### 1.2 Status and lifecycle inventory

League lifecycle (storage):
- `draft -> active -> finished`

League lifecycle (API mapping):
- List API normalizes to uppercase: `UPCOMING | ACTIVE | FINISHED`
- `draft` maps to `UPCOMING`
- Detail API returns lower-case: `upcoming | active | finished`

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

## 2) API inventory and correctness

All endpoints below require JWT auth unless prefixed with `/public`.

### 2.1 League core endpoints

1. `GET /leagues`
- Behavior:
  - Returns caller leagues list
  - Uses safe normalization (mode/status/role), null-safe city/province/activity fields
  - Sets `Cache-Control: no-store`
- Response shape:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Summer League",
      "mode": "SCHEDULED",
      "status": "UPCOMING",
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
  "creatorId": "uuid",
  "isPermanent": false,
  "dateRangeEnabled": true,
  "startDate": "2025-06-01",
  "endDate": "2025-06-30",
  "avatarUrl": null,
  "avatarMediaAssetId": null,
  "status": "upcoming",
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
  - Returns latest rows + movement map

```json
{
  "computedAt": "2026-02-27T18:00:00.000Z",
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

### 3.1 How leagueId is carried today

Current behavior:
- League-scoped challenge intent is represented by `league_challenges.leagueId`
- Match linkage is represented by `match_results.leagueId`
- Generic `challenges` entity/table has no first-class `leagueId`

Seam:
- `MatchesService.reportMatch` still attempts to read `challenge.leagueId` via loose cast.
- This is a contract smell because `Challenge` does not persist `leagueId` in schema.

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
- Public standings never leak emails and tolerate missing snapshots

Audit risk:
- Status/mode casing differs across endpoints (`UPPERCASE` list vs `lowercase` detail)
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
- Composite on `match_results(leagueId, status, playedAt)` for heavy standings/history scans
- Partial pending invites indexes described above

## 5) Error code matrix

Representative typed errors currently emitted by league APIs:

| Endpoint | Status | Code |
|---|---:|---|
| `POST /leagues` | 400 | `LEAGUE_NAME_REQUIRED` |
| `POST /leagues` | 400 | `LEAGUE_DATES_REQUIRED` |
| `POST /leagues` | 400 | `LEAGUE_INVALID_DATES` |
| `GET/PATCH/DELETE /leagues/:id` and most league scoped routes | 404 | `LEAGUE_NOT_FOUND` |
| Member-protected league routes | 403 | `LEAGUE_FORBIDDEN` |
| `GET /leagues/invites/:token` | 404 | `INVITE_INVALID` |
| Invite accept/decline | 403 | `INVITE_FORBIDDEN` |
| Invite accept/decline | 400/409 | `INVITE_ALREADY_USED` |
| Invite accept/decline | 400 | `INVITE_EXPIRED` |
| `DELETE /leagues/:id` | 409 | `LEAGUE_DELETE_HAS_MATCHES` |
| `DELETE /leagues/:id` | 409 | `LEAGUE_DELETE_HAS_MEMBERS` |
| `PATCH /leagues/:id/members/:memberId/role` | 404 | `MEMBER_NOT_FOUND` |
| `PATCH /leagues/:id/members/:memberId/role` | 400 | `LAST_OWNER` |
| `GET /public/leagues/:id/standings` | 403 | `LEAGUE_SHARE_INVALID_TOKEN` |
| League challenge create | 409 | `CHALLENGE_ALREADY_ACTIVE` |
| League challenge actions | 400 | `CHALLENGE_INVALID_STATE` / `CHALLENGE_EXPIRED` |
| League challenge actions | 403 | `CHALLENGE_FORBIDDEN` |
| League match/report | 400 | `LEAGUE_NOT_ACTIVE` / `LEAGUE_MEMBERS_MISSING` / `MATCH_INVALID_SCORE` |
| League match/report | 409 | `MATCH_ALREADY_REPORTED` |

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