# Backend Current State

Date: 2026-03-12

This snapshot describes the backend state that is actually implemented in the current repository at `HEAD` (`9f6769b` on `staging`), reconciled against the available contract docs and the recent `matches-v2` handoff material.

## Overview

- NestJS monolith with 22 feature modules wired in [`src/app.module.ts`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/app.module.ts).
- Global HTTP bootstrap in [`src/main.ts`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/main.ts): CORS, cookies, `OriginCsrfGuard`, global `ValidationPipe`, Swagger bootstrapped at `/docs` and `/docs-json`.
- `matches-v2` exists as an internal canonical module for match lifecycle, coordination, and read models, but it does not expose public controllers directly.
- The public HTTP edge for matches and challenge coordination remains hybrid:
  - `MatchesController` delegates selected reads and writes through [`MatchesV2BridgeService`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches/services/matches-v2-bridge.service.ts).
  - `ChallengesController` delegates coordination reads/writes through [`ChallengesV2CoordinationBridgeService`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/challenges/services/challenges-v2-coordination-bridge.service.ts).
  - Several public routes still fall back to legacy `MatchesService` / `ChallengeCoordinationService`.
- OpenAPI is present in repo as `openapi.snapshot.json`. Controller-vs-snapshot comparison shows only two conditional Apple OAuth routes missing from the default snapshot.

## Current Ownership

| Domain / flow | Current owner in code | Public edge | Notes |
| --- | --- | --- | --- |
| Auth | `AuthService`, `RefreshTokenService`, `OAuthService`, `PasswordResetService` | `/auth/*` | Apple routes are conditionally registered by `AuthModule.register()` |
| Users | `UsersService` | `/users/*`, `/me/profile`, `/admin/users/*` | Search + player profile + admin role management |
| Challenges core | `ChallengesService`, `ChallengeInvitesService` | `/challenges/*`, `/challenge-invites/*` | Direct/open challenge lifecycle remains legacy/core challenge code |
| Challenge coordination | `ChallengesV2CoordinationBridgeService` + `ChallengeCoordinationService` fallback | `/challenges/:id/coordination`, `/messages`, `/proposals*` | Hybrid; canonical only when exact `legacyChallengeId` correlation exists |
| Matches legacy/public edge | `MatchesController`, `LeagueMatchesController`, `MatchesService`, `MatchesV2BridgeService` | `/matches/*`, `/leagues/*matches*` | Mixed canonical delegation and legacy ownership |
| Matches canonical internal lifecycle | `MatchQueryService`, `MatchSchedulingService`, `MatchResultLifecycleService`, `MatchEffectsService` | none directly | Internal source of truth for lifecycle state |
| Leagues | `LeaguesService`, `LeagueStandingsService`, `LeagueActivityService`, `LeagueChallengesService` | `/leagues/*`, `/public/leagues/*`, some `/challenges/*` actions | Mostly self-contained, but depends on legacy `match_results` projection |
| Notifications | `UserNotificationsService`, `InboxService`, `ActivityFeedService`, `NotificationsGateway` | `/notifications/*`, `/me/inbox`, `/me/activity`, `/health`, WS `/notifications` | HTTP is mostly stable; websocket contract is present but not a canonized match-domain contract |
| Rankings | `RankingsService`, `RankingsSnapshotSchedulerService` | `/rankings/*` | Daily cron + admin-triggerable run endpoint |
| Players | `PlayersService`, `PlayerCompetitiveSummaryService`, `PlayerCompetitiveProfileService` | `/players/*`, `/players/me/*` | Stable DTO-backed controllers |
| Intents | `MatchIntentsService` | `/me/intents*` | DTO-backed |
| Insights | `InsightsService` | `/me/insights` | DTO-backed |
| Endorsements | `MatchEndorsementsService` | `/matches/:matchId/endorsements`, `/players/:userId/strengths*`, `/me/reputation` | Stable DTO-backed |
| Booking / reservations | `ReservationsService`, `AvailabilityService`, `AgendaService`, `PaymentsService` | `/reservations/*`, `/availability/*`, `/clubs/:clubId/agenda/*`, `/payments/*` | Legacy booking stack still fully active |
| Admin / ops | Users admin, notifications admin, auth bootstrap, rankings manual run, availability cleanup | `/admin/*`, `/auth/bootstrap-admin`, `/rankings/snapshots/run`, `/availability/admin/cleanup-duplicates` | Mixed RBAC and operational endpoints |

## Module Map

