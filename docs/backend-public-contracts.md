# Backend Public Contracts

Date: 2026-03-12

## Canonical ownership

- Internal source of truth for match lifecycle is `matches-v2`.
- Public HTTP ownership is still hybrid at the controller boundary.
- `MatchesController` and `ChallengesController` are compatibility edges, not pure canonical controllers.

## Classification legend

- `SAFE`: stable public contract used by frontend.
- `HYBRID`: public route delegates through a bridge and may fall back.
- `LEGACY`: public route is owned by pre-v2 services or projections.
- `FRAGILE`: shape or ownership depends on narrow predicates and should not be expanded casually.

## Endpoint audit

| Class | Method | Path | Controller | Service | Internal owner | Request DTO | Response DTO | Fallback behavior | Compatibility notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SAFE` | `POST` | `/challenges/direct` | `ChallengesController` | `ChallengesService.createDirect()` | legacy/core challenges | `CreateDirectChallengeDto` | plain challenge view | none | Regular direct challenge flow |
| `SAFE` | `POST` | `/challenges/open` | `ChallengesController` | `ChallengesService.createOpen()` | legacy/core challenges | `CreateOpenChallengeDto` | plain challenge view | none | Regular open challenge flow |
| `SAFE` | `GET` | `/challenges/open` | `ChallengesController` | `ChallengesService.listOpen()` | legacy/core challenges | `ListOpenQueryDto` | plain challenge array | none | City-filtered list |
| `SAFE` | `GET` | `/challenges/inbox` | `ChallengesController` | `ChallengesService.inbox()` | legacy/core challenges | none | plain challenge array | none | Current inbox contract |
| `SAFE` | `GET` | `/challenges/outbox` | `ChallengesController` | `ChallengesService.outbox()` | legacy/core challenges | none | plain challenge array | none | Current outbox contract |
| `SAFE` | `GET` | `/challenges/:id` | `ChallengesController` | `ChallengesService.getById()` | legacy/core challenges | none | plain challenge detail | none | Not part of matches-v2 coordination bridge |
| `HYBRID` | `GET` | `/challenges/:id/coordination` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.getCoordinationState()` | bridge | none | `ChallengeCoordinationResponseDto` | Falls back to `ChallengeCoordinationService.getCoordinationState()` when exact `legacyChallengeId` correlation is missing | Public DTO is stable even when owner changes |
| `HYBRID` | `GET` | `/challenges/:id/messages` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.listMessages()` | bridge | none | `ChallengeMessageResponseDto[]` | Falls back to `ChallengeCoordinationService.listMessages()` when exact correlation is missing | Stable message DTO, mixed backing store |
| `HYBRID` | `POST` | `/challenges/:id/proposals` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.createProposal()` | bridge | `CreateChallengeProposalDto` | `ChallengeCoordinationResponseDto` | Falls back to `ChallengeCoordinationService.createProposal()` when exact correlation is missing | Canonical write only when safe |
| `HYBRID` | `POST` | `/challenges/:id/proposals/:proposalId/accept` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.acceptProposal()` | bridge | none | `ChallengeCoordinationResponseDto` | Falls back to `ChallengeCoordinationService.acceptProposal()` when public `proposalId` is not resolvable canonically | Public proposal ids are still compatibility-sensitive |
| `HYBRID` | `POST` | `/challenges/:id/proposals/:proposalId/reject` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.rejectProposal()` | bridge | none | `ChallengeCoordinationResponseDto` | Falls back to `ChallengeCoordinationService.rejectProposal()` when public `proposalId` is not resolvable canonically | Same proposal-id constraint |
| `HYBRID` | `POST` | `/challenges/:id/messages` | `ChallengesController` | `ChallengesV2CoordinationBridgeService.createMessage()` | bridge | `CreateChallengeMessageDto` | `ChallengeMessageResponseDto` | Falls back to `ChallengeCoordinationService.createMessage()` when exact correlation is missing | Public DTO is stable |
| `SAFE` | `PATCH` | `/challenges/:id/accept` | `ChallengesController` | `ChallengesService.acceptDirect()` | legacy/core challenges | none | plain challenge view | none | Direct challenge accept only |
| `SAFE` | `PATCH` | `/challenges/:id/reject` | `ChallengesController` | `ChallengesService.rejectDirect()` | legacy/core challenges | none | plain challenge view | none | Direct challenge reject only |
| `SAFE` | `PATCH` | `/challenges/:id/cancel` | `ChallengesController` | `ChallengesService.cancel()` | legacy/core challenges | none | plain challenge view | none | Direct challenge cancel |
| `SAFE` | `PATCH` | `/challenges/:id/accept-open` | `ChallengesController` | `ChallengesService.acceptOpen()` | legacy/core challenges | none | plain challenge view | none | Open challenge accept |
| `SAFE` | `PATCH` | `/challenges/:id/cancel-open` | `ChallengesController` | `ChallengesService.cancelOpen()` | legacy/core challenges | none | plain challenge view | none | Open challenge cancel |
| `SAFE` | `POST` | `/challenge-invites` | `ChallengeInvitesController` | `ChallengeInvitesService.inviteTeammate()` | legacy/core challenges | inline `{ challengeId, userId }` | plain invite view | none | Adjacent to challenge lifecycle |
| `SAFE` | `GET` | `/challenge-invites/inbox` | `ChallengeInvitesController` | `ChallengeInvitesService.inbox()` | legacy/core challenges | query `status?` | plain invite array | none | Adjacent to challenge lifecycle |
| `SAFE` | `GET` | `/challenge-invites/outbox` | `ChallengeInvitesController` | `ChallengeInvitesService.outbox()` | legacy/core challenges | query `status?` | plain invite array | none | Adjacent to challenge lifecycle |
| `SAFE` | `PATCH` | `/challenge-invites/:id/accept` | `ChallengeInvitesController` | `ChallengeInvitesService.acceptInvite()` | legacy/core challenges | none | plain invite view | none | Adjacent to challenge lifecycle |
| `SAFE` | `PATCH` | `/challenge-invites/:id/reject` | `ChallengeInvitesController` | `ChallengeInvitesService.rejectInvite()` | legacy/core challenges | none | plain invite view | none | Adjacent to challenge lifecycle |
| `SAFE` | `PATCH` | `/challenge-invites/:id/cancel` | `ChallengeInvitesController` | `ChallengeInvitesService.cancelInvite()` | legacy/core challenges | none | plain invite view | none | Adjacent to challenge lifecycle |
| `SAFE` | `POST` | `/leagues/:leagueId/challenges` | `LeagueChallengesController` | `LeagueChallengesService.createChallenge()` | legacy/core leagues | `CreateLeagueChallengeDto` | plain league-challenge view | none | Canonical for league challenge creation |
| `SAFE` | `GET` | `/leagues/:leagueId/challenges` | `LeagueChallengesController` | `LeagueChallengesService.listChallenges()` | legacy/core leagues | `ListLeagueChallengesQueryDto` | plain league-challenge list | none | League challenge list |
| `SAFE` | `POST` | `/challenges/:id/accept` | `LeagueChallengeActionsController` | `LeagueChallengesService.acceptChallenge()` | legacy/core leagues | none | plain league-challenge view | none | League challenge action, not the same resource as `PATCH /challenges/:id/accept` |
| `SAFE` | `POST` | `/challenges/:id/decline` | `LeagueChallengeActionsController` | `LeagueChallengesService.declineChallenge()` | legacy/core leagues | none | plain league-challenge view | none | League challenge action |
| `SAFE` | `POST` | `/challenges/:id/link-match` | `LeagueChallengeActionsController` | `LeagueChallengesService.linkMatch()` | legacy/core leagues | `LinkLeagueChallengeMatchDto` | plain league-challenge view | none | Links a completed match to a league challenge |
| `HYBRID` | `GET` | `/matches/me` | `MatchesController` | `MatchesV2BridgeService.listMyMatches()` | bridge with canonical default | query `legacy?` | default `MatchListResponseDto`, compatibility array with `legacy=1` | `legacy=1` routes to `MatchesService.getMyMatches()` | Frontend-safe default route |
| `HYBRID` | `GET` | `/matches/me/pending-confirmations` | `MatchesController` | `MatchesV2BridgeService.listPendingConfirmations()` | bridge with canonical default | `PendingConfirmationsQueryDto` plus query `legacy?` | `MyPendingConfirmationsResponseDto` | `legacy=1` routes to `MatchesService.getPendingConfirmations()` | Frontend-safe default route |
| `HYBRID` | `POST` | `/matches` | `MatchesController` | `MatchesV2BridgeService.reportResult()` | bridge | `ReportMatchDto` | legacy-shaped match result object | Falls back to `MatchesService.reportMatch()` when safe legacy correlation does not preserve the public result id | Actual report endpoint; there is no `/matches/:id/report` route |
| `HYBRID` | `PATCH` | `/matches/:id/confirm` | `MatchesController` | `MatchesV2BridgeService.confirmResult()` | bridge | none | legacy-shaped match result object | Falls back to `MatchesService.confirmMatch()` when `legacyMatchResultId` correlation is not exact | Frontend-safe default route |
| `LEGACY` | `PATCH` | `/matches/:id/admin-confirm` | `MatchesController` | `MatchesService.adminConfirmMatch()` | legacy matches | none | legacy match result object | none | League-admin override semantics are explicitly legacy |
| `HYBRID` | `PATCH` | `/matches/:id/reject` | `MatchesController` | `MatchesV2BridgeService.rejectResult()` | bridge | `RejectMatchDto` | legacy-shaped match result object | Falls back to `MatchesService.rejectMatch()` when `legacyMatchResultId` correlation is not exact | Frontend-safe default route |
| `LEGACY` | `POST` | `/matches/:id/dispute` | `MatchesController` | `MatchesV2BridgeService.openDispute()` | bridge entry, legacy runtime owner | `DisputeMatchDto` | plain `{ dispute, matchStatus }` | Bridge currently always falls back to `MatchesService.disputeMatch()` | Public contract is still legacy |
| `FRAGILE` | `POST` | `/matches/:id/resolve` | `MatchesController` | `MatchesV2BridgeService.resolveDispute()` | hybrid admin path | `ResolveDisputeDto` | plain `{ dispute, matchStatus, resolution }` | Falls back to `MatchesService.resolveDispute()` unless exact canonical subset is satisfied | Admin-only and narrow |
| `LEGACY` | `POST` | `/matches/:id/resolve-confirm-as-is` | `MatchesController` | `MatchesService.resolveConfirmAsIs()` | legacy matches | none | plain legacy resolution object | none | Explicitly kept out of matches-v2 |
| `SAFE` | `GET` | `/matches/:id/ranking-impact` | `MatchesController` | `MatchesService.getRankingImpact()` | legacy read model | none | `MatchRankingImpactResponseDto` | none | Stable DTO-backed route |
| `LEGACY` | `GET` | `/matches/:id` | `MatchesController` | `MatchesService.getById()` | legacy matches | none | legacy match-result detail object | none; legacy is the primary owner | Not a canonical matches-v2 detail route |
| `LEGACY` | `GET` | `/matches?challengeId=...` | `MatchesController` | `MatchesService.getByChallenge()` | legacy matches | query `challengeId?` | `[]` when missing, otherwise legacy match-result detail object | Returns `[]` immediately when query is omitted | Compatibility lookup only |
| `SAFE` | `GET` | `/leagues/:leagueId/matches` | `LeagueMatchesController` | `MatchesService.listLeagueMatches()` | legacy matches + leagues | none | `LeagueMatchResponseDto[]` | none | Active league contract |
| `SAFE` | `GET` | `/leagues/:leagueId/pending-confirmations` | `LeagueMatchesController` | `MatchesService.getLeaguePendingConfirmations()` | legacy matches + leagues | `PendingConfirmationsQueryDto` | `LeaguePendingConfirmationsResponseDto` | none | League-specific pending confirmations |
| `SAFE` | `POST` | `/leagues/:leagueId/pending-confirmations/:confirmationId/confirm` | `LeagueMatchesController` | `MatchesService.confirmLeaguePendingConfirmation()` | legacy matches + leagues | none | `ConfirmLeaguePendingConfirmationResponseDto` | none | Canonical league confirm path |
| `LEGACY` | `PATCH` | `/leagues/:leagueId/pending-confirmations/:confirmationId/confirm` | `LeagueMatchesController` | `MatchesService.confirmLeaguePendingConfirmation()` | legacy matches + leagues | none | `ConfirmLeaguePendingConfirmationResponseDto` | none | Deprecated PATCH alias |
| `SAFE` | `POST` | `/leagues/:leagueId/pending-confirmations/:confirmationId/reject` | `LeagueMatchesController` | `MatchesService.rejectLeaguePendingConfirmation()` | legacy matches + leagues | `RejectLeaguePendingConfirmationDto` | `RejectLeaguePendingConfirmationResponseDto` | none | Canonical league reject path |
| `LEGACY` | `PATCH` | `/leagues/:leagueId/pending-confirmations/:confirmationId/reject` | `LeagueMatchesController` | `MatchesService.rejectLeaguePendingConfirmation()` | legacy matches + leagues | `RejectLeaguePendingConfirmationDto` | `RejectLeaguePendingConfirmationResponseDto` | none | Deprecated PATCH alias |
| `SAFE` | `POST` | `/leagues/:leagueId/matches` | `LeagueMatchesController` | `MatchesService.createLeagueMatch()` | legacy matches + leagues | `CreateLeagueMatchDto` | plain league match view | none | League-specific match creation |
| `SAFE` | `PATCH` | `/leagues/:leagueId/matches/:matchId/result` | `LeagueMatchesController` | `MatchesService.submitLeagueMatchResult()` | legacy matches + leagues | `SubmitLeagueMatchResultDto` | plain league match view | none | Runtime still tolerates legacy body form |
| `SAFE` | `GET` | `/leagues/:leagueId/eligible-reservations` | `LeagueMatchesController` | `MatchesService.getEligibleReservations()` | legacy matches + leagues | none | plain reservation list | none | League tooling surface |
| `SAFE` | `POST` | `/leagues/:leagueId/report-from-reservation` | `LeagueMatchesController` | `MatchesService.reportFromReservation()` | legacy matches + leagues | `ReportFromReservationDto` | plain match view | none | League tooling surface |
| `SAFE` | `POST` | `/leagues/:leagueId/report-manual` | `LeagueMatchesController` | `MatchesService.reportManual()` | legacy matches + leagues | `ReportManualDto` | plain match view | none | League tooling surface |

