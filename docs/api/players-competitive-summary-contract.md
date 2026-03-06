# Players — Competitive Summary API Contract (v1)

Last updated: 2026-03-06

This document defines:

- `GET /players/:id/competitive-summary`

Endpoint requires JWT auth.

---

## GET /players/:id/competitive-summary

Returns a compact, UI-ready competitive snapshot for a given player.
Intended for **hover/tap scouting cards** from ranking or player-list views.

Use this endpoint for **scouting compacto / quick preview**. It is not the public full-page profile.

### Positioning vs `competitive-profile`

- `GET /players/:id/competitive-summary` is the compact scouting contract.
- `GET /players/:id/competitive-profile` is the public full-page profile contract.
- Overlap is intentional on identity plus a few competitive indicators (`userId`, `displayName`, `avatarUrl`, `elo`, totals, current streak, `lastPlayedAt`).
- `competitive-summary` is the only one that currently includes `city`, `strengths`, `recentMatches`, `competitive.category`, and `competitive.recentForm`.
- `competitive-profile` is the only one that currently includes `ranking.currentPosition`, `ranking.peakPosition`, `streaks.best`, and `activity.matchesLast30Days`.
- `competitive-profile` is not a superset of `competitive-summary`; clients should choose based on UX intent, not on "more fields".
Aggregates all relevant data in a single request — no need to combine endpoints on the frontend.

### Path params

- `id` (required): UUID of the target player.

### Response shape

```json
{
  "userId": "uuid",
  "displayName": "Lucas Fasolato",
  "avatarUrl": null,
  "city": {
    "id": "uuid",
    "name": "Rosario",
    "provinceCode": "AR-S"
  },
  "competitive": {
    "elo": 1470,
    "category": 4,
    "categoryKey": "4ta",
    "matchesPlayed": 24,
    "wins": 15,
    "losses": 8,
    "draws": 1,
    "winRate": 0.625,
    "currentStreak": {
      "type": "WIN",
      "count": 3
    },
    "recentForm": ["W", "W", "L", "W", "W"]
  },
  "strengths": {
    "topStrength": "TACTICA",
    "endorsementCount": 16,
    "items": [
      { "key": "TACTICA", "count": 8 },
      { "key": "PRECISION", "count": 5 },
      { "key": "DEFENSA", "count": 3 }
    ]
  },
  "recentMatches": [
    {
      "matchId": "uuid",
      "playedAt": "2026-03-05T03:33:03.677Z",
      "result": "WIN",
      "score": {
        "summary": "7-6 6-4",
        "sets": [
          { "a": 7, "b": 6 },
          { "a": 6, "b": 4 }
        ]
      },
      "opponentSummary": "vs Juan Perez + Pedro Garcia",
      "matchType": "COMPETITIVE",
      "impactRanking": true
    }
  ],
  "activity": {
    "lastPlayedAt": "2026-03-05T03:33:03.677Z",
    "isActiveLast7Days": true
  }
}
```

---

## Field semantics

### Top-level

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `userId` | `string` (UUID) | never | Target player id |
| `displayName` | `string \| null` | yes | From `users.displayName` |
| `avatarUrl` | `string \| null` | yes | From `media_assets` (USER_AVATAR, active, latest) |
| `city` | `CityDto \| null` | yes | Null when user has no city linked |
| `competitive` | `CompetitiveStatsDto \| null` | yes | Null when no competitive profile exists |
| `strengths` | `StrengthsSummaryDto` | never | Empty items/0 counts when no endorsements |
| `recentMatches` | `RecentMatchDto[]` | never | Empty array when no confirmed matches |
| `activity` | `ActivitySummaryDto` | never | lastPlayedAt=null when no matches |

### `city`

| Field | Type | Nullable |
|---|---|---|
| `id` | UUID | never |
| `name` | string | never |
| `provinceCode` | string \| null | yes (province may have no code) |

