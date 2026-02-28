# Rankings + Activity API Contract (v1)

Last updated: 2026-02-28

This document defines the current HTTP contract for:

- `GET /rankings`
- `GET /rankings/scopes`
- `GET /me/activity`

All endpoints require JWT auth.

## Pagination Rules

- `GET /rankings` uses page-based pagination (`page`, `limit`).
- `GET /me/activity` uses cursor-based pagination (`cursor`, `limit`).
- `GET /rankings/scopes` is not paginated.

`/rankings` and `/me/activity` should not be mixed:

- `page` is ignored by `/me/activity`.
- `cursor` is ignored by `/rankings`.

---

## GET /rankings

### Query params

- `scope` (optional): `COUNTRY` | `PROVINCE` | `CITY` (default: `COUNTRY`)
- `provinceCode` (required when `scope=PROVINCE`): `AR-S`, `S`, etc.
- `cityId` (preferred when `scope=CITY`): UUID
- `cityName` (fallback when `scope=CITY` and `cityId` missing): text city name; matched case-insensitively after trim + space collapse, together with `provinceCode`
- `category` (optional): `7ma`, `6ta`, `all`, etc. (default: `all`)
- `timeframe` (optional): `CURRENT_SEASON` | `LAST_90D` (default: `CURRENT_SEASON`)
- `mode` (optional): `COMPETITIVE` | `FRIENDLY` | `ALL` (default: `COMPETITIVE`)
- `page` (optional): int >= 1 (default: `1`)
- `limit` (optional): int 1..200 (default: `50`)

### Response shape

```json
{
  "items": [
    {
      "position": 1,
      "userId": "uuid",
      "displayName": "string",
      "rating": 1320,
      "elo": 1295,
      "category": 7,
      "categoryKey": "7ma",
      "matchesPlayed": 24,
      "wins": 17,
      "losses": 7,
      "draws": 0,
      "points": 51,
      "setsDiff": 20,
      "gamesDiff": 64,
      "movementType": "UP",
      "deltaPositions": 2,
      "oldPosition": 3,
      "opponentAvgElo": 1278.4
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 213,
    "totalPages": 11,
    "scope": "PROVINCE",
    "provinceCode": "AR-S",
    "cityId": null,
    "category": "7ma",
    "timeframe": "CURRENT_SEASON",
    "mode": "COMPETITIVE",
    "asOfDate": "2026-02-27",
    "computedAt": "2026-02-27T03:00:03.221Z"
  },
  "my": {
    "position": 8,
    "deltaPositions": 1,
    "movementType": "UP",
    "rating": 1268,
    "elo": 1240,
    "category": 7,
    "categoryKey": "7ma",
    "matchesPlayed": 19,
    "wins": 12,
    "losses": 7,
    "draws": 0,
    "points": 36,
    "setsDiff": 10,
    "gamesDiff": 22,
    "eligible": true,
    "required": 4,
    "current": 19,
    "remaining": 0
  }
}
```

### Meaning of `my` and movement fields

- `my`: current authenticated user snapshot inside the same leaderboard filters.
  - If the user is below the minimum required matches (`RANKING_MIN_MATCHES`, default `4`), `my` is returned as:
    - `{ position: null, eligible: false, required, current, remaining }`
  - If the user is eligible and present in leaderboard rows, `my.position` is numeric and `eligible=true`.
  - `null` means no row can be resolved for the user in current filters.
- Eligibility is evaluated against the same confirmed match set used to compute ranking rows (same `scope`, `category`, `timeframe`, and `mode` filters).
- Leaderboard `items` include only eligible users (`matchesPlayed >= RANKING_MIN_MATCHES`).
- `deltaPositions`:
  - positive => user moved up (`oldPosition - newPosition > 0`)
  - negative => user moved down
  - `0` => unchanged
  - `null` => no previous snapshot position
- `movementType`: `UP` | `DOWN` | `SAME` | `NEW`.