| Module | Controllers | Main providers | Key entities / repositories | Notes |
| --- | --- | --- | --- | --- |
| `AuthModule` | `AuthController`, `AuthGoogleController`, optional `AuthAppleController`, `AuthPasswordController`, `AuthAdminBootstrapController` | `AuthService`, `RefreshTokenService`, `OAuthService`, `PasswordResetService`, strategies | `AuthIdentity`, `RefreshToken`, `PasswordResetToken` | Dynamic module; Apple route registration depends on env |
| `UsersModule` | `UsersController`, `UsersAdminController`, `MeProfileController` | `UsersService` | `User` | Shared by auth/players/challenges |
| `ChallengesModule` | `ChallengesController`, `ChallengeInvitesController` | `ChallengesService`, `ChallengeCoordinationService`, `ChallengesV2CoordinationBridgeService`, `ChallengeInvitesService` | `Challenge`, `ChallengeInvite`, `ChallengeMessage`, `ChallengeScheduleProposal`, `MatchResult`, `User`, `Club`, `Court` | Hybrid coordination layer lives here |
| `MatchesModule` | `MatchesController`, `LeagueMatchesController` | `MatchesService`, `MatchesV2BridgeService` | `MatchResult`, `MatchDispute`, `MatchAuditLog`, `Challenge`, `League`, `LeagueMember`, `Reservation`, `Court` | Public `/matches` edge still lands here |
| `MatchesV2Module` | none | `MatchQueryService`, `MatchSchedulingService`, `MatchResultLifecycleService`, `MatchEffectsService` | `Match`, `MatchProposal`, `MatchMessage`, `MatchDispute`, `MatchAuditEvent` | Internal canonical aggregate module |
| `LeaguesModule` | `LeaguesController`, `PublicLeaguesController`, `LeagueChallengesController`, `LeagueChallengeActionsController` | `LeaguesService`, `LeagueStandingsService`, `LeagueActivityService`, `LeagueChallengesService` | `League`, `LeagueMember`, `LeagueInvite`, `LeagueActivity`, `LeagueStandingsReadModel`, `LeagueStandingsSnapshot`, `LeagueChallenge`, `LeagueJoinRequest`, `MatchResult` | League challenge action routes share `/challenges/*` namespace |
| `NotificationsModule` | `UserNotificationsController`, `NotificationsAdminController`, `MeInboxController`, `MeActivityController`, `HealthController` | `NotificationsService`, `NotificationService`, `NotificationEventsService`, `UserNotificationsService`, `ActivityFeedService`, `InboxService`, `NotificationsGateway` | `Notification`, `NotificationEvent`, `UserNotification`, plus league/match/challenge relations | Owns only notifications websocket namespace |
| `PlayersModule` | `PlayersPublicController`, `PlayersMeProfileController`, `PlayersFavoritesController` | `PlayersService`, `PlayerCompetitiveSummaryService`, `PlayerCompetitiveProfileService` | `User`, `PlayerProfile`, `PlayerFavorite`, geo entities | DTO-backed |
| `RankingsModule` | `RankingsController` | `RankingsService`, `RankingsSnapshotSchedulerService` | `GlobalRankingSnapshot`, `RankingSnapshotRun`, `UserNotification`, `MatchResult`, `User`, `Challenge` | Includes scheduled snapshot job |
| `IntentsModule` | `MeIntentsController` | `MatchIntentsService` | `Challenge`, `MatchResult`, `ChallengeInvite`, `LeagueMember` | Read/write intent surface |
| `InsightsModule` | `MeInsightsController` | `InsightsService` | `MatchResult`, `EloHistory` | Read-only |
| `EndorsementsModule` | `MatchEndorsementsController`, `PlayerStrengthsController`, `MeReputationController` | `MatchEndorsementsService` | `MatchResult`, `MatchEndorsement`, `User` | Read/write post-match endorsements |
| `CompetitiveModule` | `CompetitiveController`, `CompetitiveOnboardingCompatController` | `CompetitiveService`, `EloService` | `CompetitiveProfile`, `EloHistory`, `MatchResult`, `Challenge`, `PlayerProfile`, `PlayerFavorite`, geo entities | Contains both canonical and deprecated compat endpoints |
| `MediaModule` | `MediaController`, `PublicMediaController` | `MediaService` | `MediaAsset`, `Court`, `ClubMember` | Media registry + public fetches |
| `ReservationsModule` | `ReservationsController`, `PublicReservationsController`, `MeReservationsController` | `ReservationsService`, `ExpireHoldsCron` | `Reservation`, `Court`, `ClubMember` | Legacy booking core |
| `PaymentsModule` | `PaymentsController` | `PaymentsService`, `PaymentsCron` | `PaymentIntent`, `PaymentTransaction`, `PaymentEvent`, `EventLog`, `Reservation` | Legacy payments stack |
| `AvailabilityModule` | `AvailabilityController` | `AvailabilityService` | `CourtAvailabilityRule`, `CourtAvailabilityOverride`, `Court`, `ClubMember` | Legacy availability admin |
| `AgendaModule` | `AgendaController` | `AgendaService` | `Court`, `Reservation`, `CourtAvailabilityOverride` | Legacy club agenda |
| `ClubsModule` | `ClubsController`, `PublicClubsController` | `ClubsService` | `Club`, `Court`, `MediaAsset`, `ClubMember` | Legacy clubs |
| `CourtsModule` | `CourtsController`, `PublicCourtsController` | `CourtsService` | `Court`, `Club`, `ClubMember`, `Reservation` | Legacy courts |
| `ClubMembersModule` | `ClubMembersController` | `ClubMembersService`, `ClubAccessGuard` | `ClubMember`, `Court` | Legacy club membership/admin |
| `ReportsModule` | `ReportsController` | `ReportsService` | `Reservation`, `Court`, `ClubMember` | Legacy reporting/backoffice |