### `competitive`

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `elo` | int | never | Current ELO from `competitive_profiles` |
| `category` | int (1–8) | never | Derived from ELO via `categoryFromElo()` |
| `categoryKey` | string | never | `"1ra"` … `"8va"` |
| `matchesPlayed` | int | never | From `competitive_profiles.matchesPlayed` |
| `wins` | int | never | From profile |
| `losses` | int | never | From profile |
| `draws` | int | never | From profile |
| `winRate` | float (0–1) | never | `wins / matchesPlayed`; 0 when no matches |
| `currentStreak` | `{ type, count } \| null` | yes | Null when no confirmed matches |
| `recentForm` | `("W"\|"L"\|"D")[]` | never | Up to 5 entries, newest first; empty when no matches |

#### `currentStreak`

- `type`: `"WIN"` \| `"LOSS"` \| `"DRAW"`
- `count`: consecutive results of that type from the most recent match backward

#### `recentForm`

- Array of up to 5 characters: `W` (win), `L` (loss), `D` (draw)
- Ordered **newest first** (index 0 = most recent)
- Result is always from the **perspective of the queried player**
- Sourced from the last 5 `CONFIRMED` matches where the player participated

### `strengths`

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `topStrength` | string \| null | yes | Most endorsed strength key; null if no endorsements |
| `endorsementCount` | int | never | Total received strength votes (all-time) |
| `items` | `{ key, count }[]` | never | Sorted DESC by count; empty if none |

This section is fed by post-match endorsements created through `POST /matches/:id/endorsements` and can also be queried directly via `GET /players/:id/strengths`.

Strength keys are `PlayerStrength` enum values: `SMASH`, `BANDEJA`, `VIBORA`, `VOLEA`, `GLOBO`, `DEFENSA`, `RESILIENCIA`, `TACTICA`, `COMUNICACION`, `VELOCIDAD`, `PRECISION`.

### `recentMatches`

Up to 5 most recent `CONFIRMED` matches.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `matchId` | UUID | never | |
| `playedAt` | ISO timestamp | never | Matches with null playedAt are excluded |
| `result` | `"WIN"\|"LOSS"\|"DRAW"` | never | From the queried player's perspective |
| `score.summary` | string | never | E.g. `"7-6 6-4"` |
| `score.sets` | `{ a, b }[]` | never | Empty if no sets recorded |
| `opponentSummary` | string | never | `"vs Name"` or `"vs Name + Name"` for doubles; fallback `"vs Rival"` |
| `matchType` | string | never | `"COMPETITIVE"` \| `"FRIENDLY"` |
| `impactRanking` | bool | never | Whether match affected ELO |

### `activity`

| Field | Type | Nullable |
|---|---|---|
| `lastPlayedAt` | ISO timestamp \| null | yes |
| `isActiveLast7Days` | bool | never |

`isActiveLast7Days` is `true` when `lastPlayedAt` is within the last 7 calendar days.

---

## Error codes

| Code | HTTP | Description |
|---|---|---|
| `PLAYER_NOT_FOUND` | 404 | Target player does not exist |
| — | 401 | Unauthorized (missing or invalid JWT) |
| — | 400 | Invalid UUID in path |

---

## Performance notes

- Executes **3 parallel queries** per request: player data (1 JOIN query), recent matches (1 JOIN query), endorsement strengths (1 aggregation query).
- No N+1 on opponent names — all participant display names are resolved in the match query via LEFT JOINs.
- Avatar resolved via a lateral subquery inside the player data query.

---

## Canon vs nullable contract

All sections always present — none of the top-level keys can be absent.
Sections that lack data degrade gracefully:

- No profile → `competitive: null`
- No city → `city: null`
- No endorsements → `strengths: { topStrength: null, endorsementCount: 0, items: [] }`
- No matches → `recentMatches: []`, `activity.lastPlayedAt: null`, `competitive.recentForm: []`, `competitive.currentStreak: null`
