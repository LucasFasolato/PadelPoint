# Inbox API Contract (v1)

Last updated: 2026-03-06

This document defines:

- `GET /me/inbox`
- `GET /me/notifications`
- `POST /me/notifications/:id/read`
- `POST /me/notifications/read-all`

All endpoints require JWT auth.

## GET /me/inbox

Aggregates actionable cards from multiple sources:

- pending confirmations
- challenges
- invites
- notifications

### Query params

- `limit` (optional): int 1..50 (default: `20`)

### Response shape

```json
{
  "pendingConfirmations": {
    "items": [
      {
        "id": "uuid",
        "matchId": "uuid",
        "leagueId": "uuid",
        "leagueName": "Liga Verano",
        "playedAt": "2026-02-20T21:00:00.000Z",
        "status": "PENDING_CONFIRMATION",
        "teams": {
          "teamA": { "player1Id": "uuid", "player2Id": null },
          "teamB": { "player1Id": "uuid", "player2Id": null }
        },
        "participants": [
          {
            "userId": "uuid",
            "displayName": "Jugador A",
            "avatarUrl": null
          },
          {
            "userId": "uuid",
            "displayName": "Jugador B",
            "avatarUrl": null
          }
        ],
        "score": {
          "summary": "6-4 6-3",
          "sets": [
            { "a": 6, "b": 4 },
            { "a": 6, "b": 3 }
          ]
        },
        "scoreSummary": "6-4 6-3",
        "opponentName": "Rival",
        "opponentAvatarUrl": null,
        "cta": {
          "primary": "Confirmar",
          "href": "/leagues/uuid?tab=partidos&confirm=uuid"
        }
      }
    ]
  },
  "challenges": {
    "items": [
      {
        "id": "uuid",
        "type": "DIRECT",
        "status": "PENDING",
        "opponentName": "Jugador",
        "message": "Jugamos?",
        "updatedAt": "2026-02-26T18:10:00.000Z",
        "cta": { "primary": "Responder", "href": "/challenges/uuid" }
      }
    ]
  },
  "invites": {
    "items": [
      {
        "id": "uuid",
        "leagueId": "uuid",
        "leagueName": "Liga Otono",
        "status": "PENDING",
        "expiresAt": "2026-03-03T00:00:00.000Z",
        "cta": { "primary": "Ver", "href": "/leagues/invites/token" }
      }
    ]
  },
  "notifications": {
    "items": [
      {
        "id": "uuid",
        "type": "challenge.received",
        "title": "New challenge",
        "body": "A player challenged you.",
        "readAt": null,
        "createdAt": "2026-02-27T02:00:00.000Z",
        "data": { "challengeId": "uuid" }
      }
    ]
  }
}
```

### Partial availability rules

- The endpoint returns `200` even when one or more sections fail internally.
- Failed sections return:

```json
{
  "items": [],
  "error": {
    "code": "SECTION_UNAVAILABLE_CODE",
    "errorId": "uuid"
  }
}
```

Possible section-level error codes:

- `PENDING_CONFIRMATIONS_UNAVAILABLE`
- `CHALLENGES_UNAVAILABLE`
- `INVITES_UNAVAILABLE`
- `NOTIFICATIONS_UNAVAILABLE`

### Pending confirmation guarantees

- `teams`, `participants`, and `score` follow the same canon used by league match cards.
- `score.sets` is always present as an array.
- `opponentName` and `scoreSummary` remain as derived legacy helpers for old clients.

## GET /me/notifications

Thin wrapper over user notifications feed.

### Query params

- `cursor` (optional): ISO datetime cursor
- `limit` (optional): int 1..50 (default: `20`)

### Response shape

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "system",
      "title": "System",
      "body": null,
      "data": null,
      "readAt": null,
      "createdAt": "2026-02-27T02:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

## POST /me/notifications/:id/read

Marks one notification as read.

### Response

```json
{ "ok": true }
```

## POST /me/notifications/read-all

Marks all unread notifications as read.

### Response

```json
{ "updated": 3 }
```
