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
  "neededForRanking": null
}
```

### Rules

- Uses only `CONFIRMED` matches.
- Empty datasets return `200` with zeroed counters and nullable optional fields.
- If ELO history is unavailable or absent, `eloDelta` is `0`.
- `neededForRanking` is `null` unless explicit ranking entry requirements are defined.