## Controller Map

| Controller | Base path | Internal owner(s) | Notes |
| --- | --- | --- | --- |
| `MatchesController` | `/matches` | `MatchesService`, `MatchesV2BridgeService` | Most important hybrid HTTP edge |
| `LeagueMatchesController` | `/leagues/...matches...` | `MatchesService` | League match/report/pending-confirmation surface |
| `ChallengesController` | `/challenges` | `ChallengesService`, `ChallengesV2CoordinationBridgeService` | Mixed direct/open challenges plus coordination hybrid |
| `LeagueChallengeActionsController` | `/challenges` | `LeagueChallengesService` | Shares `/challenges/:id/*` namespace with generic challenges |
| `LeaguesController` | `/leagues` | `LeaguesService`, `LeagueStandingsService`, `LeagueActivityService` | Largest controller surface in repo |
| `UserNotificationsController` | `/notifications` | `UserNotificationsService` | Canonical notification feed/inbox endpoints |
| `MeInboxController` | `/me` | `InboxService`, `UserNotificationsService` | Deprecated inbox/feed aliases still live |
| `NotificationsAdminController` | `/admin/notifications` | `NotificationEventsService` | Admin-only |
| `AuthController` | `/auth` | `AuthService`, `RefreshTokenService`, `UsersService` | Cookie-based auth |
| `AuthGoogleController` / `AuthAppleController` | `/auth/google*`, `/auth/apple*` | `OAuthService`, `AuthService`, optionally `UsersService` | Redirect/callback flows |
| `AuthAdminBootstrapController` | `/auth/bootstrap-admin` | `UsersService` | Operational/admin bootstrapping route |
| `RankingsController` | `/rankings` | `RankingsService`, `RankingsSnapshotSchedulerService` | Includes admin manual snapshot trigger |

## Matches / Challenges Contract Snapshot

### Public routes considered frontend-safe today

These routes are implemented and currently have the strongest evidence of deliberate support:

| Endpoint | Actual owner | Current path behavior |
| --- | --- | --- |
| `GET /matches/me` | `MatchesV2BridgeService` by default, `MatchesService` with `legacy=1` | Hybrid read; default returns `{ items, nextCursor }` |
| `GET /matches/me/pending-confirmations` | `MatchesV2BridgeService` by default, `MatchesService` with `legacy=1` | Hybrid read; bridge adapts canonical `MatchResponseDto` into `MyPendingConfirmationsResponseDto` |
| `GET /challenges/:id/coordination` | `ChallengesV2CoordinationBridgeService` | Hybrid; delegates to canonical only with exact challenge correlation |
| `GET /challenges/:id/messages` | `ChallengesV2CoordinationBridgeService` | Same as above |
| `POST /challenges/:id/proposals` | `ChallengesV2CoordinationBridgeService` | Hybrid write; canonical only when exact correlated match exists |
| `POST /challenges/:id/messages` | `ChallengesV2CoordinationBridgeService` | Hybrid write; same delegation rule |
| `POST /matches` | `MatchesV2BridgeService` | Hybrid write; canonical report only when stable legacy correlation preserves public ids |
| `PATCH /matches/:id/confirm` | `MatchesV2BridgeService` | Hybrid write; canonical only when exact legacy result correlation exists |
| `PATCH /matches/:id/reject` | `MatchesV2BridgeService` | Hybrid write; canonical subset with legacy fallback |

### Explicitly legacy / fragile routes still active

