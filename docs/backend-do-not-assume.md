# Backend Do Not Assume

Date: 2026-03-12

## Frontend warnings

- Do not assume every `/matches` route is owned by `matches-v2`. The public edge is still mixed.
- Do not assume `GET /auth/identities` returns raw identity-table fields. `providerUserId` and `passwordHash` stay internal.
- Do not assume `POST /auth/identities/:id/unlink` can remove the final login method. The backend explicitly rejects unlinking the last remaining identity.
- Do not assume `GET /matches/:id` is a canonical match detail route. It is a legacy `match_results` read.
- Do not assume `GET /matches?challengeId=...` is a search API. It is a compatibility lookup that returns `[]` when `challengeId` is omitted.
- Do not assume `POST /matches/:id/report` exists. As of 2026-03-12, the implemented public report endpoint is `POST /matches`.
- Do not assume dispute open is canonically modeled. `POST /matches/:id/dispute` still resolves through legacy semantics.
- Do not assume admin dispute resolution is fully canonical. `POST /matches/:id/resolve` delegates only for a narrow safe subset.
- Do not assume proposal ids exposed by challenge coordination are canonical ids. Accept/reject can fall back to legacy solely because the public `proposalId` is not safely resolvable.
- Do not assume `POST /challenges/:id/accept` and `PATCH /challenges/:id/accept` act on the same resource. `POST` is for league challenges; `PATCH` is for regular direct challenges.
- Do not assume `legacy=1` is a harmless flag for new clients. It intentionally switches ownership and response shape.
- Do not assume all admin-looking booking routes are platform-admin only. `GET /reports/*`, `GET /reservations/list`, and `GET /availability/rules/court/:courtId` are club-admin/staff surfaces when the club guard passes.
- Do not assume `GET /payments/intents` is interchangeable with club-admin payment tooling. It is still platform-admin only.

## Backend warnings

- Do not route new frontend work to `MatchesService` because it already serves both true legacy routes and bridge fallbacks.
- Do not add new auth identity mutations without keeping the last-identity safety invariant intact.
- Do not remove bridge predicates just because the same ids appear to match in a happy path. Delegation requires exact correlation, not inferred similarity.
- Do not change public response shapes on hybrid routes without checking both the canonical delegate path and the fallback path.
- Do not treat OpenAPI snapshot presence as proof of canonical ownership. The snapshot shows route shape, not runtime delegation.
- Do not widen `/matches/:id/resolve` semantics without first modeling admin override behavior inside canonical lifecycle services.
- Do not infer canonical challenge correlation from league or reservation context. The bridge only treats explicit `legacyChallengeId` matches as safe.
- Do not classify club-admin routes as internal-only purely because they live in `legacy/*` modules. Guard policy and runtime frontend usage both matter.

## Safe default set for frontend

- `GET /matches/me`
- `GET /matches/me/pending-confirmations`
- `GET /challenges/:id/coordination`
- `GET /challenges/:id/messages`
- `POST /matches`
- `PATCH /matches/:id/confirm`
- `PATCH /matches/:id/reject`

Use anything outside that set only with explicit ownership review.
