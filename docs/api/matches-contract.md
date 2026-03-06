# Matches API Contract (v1)

Last updated: 2026-03-06

This document defines the current HTTP contract for:

- `GET /matches/me/pending-confirmations`
- `GET /matches/:id/ranking-impact`
- `POST /matches/:id/endorsements`

All endpoints require JWT auth.

## GET /matches/me/pending-confirmations

Returns matches pending confirmation for the authenticated user.

If no pending confirmations exist, this endpoint returns:

```json
{
  "items": [],
  "nextCursor": null
}
```

### Query params

- `cursor` (optional): opaque cursor from previous response.
- `limit` (optional): int 1..50 (default: `20`).

### Response shape

```json
{
  "items": [
    {
      "id": "uuid",
      "matchId": "uuid",
      "status": "PENDING_CONFIRMATION",
      "opponentName": "string",
      "opponentAvatarUrl": null,
      "leagueId": "uuid",
      "leagueName": "string",
      "playedAt": "2026-02-24T21:15:00.000Z",
      "score": "6-4 6-3",
      "cta": {
        "primary": "Confirmar",
        "href": "/matches/uuid"
      }
    }
  ],
  "nextCursor": "2026-02-24T21:15:00.000Z|uuid"
}
```

### Field guarantees

- `items` is always present and always an array.
- `opponentName` is always a non-empty string. Fallback: `"Rival"`.
- `status` is always `"PENDING_CONFIRMATION"` for this endpoint.
- `cta.primary` is `"Confirmar"` (or `"Ver"` when confirmation action is not available).

### Error behavior

- Expected/normal states do not return `500`.
- Unexpected server failures may return:
  - `500` with:
    - `code`: `PENDING_CONFIRMATIONS_UNAVAILABLE`
    - `message`: stable human-readable message
    - `errorId`: internal trace id for troubleshooting

---

## GET /matches/:id/ranking-impact

Returns the competitive impact of a match from the authenticated participant perspective.

### Access rules

- Only match participants can access this endpoint.
- Non-participants receive `403 MATCH_FORBIDDEN`.

### Response shape

```json
{
  "matchId": "uuid",
  "viewerUserId": "uuid",
  "result": "WIN",
  "eloBefore": 1450,
  "eloAfter": 1470,
  "eloDelta": 20,
  "positionBefore": 16,
  "positionAfter": 14,
  "positionDelta": 2,
  "categoryBefore": 6,
  "categoryAfter": 6,
  "impactRanking": true,
  "summary": {
    "title": "Ganaste y subiste 2 posiciones",
    "subtitle": "+20 ELO despues de este partido"
  }
}
```

### Field semantics

- `eloBefore`, `eloAfter`, `eloDelta` come from `elo_history` when available.
- `impactRanking=false` means the match produced no actual ranking impact for the viewer.
- `positionBefore` / `positionAfter` come from real ranking snapshots when exact context exists.
- If snapshot context is incomplete, position fields return `null` and `positionDelta` falls back to `0`.
- `summary` is UI-ready and intentionally simple.

### Error codes

| Code | HTTP | Description |
|---|---|---|
| `MATCH_NOT_FOUND` | 404 | Match result does not exist |
| `MATCH_FORBIDDEN` | 403 | Authenticated user did not participate in the match |

---

## POST /matches/:id/endorsements

Creates an optional post-match endorsement for one rival from a confirmed match.

Choosing not to endorse is represented by not calling this endpoint.

### Request shape

```json
{
  "toUserId": "uuid",
  "strengths": ["TACTICA", "DEFENSA"]
}
```

### Rules

- `strengths` must contain 1 or 2 enum values from `PlayerStrength`.
- Maximum 2 strengths.
- Only confirmed matches can be endorsed.
- Only match participants can endorse.
- `toUserId` must be a rival from the same match.
- Self-endorsement is not allowed.
- Endorsing your teammate is not allowed.
- In doubles, each rival can be endorsed individually.
- At most one endorsement per `(matchId, fromUserId, toUserId)`.

### Response shape

```json
{
  "id": "uuid",
  "matchId": "uuid",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "strengths": ["TACTICA", "DEFENSA"],
  "createdAt": "2026-03-06T10:00:00.000Z"
}
```

### Error codes

| Code | HTTP | Description |
|---|---|---|
| `MATCH_NOT_FOUND` | 404 | Match result does not exist |
| `ENDORSE_MATCH_NOT_CONFIRMED` | 409 | Match is not confirmed yet |
| `ENDORSE_WINDOW_EXPIRED` | 410 | Post-match endorsement window expired |
| `NOT_PARTICIPANT` | 403 | Caller did not participate in the match |
| `ENDORSE_SELF_NOT_ALLOWED` | 400 | Caller tried to endorse themselves |
| `ENDORSE_TARGET_NOT_PARTICIPANT` | 400 | `toUserId` is not a match participant |
| `ENDORSE_TARGET_NOT_RIVAL` | 403 | `toUserId` is the caller's teammate instead of a rival |
| `ENDORSE_DUPLICATE` | 409 | Endorsement for that rival/match already exists |

### Downstream usage

- Endorsements feed `GET /players/:id/strengths`.
- Aggregated strengths also feed scouting surfaces such as `GET /players/:id/competitive-summary`.