| Endpoint | Actual owner | Current path behavior |
| --- | --- | --- |
| `GET /matches/:id` | `MatchesService` | Legacy detail response over `match_results` |
| `GET /matches?challengeId=...` | `MatchesService` | Legacy lookup; returns `[]` when query missing |
| `POST /matches/:id/dispute` | `MatchesV2BridgeService`, but always falls back to `MatchesService` | Public contract remains legacy today |
| `POST /matches/:id/resolve` | `MatchesV2BridgeService` with narrow canonical subset, else legacy | Fragile hybrid admin path |
| `PATCH /matches/:id/admin-confirm` | `MatchesService` | Explicitly legacy/admin-owned |
| `POST /matches/:id/resolve-confirm-as-is` | `MatchesService` | Explicitly legacy/admin-owned |

## Observed DTO / Response Shapes For Critical Flows

### `GET /matches/me`

- Controller: [`MatchesController.getMyMatches`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches/controllers/matches.controller.ts)
- Default response: [`MatchListResponseDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches-v2/dto/match-list-response.dto.ts)
  - `items: MatchResponseDto[]`
  - `nextCursor: string | null`
- Legacy compatibility mode: `legacy=1` returns the legacy array from `MatchesService.getMyMatches()`.
- Observable canonical item shape: [`MatchResponseDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches-v2/dto/match-response.dto.ts)

### `GET /matches/me/pending-confirmations`

- Controller advertises [`MyPendingConfirmationsResponseDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches/dto/my-pending-confirmation.dto.ts).
- Default owner is `MatchesV2BridgeService.listPendingConfirmations()`.
- Bridge maps canonical `MatchResponseDto` into legacy-compatible `MyPendingConfirmationItemDto`:
  - `id`
  - `matchId`
  - `status: "PENDING_CONFIRMATION"`
  - `opponentName`
  - `opponentAvatarUrl`
  - `leagueId`
  - `leagueName`
  - `playedAt`
  - `score`
  - `cta { primary, href }`

### `GET /challenges/:id/coordination`

- Public DTO: [`ChallengeCoordinationResponseDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/challenges/dto/challenge-coordination-response.dto.ts)
- Observable fields:
  - `challengeId`
  - `challengeStatus`
  - `coordinationStatus`
  - `matchType`
  - `matchId`
  - `participants[]`
  - `opponent`
  - `acceptedSchedule`
  - `pendingProposal`
  - `proposals[]`
  - `messages[]`
- Canonical read path uses `MatchResponseDto` proposals/messages; fallback path uses `ChallengeCoordinationService.loadCoordinationState()` and returns the same public DTO.

### `GET /challenges/:id/messages`

- Public DTO: `ChallengeMessageResponseDto[]`
- Bridge delegates to:
  - canonical `match.messages` mapped through `toMessageDto()`, or
  - legacy `ChallengeCoordinationService.listMessages()`

### `POST /challenges/:id/proposals`

- Request DTO: [`CreateChallengeProposalDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/challenges/dto/create-challenge-proposal.dto.ts)
- Response DTO: `ChallengeCoordinationResponseDto`
- Canonical write delegates to `MatchSchedulingService.createProposal()`, then re-reads coordination state.
- Legacy fallback delegates to `ChallengeCoordinationService.createProposal()`.

### `POST /challenges/:id/messages`

- Request DTO: [`CreateChallengeMessageDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/challenges/dto/create-challenge-message.dto.ts)
- Response DTO: `ChallengeMessageResponseDto`
- Canonical write delegates to `MatchSchedulingService.postMessage()`, then hydrates via bridged read.
- Legacy fallback delegates to `ChallengeCoordinationService.createMessage()`.

### `POST /matches`

- Request DTO: [`ReportMatchDto`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches/dto/report-match.dto.ts)
- Bridge delegates to canonical report only when correlated canonical match also preserves the observable legacy result id; otherwise it falls back to `MatchesService.reportMatch()`.
- Response is legacy-shaped plain object, not `MatchResponseDto`. Bridge adapter emits fields like:
  - `id`
  - `challengeId`
  - `leagueId`
  - `scheduledAt`
  - `playedAt`
  - `teamASet1..teamBSet3`
  - `winnerTeam`
  - `status`
  - `matchType`
  - `impactRanking`
  - `reportedByUserId`
  - `confirmedByUserId`
  - `rejectionReason`
  - `eloApplied`
  - `rankingImpact`
  - `source`
  - `createdAt`
  - `updatedAt`

### `PATCH /matches/:id/confirm`