### Example 1: province leaderboard

```json
{
  "items": [
    {
      "position": 1,
      "userId": "3c20f6ad-2a84-4fca-b068-0f897ed58f0a",
      "displayName": "Lucia M",
      "rating": 1334,
      "elo": 1308,
      "category": 7,
      "categoryKey": "7ma",
      "matchesPlayed": 28,
      "wins": 19,
      "losses": 9,
      "draws": 0,
      "points": 57,
      "setsDiff": 26,
      "gamesDiff": 73,
      "movementType": "UP",
      "deltaPositions": 1,
      "oldPosition": 2,
      "opponentAvgElo": 1289.5
    }
  ],
  "meta": {
    "page": 1,
    "limit": 1,
    "total": 134,
    "totalPages": 134,
    "scope": "PROVINCE",
    "provinceCode": "AR-S",
    "cityId": null,
    "category": "7ma",
    "timeframe": "CURRENT_SEASON",
    "mode": "COMPETITIVE",
    "asOfDate": "2026-02-27",
    "computedAt": "2026-02-27T03:00:03.221Z"
  },
  "my": {
    "position": 12,
    "deltaPositions": -2,
    "movementType": "DOWN",
    "rating": 1241,
    "elo": 1229,
    "category": 7,
    "categoryKey": "7ma",
    "matchesPlayed": 20,
    "wins": 11,
    "losses": 9,
    "draws": 0,
    "points": 33,
    "setsDiff": 7,
    "gamesDiff": 9
  }
}
```

