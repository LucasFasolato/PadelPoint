# Insights API Contract (v1)

Last updated: 2026-02-28

This document defines:

- `GET /me/insights`

Endpoint requires JWT auth.

## GET /me/insights

Returns a compact summary for the authenticated user based on confirmed matches only.

### Query params

- `timeframe` (optional): `LAST_30D | CURRENT_SEASON` (default: `CURRENT_SEASON`)
- `mode` (optional): `ALL | COMPETITIVE | FRIENDLY` (default: `ALL`)

### Response shape

```json
{
  "timeframe": "LAST_30D",
  "mode": "ALL",
  "matchesPlayed": 8,
  "wins": 5,
  "losses": 3,
  "winRate": 0.625,
  "eloDelta": 24,
  "currentStreak": 2,
  "bestStreak": 4,
  "lastPlayedAt": "2026-02-27T21:10:00.000Z",
  "mostPlayedOpponent": {
    "name": "Jugador",
    "matches": 3
  },
  "neededForRanking": {
    "required": 4,
    "current": 2,
    "remaining": 2
  }
}
```

### Rules

- Uses only `CONFIRMED` matches.
- For `mode=COMPETITIVE`, uses the same competitive ranking criteria (`matchType=COMPETITIVE` and `impactRanking=true`).
- Empty datasets return `200` with zeroed counters and nullable optional fields.
- If ELO history is unavailable or absent, `eloDelta` is `0`.
- Minimum matches requirement comes from `RANKING_MIN_MATCHES` (default `4`).
- `neededForRanking` is:
  - `{ required, current, remaining }` when `remaining > 0`
  - `null` when `remaining = 0`.
