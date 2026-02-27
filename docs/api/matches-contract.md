# Matches API Contract (v1)

Last updated: 2026-02-27

This document defines the current HTTP contract for:

- `GET /matches/me/pending-confirmations`

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