- Request body: none
- Bridge attempts canonical `MatchResultLifecycleService.confirmResult()` only when exact `legacyMatchResultId` correlation exists.
- Response remains legacy-shaped match result plain object via bridge adapter.

### `PATCH /matches/:id/reject`

- Request DTO: `RejectMatchDto`
- Canonical subset maps to `MatchRejectionReasonCode.OTHER` plus optional message.
- Response remains legacy-shaped match result plain object via bridge adapter.

### `GET /matches/:id`

- Owner: `MatchesService.getById()`
- Response: legacy `match_results` entity plus:
  - normalized `matchType`
  - computed `impactRanking`
  - action flags from `buildMatchActionFlags(...)`
- No `matches-v2` DTO is returned here.

### `GET /matches?challengeId=...`

- Owner: `MatchesService.getByChallenge()`
- Returns `[]` when `challengeId` is missing.
- Returns legacy match result detail when found, including normalized `matchType` and `impactRanking`.

### `POST /matches/:id/dispute`

- Request DTO: `DisputeMatchDto`
- Public behavior today is legacy even though it enters `MatchesV2BridgeService`.
- Legacy response shape:
  - `dispute { id, matchId, reasonCode, message, status, createdAt } | null`
  - `matchStatus`

### `POST /matches/:id/resolve`

- Request DTO: `ResolveDisputeDto`
- Admin-only at controller level.
- Hybrid:
  - canonical only for narrow subset where admin is also canonical participant and open dispute mapping is safe
  - otherwise legacy `MatchesService.resolveDispute()`
- Observable response shape:
  - `dispute { id, matchId, status, resolvedAt } | null`
  - `matchStatus`
  - `resolution`

## Gateways And Scheduled Jobs

### Websocket gateway

- [`NotificationsGateway`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/notifications/gateways/notifications.gateway.ts)
  - namespace: `/notifications`
  - JWT-based socket auth via bearer token in handshake/auth header
  - rooms:
    - `user:{userId}`
    - `league:{leagueId}`
  - supported client subscription event:
    - `league:subscribe`
  - observable server events are emitted by services, but there is no consolidated canonical websocket contract for the match domain itself

### Scheduled jobs

- [`ExpireHoldsCron`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/legacy/reservations/expire-holds.cron.ts)
  - every 60s
  - expires reservation holds
  - gated by `ENABLE_CRONS != false`
- [`PaymentsCron`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/legacy/payments/payments.cron.ts)
  - every minute
  - expires pending payment intents and releases reservations
- [`RankingsSnapshotSchedulerService.runScheduledSnapshots()`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/rankings/services/rankings-snapshot-scheduler.service.ts)
  - daily at `03:00:00`
  - timezone defaults to `America/Argentina/Cordoba`

## Legacy <-> Matches-V2 Dependencies

| Dependency seam | Current implementation |
| --- | --- |
| Challenge correlation | `matches_v2.legacy_challenge_id <-> challenges.id` |
| Match result correlation | `matches_v2.legacy_match_result_id <-> match_results.id` |
| `/matches/me` | Controller default delegates to `MatchesV2BridgeService.listMyMatches()`; `legacy=1` uses `MatchesService.getMyMatches()` |
| `/matches/me/pending-confirmations` | Controller default delegates to `MatchesV2BridgeService.listPendingConfirmations()`; `legacy=1` uses `MatchesService.getPendingConfirmations()` |
| Challenge coordination reads | `ChallengesV2CoordinationBridgeService` delegates only when exact challenge correlation is preserved |
| Challenge proposal/message writes | Same bridge; fallback when correlation or public proposal id safety is missing |
| Result reporting / confirm / reject | `MatchesV2BridgeService` delegates only when safe correlation preserves observable legacy ids |
| Dispute open | explicit legacy fallback |
| Dispute resolve | narrow canonical subset; otherwise legacy |
| Effects | canonical `MatchEffectsService` syncs legacy projection only when correlated legacy result exists |

## Fragile Boundaries Observed

- Public `/matches` remains hybrid; source of truth is internal `matches-v2`, but public contracts still frequently adapt back into legacy `match_results` shape.
- `openapi.snapshot.json` is useful for route presence, but it does not encode delegation boundaries, fallback decisions, or source-of-truth ownership.
- Apple OAuth routes are conditional runtime routes and are absent from the default snapshot generated without `APPLE_*` env vars.
- League challenge actions and regular challenge actions share `/challenges/:id/*` namespace with different verbs and different entity owners.
- `GET /matches/:id` and `GET /matches?challengeId=...` are still legacy read surfaces and should not be treated as canonical contracts for EPIC A.