## Contract closure for ambiguous routes

| Endpoint | Canonical source of truth | Should delegate to matches-v2? | Fallback logic if legacy data exists | Closure decision |
| --- | --- | --- | --- | --- |
| `GET /matches/:id` | legacy `match_results` via `MatchesService.getById()` | No | None. Legacy service is the primary owner and enriches the projection with action flags. | Keep as legacy compatibility route. Do not present as canonical. |
| `GET /matches?challengeId=...` | legacy `match_results` via `MatchesService.getByChallenge()` | No | None. Missing query short-circuits to `[]`; found rows come straight from legacy projection. | Keep as legacy lookup route only. |
| `POST /matches/:id/dispute` | public contract is legacy even though lifecycle truth exists canonically | No, not today | Always falls back to `MatchesService.disputeMatch()` because canonical dispute-open semantics do not match the public contract. | Freeze as legacy until semantics are aligned. |
| `POST /matches/:id/resolve` | canonical for a narrow safe subset, legacy otherwise | Yes, but only narrowly | Fallback to `MatchesService.resolveDispute()` when no exact `legacyMatchResultId` correlation, unsupported resolution, no canonical open dispute, or admin is not a canonical participant. | Keep as fragile hybrid route and document the narrow delegation predicate. |

## OpenAPI reconciliation

- Bootstrap is in `src/main.ts`, which calls `setupOpenApi(app)` from `src/openapi/openapi.ts`.
- Runtime Swagger is mounted at `/docs` and JSON at `/docs-json`.
- `openapi.snapshot.json` is broadly aligned on route presence for the matches/challenges surface.
- The main drift is semantic, not routing:
  - Snapshot does not encode bridge ownership or fallback predicates.
  - `GET /matches` is documented in the snapshot with required `challengeId`, but the controller makes it optional and returns `[]` when omitted.
  - Several challenge coordination operations and ambiguous matches operations historically had empty response schemas; controller-level Swagger annotations should be treated as the source of truth once the snapshot is regenerated.
  - There is no `POST /matches/:id/report` route in controllers or snapshot; the implemented public report route is `POST /matches`.
