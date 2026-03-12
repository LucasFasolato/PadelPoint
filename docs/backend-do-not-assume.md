# Backend Do Not Assume

Date: 2026-03-12

## Frontend warnings

- Do not assume every `/matches` route is owned by `matches-v2`. The public edge is still mixed.
- Do not assume `GET /matches/:id` is a canonical match detail route. It is a legacy `match_results` read.
- Do not assume `GET /matches?challengeId=...` is a search API. It is a compatibility lookup that returns `[]` when `challengeId` is omitted.
- Do not assume `POST /matches/:id/report` exists. As of 2026-03-12, the implemented public report endpoint is `POST /matches`.
- Do not assume dispute open is canonically modeled. `POST /matches/:id/dispute` still resolves through legacy semantics.
- Do not assume admin dispute resolution is fully canonical. `POST /matches/:id/resolve` delegates only for a narrow safe subset.
- Do not assume proposal ids exposed by challenge coordination are canonical ids. Accept/reject can fall back to legacy solely because the public `proposalId` is not safely resolvable.
- Do not assume `POST /challenges/:id/accept` and `PATCH /challenges/:id/accept` act on the same resource. `POST` is for league challenges; `PATCH` is for regular direct challenges.
- Do not assume `legacy=1` is a harmless flag for new clients. It intentionally switches ownership and response shape.

## Backend warnings

- Do not route new frontend work to `MatchesService` because it already serves both true legacy routes and bridge fallbacks.
- Do not remove bridge predicates just because the same ids appear to match in a happy path. Delegation requires exact correlation, not inferred similarity.
- Do not change public response shapes on hybrid routes without checking both the canonical delegate path and the fallback path.
- Do not treat OpenAPI snapshot presence as proof of canonical ownership. The snapshot shows route shape, not runtime delegation.
- Do not widen `/matches/:id/resolve` semantics without first modeling admin override behavior inside canonical lifecycle services.
- Do not infer canonical challenge correlation from league or reservation context. The bridge only treats explicit `legacyChallengeId` matches as safe.

## Safe default set for frontend

- `GET /matches/me`
- `GET /matches/me/pending-confirmations`
- `GET /challenges/:id/coordination`
- `GET /challenges/:id/messages`
- `POST /matches`
- `PATCH /matches/:id/confirm`
- `PATCH /matches/:id/reject`

Use anything outside that set only with explicit ownership review.