### Example 2: city leaderboard with ineligible `my`

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "scope": "CITY",
    "provinceCode": "AR-S",
    "cityId": "30000000-0000-4000-8000-000000000001",
    "category": "6ta",
    "timeframe": "LAST_90D",
    "mode": "COMPETITIVE",
    "asOfDate": "2026-02-27",
    "computedAt": "2026-02-27T09:02:40.555Z"
  },
  "my": {
    "position": null,
    "eligible": false,
    "required": 4,
    "current": 1,
    "remaining": 3
  }
}
```

### Example 3: country, all categories

```json
{
  "items": [
    {
      "position": 1,
      "userId": "9d985f8a-4e6d-4de0-a88b-ebf73e2f0a75",
      "displayName": "A. Torres",
      "rating": 1651,
      "elo": 1622,
      "category": 3,
      "categoryKey": "all",
      "matchesPlayed": 31,
      "wins": 23,
      "losses": 8,
      "draws": 0,
      "points": 69,
      "setsDiff": 30,
      "gamesDiff": 88,
      "movementType": "SAME",
      "deltaPositions": 0,
      "oldPosition": 1,
      "opponentAvgElo": 1595.3
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 520,
    "totalPages": 26,
    "scope": "COUNTRY",
    "provinceCode": null,
    "cityId": null,
    "category": "all",
    "timeframe": "CURRENT_SEASON",
    "mode": "ALL",
    "asOfDate": "2026-02-27",
    "computedAt": "2026-02-27T03:00:01.010Z"
  },
  "my": null
}
```

### Error codes

- `INVALID_SCOPE`: `scope` is not `COUNTRY|PROVINCE|CITY`.
- `PROVINCE_REQUIRED`: `scope=PROVINCE` with missing/invalid `provinceCode`.
- `CITY_REQUIRED`: `scope=CITY` with missing/invalid location filter (`cityId` or `cityName + provinceCode`).
- `INVALID_TIMEFRAME`: timeframe outside `CURRENT_SEASON|LAST_90D`.
- `INVALID_MODE`: mode outside `COMPETITIVE|FRIENDLY|ALL`.

Plus standard:

- `400` validation errors (`limit`, `page`, malformed query types)
- `401` unauthorized

---

## GET /rankings/scopes

Returns scopes available for current user context.

### Response shape

```json
{
  "items": [
    { "scope": "COUNTRY" },
    { "scope": "PROVINCE", "provinceCode": "AR-S" },
    {
      "scope": "CITY",
      "cityId": "30000000-0000-4000-8000-000000000001",
      "cityName": "Rosario"
    }
  ]
}
```

### Example 1: full scope availability

```json
{
  "items": [
    { "scope": "COUNTRY" },
    { "scope": "PROVINCE", "provinceCode": "AR-S" },
    {
      "scope": "CITY",
      "cityId": "30000000-0000-4000-8000-000000000001",
      "cityName": "Rosario"
    }
  ]
}
```

### Example 2: user without city configured

```json
{
  "items": [{ "scope": "COUNTRY" }]
}
```

### Example 3: only province known

```json
{
  "items": [
    { "scope": "COUNTRY" },
    { "scope": "PROVINCE", "provinceCode": "AR-X" }
  ]
}
```

### Error codes

- `401` unauthorized

---

## GET /me/activity

Compact user activity feed (user + global cards), ordered newest first.

### Query params

- `cursor` (optional): opaque cursor from previous response (`nextCursor`)
- `limit` (optional): int 1..50 (default: `20`)

### Response shape

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "RANKING_MOVEMENT",
      "title": "You moved up 2 positions",
      "body": "Now ranked #8",
      "metadata": {
        "snapshotId": "uuid",
        "deltaPositions": 2,
        "oldPosition": 10,
        "newPosition": 8,
        "rating": 1268,
        "scope": "PROVINCE",
        "category": "7ma",
        "link": "/rankings"
      },
      "createdAt": "2026-02-27T03:00:04.111Z",
      "isGlobal": false
    }
  ],
  "nextCursor": "2026-02-27T03:00:04.111Z|uuid"
}
```

### Example 1: first page with mixed cards

```json
{
  "items": [
    {
      "id": "0dbf6ac2-f6ad-404f-b196-bcd521dc6e25",
      "type": "RANKING_MOVEMENT",
      "title": "You moved up 3 positions",
      "body": "Now ranked #12",
      "metadata": {
        "snapshotId": "local-seed-snapshot",
        "deltaPositions": 3,
        "oldPosition": 15,
        "newPosition": 12,
        "rating": 1310,
        "scope": "PROVINCE",
        "category": "7ma",
        "link": "/rankings"
      },
      "createdAt": "2026-02-27T03:02:00.000Z",
      "isGlobal": false
    },
    {
      "id": "29eb5e69-7f3d-42da-a97d-862406f73b0f",
      "type": "RANKING_SNAPSHOT_PUBLISHED",
      "title": "Ranking snapshots published",
      "body": "12 snapshot(s) generated",
      "metadata": {
        "runId": "fd05296e-7af3-4f67-b7d3-1f1669f0b8e4",
        "insertedSnapshots": 12,
        "movementEvents": 188
      },
      "createdAt": "2026-02-27T03:00:05.000Z",
      "isGlobal": true
    }
  ],
  "nextCursor": "2026-02-27T03:00:05.000Z|29eb5e69-7f3d-42da-a97d-862406f73b0f"
}
```

### Example 2: cursor page

```json
{
  "items": [
    {
      "id": "4e8fd66f-e9aa-42de-940d-bce9aa5f8e8b",
      "type": "MATCH_CONFIRMED",
      "title": "Match confirmed",
      "body": "A player confirmed the match result.",
      "metadata": {
        "matchId": "seed-match",
        "leagueId": null,
        "challengeId": null,
        "link": "/matches/seed-match"
      },
      "createdAt": "2026-02-27T02:59:00.000Z",
      "isGlobal": false
    }
  ],
  "nextCursor": null
}
```

### Example 3: empty feed

```json
{
  "items": [],
  "nextCursor": null
}
```

### Error codes

- `400` invalid cursor/limit query format
- `401` unauthorized
