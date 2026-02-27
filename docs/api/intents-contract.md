# Match Intents API Contract (v1)

Last updated: 2026-02-27

This document defines:

- `GET /me/intents`

Endpoint requires JWT auth.

## GET /me/intents

Unified facade over existing intent sources:

- direct/open challenges
- pending match confirmations
- challenge partner invites

No schema/table changes are required.

### Query params

- `status` (optional): `ACTIVE | HISTORY` (default: `ACTIVE`)
- `type` (optional): `ALL | DIRECT | OPEN | FIND_PARTNER | FIND_OPPONENT` (default: `ALL`)
- `mode` (optional): `ALL | COMPETITIVE | FRIENDLY` (default: `ALL`)

### Response shape

```json
{
  "items": [
    {
      "id": "uuid",
      "sourceType": "CHALLENGE",
      "intentType": "DIRECT",
      "mode": "COMPETITIVE",
      "status": "PENDING",
      "createdAt": "2026-02-27T10:00:00.000Z",
      "expiresAt": null,
      "myRole": "INVITEE",
      "opponentName": "Jugador",
      "partnerName": null,
      "location": {
        "cityName": "Cordoba",
        "provinceCode": "X"
      },
      "matchId": null,
      "cta": {
        "primary": "Aceptar",
        "href": "/challenges/uuid"
      }
    }
  ]
}
```

### Resilience rules

- Always returns `200` with `{ items: [] }` when no data.
- If one source fails internally, that source is skipped and remaining sources are still returned.
- Mapping is null-safe for missing optional relations/fields.
