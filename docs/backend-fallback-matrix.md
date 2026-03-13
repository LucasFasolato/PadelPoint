# Backend Fallback Matrix

Date: 2026-03-12

This matrix captures the runtime delegation boundary for the public matches and challenge-coordination edge.

| Endpoint | Public entrypoint | Canonical delegate | Delegates when | Fallback target | Observable response contract |
| --- | --- | --- | --- | --- | --- |
| `GET /matches/me` | `MatchesController.getMyMatches()` | `MatchesV2BridgeService.listMyMatches()` | default path | `MatchesService.getMyMatches()` only when `legacy=1` | default `{ items, nextCursor }`, compatibility plain array with `legacy=1` |
| `GET /matches/me/pending-confirmations` | `MatchesController.getPendingConfirmations()` | `MatchesV2BridgeService.listPendingConfirmations()` | default path | `MatchesService.getPendingConfirmations()` only when `legacy=1` | always `MyPendingConfirmationsResponseDto` on the default path |
| `POST /matches` | `MatchesController.report()` | `MatchResultLifecycleService.reportResult()` through bridge | exact `legacyChallengeId` correlation exists and canonical match preserves `legacyMatchResultId` | `MatchesService.reportMatch()` | legacy-shaped match result object |
| `PATCH /matches/:id/confirm` | `MatchesController.confirm()` | `MatchResultLifecycleService.confirmResult()` through bridge | exact `legacyMatchResultId` correlation exists | `MatchesService.confirmMatch()` | legacy-shaped match result object |
| `PATCH /matches/:id/reject` | `MatchesController.reject()` | `MatchResultLifecycleService.rejectResult()` through bridge | exact `legacyMatchResultId` correlation exists | `MatchesService.rejectMatch()` | legacy-shaped match result object |
| `POST /matches/:id/dispute` | `MatchesController.dispute()` | none today | never | `MatchesService.disputeMatch()` | plain `{ dispute, matchStatus }` |
| `POST /matches/:id/resolve` | `MatchesController.resolve()` | `MatchResultLifecycleService.resolveDispute()` through bridge | exact `legacyMatchResultId` correlation, supported resolution, canonical open dispute, and admin is also a canonical participant | `MatchesService.resolveDispute()` | plain `{ dispute, matchStatus, resolution }` |
| `GET /challenges/:id/coordination` | `ChallengesController.getCoordination()` | `MatchQueryService.findByLegacyChallengeId()` through bridge | exact `legacyChallengeId` correlation exists | `ChallengeCoordinationService.getCoordinationState()` | `ChallengeCoordinationResponseDto` |
| `GET /challenges/:id/messages` | `ChallengesController.getMessages()` | canonical `match.messages` through bridge | exact `legacyChallengeId` correlation exists | `ChallengeCoordinationService.listMessages()` | `ChallengeMessageResponseDto[]` |
| `POST /challenges/:id/proposals` | `ChallengesController.createProposal()` | `MatchSchedulingService.createProposal()` through bridge | exact `legacyChallengeId` correlation exists | `ChallengeCoordinationService.createProposal()` | `ChallengeCoordinationResponseDto` |
| `POST /challenges/:id/proposals/:proposalId/accept` | `ChallengesController.acceptProposal()` | `MatchSchedulingService.acceptProposal()` through bridge | exact challenge correlation plus public `proposalId` present in canonical proposal list | `ChallengeCoordinationService.acceptProposal()` | `ChallengeCoordinationResponseDto` |
| `POST /challenges/:id/proposals/:proposalId/reject` | `ChallengesController.rejectProposal()` | `MatchSchedulingService.rejectProposal()` through bridge | exact challenge correlation plus public `proposalId` present in canonical proposal list | `ChallengeCoordinationService.rejectProposal()` | `ChallengeCoordinationResponseDto` |
| `POST /challenges/:id/messages` | `ChallengesController.createMessage()` | `MatchSchedulingService.postMessage()` through bridge | exact `legacyChallengeId` correlation exists | `ChallengeCoordinationService.createMessage()` | `ChallengeMessageResponseDto` |

## Narrow delegation notes

- `POST /matches/:id/dispute` is intentionally a bridge-shaped no-op with respect to canonical writes today. It resolves correlation, then still returns the legacy service path.
- `POST /matches/:id/resolve` is the only disputed-match route that can delegate canonically, and even there the safe subset is small.
- Challenge proposal accept/reject is stricter than challenge proposal create because proposal-id stability is part of the public contract.
- Runtime logs now emit explicit `mode=canonical` vs `mode=legacy` ownership markers for the bridge-backed reads and writes above.

## Practical ownership summary

- Reads safe by default: `GET /matches/me`, `GET /matches/me/pending-confirmations`.
- Writes safe but still hybrid: `POST /matches`, `PATCH /matches/:id/confirm`, `PATCH /matches/:id/reject`.
- Compatibility-only reads: `GET /matches/:id`, `GET /matches?challengeId=...`.
- Compatibility-only dispute open: `POST /matches/:id/dispute`.
- Fragile admin hybrid: `POST /matches/:id/resolve`.

## Non-bridge clarifications from the same runtime reconciliation pass

- `GET /auth/identities` and `POST /auth/identities/:id/unlink` are direct auth-owned routes with no fallback path.
- `GET /reports/*` and `GET /availability/rules/court/:courtId` are direct club-admin/staff routes with no canonical fallback.
- `GET /payments/intents` is direct platform-admin only and should not be treated as a club-admin compatibility surface.
