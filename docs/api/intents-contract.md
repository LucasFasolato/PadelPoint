# Match Intents API Contract (v1)

Last updated: 2026-02-27

This document defines:

- `GET /me/intents`
- `POST /me/intents/direct`
- `POST /me/intents/open`
- `POST /me/intents/find-partner`

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

## POST /me/intents/direct

Creates a direct intent against a concrete opponent.

### Body

```json
{
  "opponentUserId": "uuid",
  "mode": "COMPETITIVE",
  "message": "Jugamos?",
  "leagueId": "uuid (optional)"
}
```

### Response

```json
{
  "item": {
    "id": "uuid",
    "sourceType": "CHALLENGE",
    "intentType": "DIRECT",
    "mode": "COMPETITIVE",
    "status": "PENDING",
    "createdAt": "2026-02-28T10:00:00.000Z",
    "cta": { "primary": "Ver", "href": "/challenges/uuid" }
  }
}
```

## POST /me/intents/open

Creates an open intent to find opponents.

### Body

```json
{
  "mode": "FRIENDLY",
  "category": "7ma",
  "expiresInHours": 72,
  "leagueId": "uuid (optional)"
}
```

`expiresInHours` is clamped to `1..168`.

### Response

```json
{
  "item": {
    "id": "uuid",
    "sourceType": "OPEN_CHALLENGE",
    "intentType": "FIND_OPPONENT",
    "mode": "FRIENDLY",
    "status": "PENDING",
    "createdAt": "2026-02-28T10:00:00.000Z",
    "expiresAt": "2026-03-03T10:00:00.000Z",
    "cta": { "primary": "Ver", "href": "/challenges/uuid" }
  }
}
```

## POST /me/intents/find-partner

Creates a find-partner intent.

### Body

```json
{
  "mode": "COMPETITIVE",
  "message": "Busco companero para jugar esta semana",
  "expiresInHours": 48,
  "leagueId": "uuid (optional)"
}
```

`expiresInHours` is clamped to `1..168`.

### Response

```json
{
  "item": {
    "id": "uuid",
    "sourceType": "OPEN_CHALLENGE",
    "intentType": "FIND_PARTNER",
    "mode": "COMPETITIVE",
    "status": "PENDING",
    "createdAt": "2026-02-28T10:00:00.000Z",
    "expiresAt": "2026-03-02T10:00:00.000Z",
    "cta": { "primary": "Ver", "href": "/challenges/uuid" }
  }
}
```

### Resilience rules

- Always returns `200` with `{ items: [] }` when no data.
- If one source fails internally, that source is skipped and remaining sources are still returned.
- Mapping is null-safe for missing optional relations/fields.

### Typed errors

- `OPPONENT_REQUIRED` (`400`): direct creation without `opponentUserId`.
- `INVALID_MODE` (`400`): mode must be `COMPETITIVE|FRIENDLY`.
- `ALREADY_ACTIVE` (`409`): duplicate active intent for same type+mode (and same opponent for direct).
- `LEAGUE_FORBIDDEN` (`403`): provided `leagueId` exists but caller is not a member.
