# Players - Competitive Profile API Contract (v1)

Last updated: 2026-03-06

This document defines:

- `GET /players/:id/competitive-profile`

Endpoint requires JWT auth.

---

## GET /players/:id/competitive-profile

Returns a deeper competitive profile for a given player.

Use this endpoint for **perfil publico completo / full page**.

### Positioning vs `competitive-summary`

- `GET /players/:id/competitive-profile` is the public full-page profile contract.
- `GET /players/:id/competitive-summary` is the compact scouting contract for cards and quick previews.
- Overlap is intentional on `userId`, `displayName`, `avatarUrl`, `elo`, career totals, current streak, and `lastPlayedAt`.
- `competitive-profile` is the only one that currently includes ranking positions, best streak, and 30-day activity volume.
- `competitive-summary` remains the source for compact scouting widgets that need strengths, recent form, or recent match previews.
- `competitive-profile` is not a superset of `competitive-summary`.

### Path params

- `id` (required): UUID of the target player.

### Response shape

```json
{
  "userId": "uuid",
  "displayName": "Lucas Fasolato",
  "avatarUrl": "https://cdn.test/avatar.png",
  "career": {
    "matchesPlayed": 124,
    "wins": 82,
    "losses": 39,
    "draws": 3,
    "winRate": 0.6613
  },
  "ranking": {
    "currentPosition": 14,
    "peakPosition": 9,
    "elo": 1470
  },
  "streaks": {
    "current": { "type": "WIN", "count": 3 },
    "best": { "type": "WIN", "count": 7 }
  },
  "activity": {
    "lastPlayedAt": "2026-03-05T03:33:03.677Z",
    "matchesLast30Days": 8
  }
}
```

### Semantics

- `career` comes from `competitive_profiles`.
- `ranking.currentPosition` and `ranking.peakPosition` are derived from global
  country/all/current-season/competitive snapshots, using the same minimum-match
  visibility rule as rankings.
- `streaks` are derived from confirmed `match_results` from the player's
  perspective.
- `activity.matchesLast30Days` counts confirmed matches with `playedAt` inside
  the last 30 days.

### Error codes

| Code | HTTP | Description |
|---|---|---|
| `PLAYER_NOT_FOUND` | 404 | Target player does not exist |
| - | 401 | Unauthorized |
| - | 400 | Invalid UUID in path |
