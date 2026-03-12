# Backend Public Endpoints Inventory

Date: 2026-03-12

## Inventory Notes

- Scope: controller routes currently exposed by the Nest application.
- Route presence vs OpenAPI:
  - `openapi.snapshot.json` is broadly aligned with current controllers.
  - Confirmed default snapshot omissions: `GET /auth/apple`, `POST /auth/apple/callback`.
  - For all other rows below, assume "appears in OpenAPI" unless the `Notes` column says otherwise.
- `Source of truth` means runtime ownership today, not architectural aspiration.
- `Frontend safe to consume?`
  - `yes`: evidence suggests deliberate support and no known bridge/fallback hazard for normal frontend usage.
  - `partial`: usable but deprecated, hybrid, alias, or operationally sensitive.
  - `no`: admin/internal/fragile compatibility surface.

## Core Auth / Users

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/auth/register` | SAFE | `AuthController` | `AuthService` | `RegisterDto` | plain `{ accessToken, user }` | auth | yes | cookie + token response |
| `POST` | `/auth/login` | SAFE | `AuthController` | `AuthService` | `LoginDto` | plain `{ accessToken, user }` | auth | yes | cookie + token response |
| `POST` | `/auth/login-player` | SAFE | `AuthController` | `AuthService` | `LoginDto` | plain `{ accessToken, user }` | auth | yes | player-scoped login path |
| `POST` | `/auth/refresh` | SAFE | `AuthController` | `RefreshTokenService` + `AuthService` | none | plain `{ accessToken, user }` | auth | yes | refresh cookie required |
| `POST` | `/auth/logout` | SAFE | `AuthController` | `RefreshTokenService` | none | plain `{ ok: true }` | auth | yes | clears cookies |
| `GET` | `/auth/me` | SAFE | `AuthController` | JWT auth guard | none | auth user payload | auth | yes | authenticated echo payload |
| `GET` | `/auth/google` | SAFE | `AuthGoogleController` | `OAuthService` | none | redirect | auth/oauth | partial | browser redirect flow |
| `GET` | `/auth/google/callback` | SAFE | `AuthGoogleController` | `OAuthService` + `AuthService` | OAuth callback | redirect | auth/oauth | partial | cookie + redirect |
| `GET` | `/auth/apple` | FRAGILE | `AuthAppleController` | `OAuthService` | none | redirect | auth/oauth | partial | conditional route; absent from default OpenAPI snapshot |
| `POST` | `/auth/apple/callback` | FRAGILE | `AuthAppleController` | `OAuthService` + `AuthService` + `UsersService` | OAuth callback | redirect | auth/oauth | partial | conditional route; absent from default OpenAPI snapshot |
| `POST` | `/auth/password/reset/request` | SAFE | `AuthPasswordController` | `PasswordResetService` | `PasswordResetRequestDto` | `{ ok: true }` | auth | yes | intentionally non-enumerating |
| `POST` | `/auth/password/reset/confirm` | SAFE | `AuthPasswordController` | `PasswordResetService` | `PasswordResetConfirmDto` | `{ ok: true }` | auth | yes | password reset completion |
| `POST` | `/auth/bootstrap-admin` | INTERNAL/ADMIN | `AuthAdminBootstrapController` | `UsersService` | inline `{ key, email }` | `{ ok: true }` | auth/admin | no | bootstrap key required |
| `GET` | `/users/search` | SAFE | `UsersController` | `UsersService` | query `q` | `UserSearchResult[]` | users | yes | auth required |
| `GET` | `/me/profile` | SAFE | `MeProfileController` | `UsersService` | none | player profile plain object | users | yes | player role only |
| `PATCH` | `/me/profile` | SAFE | `MeProfileController` | `UsersService` | `UpdateProfileDto` | player profile plain object | users | yes | player role only |
| `GET` | `/admin/users` | INTERNAL/ADMIN | `UsersAdminController` | `UsersService` | query `email` | user list/plain array | admin/users | no | admin only |
| `PATCH` | `/admin/users/:userId/role` | INTERNAL/ADMIN | `UsersAdminController` | `UsersService` | `UpdateUserRoleDto` | updated user/plain object | admin/users | no | admin only |

## Challenges

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/challenges/direct` | SAFE | `ChallengesController` | `ChallengesService` | `CreateDirectChallengeDto` | challenge plain object | challenges | yes | direct challenge lifecycle |
| `POST` | `/challenges/open` | SAFE | `ChallengesController` | `ChallengesService` | `CreateOpenChallengeDto` | challenge plain object | challenges | yes | open challenge lifecycle |
| `GET` | `/challenges/open` | SAFE | `ChallengesController` | `ChallengesService` | `ListOpenQueryDto` | challenge list/plain array | challenges | yes | filtered by city/category |
| `GET` | `/challenges/inbox` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge list/plain array | challenges | yes | inbox view |
| `GET` | `/challenges/outbox` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge list/plain array | challenges | yes | outbox view |
| `GET` | `/challenges/:id` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge detail/plain object | challenges | yes | generic challenge detail |
| `GET` | `/challenges/:id/coordination` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | none | `ChallengeCoordinationResponseDto` | hybrid bridge | yes | canonical when exact correlation exists, else legacy fallback |
| `GET` | `/challenges/:id/messages` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | none | `ChallengeMessageResponseDto[]` | hybrid bridge | yes | same bridge rule |
| `POST` | `/challenges/:id/proposals` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | `CreateChallengeProposalDto` | `ChallengeCoordinationResponseDto` | hybrid bridge | yes | write may fall back to legacy coordination service |
| `POST` | `/challenges/:id/proposals/:proposalId/accept` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | none | `ChallengeCoordinationResponseDto` | hybrid bridge | partial | canonical only if public `proposalId` resolves safely |
| `POST` | `/challenges/:id/proposals/:proposalId/reject` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | none | `ChallengeCoordinationResponseDto` | hybrid bridge | partial | same proposal-id constraint |
| `POST` | `/challenges/:id/messages` | HYBRID | `ChallengesController` | `ChallengesV2CoordinationBridgeService` | `CreateChallengeMessageDto` | `ChallengeMessageResponseDto` | hybrid bridge | yes | canonical write when safe, else legacy fallback |
| `PATCH` | `/challenges/:id/accept` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge plain object | challenges | yes | regular direct challenge accept |
| `PATCH` | `/challenges/:id/reject` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge plain object | challenges | yes | regular direct challenge reject |
| `PATCH` | `/challenges/:id/cancel` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge plain object | challenges | yes | regular challenge cancel |
| `PATCH` | `/challenges/:id/accept-open` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge plain object | challenges | yes | open challenge accept |
| `PATCH` | `/challenges/:id/cancel-open` | SAFE | `ChallengesController` | `ChallengesService` | none | challenge plain object | challenges | yes | open challenge cancel |
| `POST` | `/challenge-invites` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | invite creation DTO/body | challenge invite view | challenge-invites | yes | create invite |
| `GET` | `/challenge-invites/inbox` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | query `status?` | invite list/plain array | challenge-invites | yes | inbox |
| `GET` | `/challenge-invites/outbox` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | query `status?` | invite list/plain array | challenge-invites | yes | outbox |
| `PATCH` | `/challenge-invites/:id/accept` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | none | invite/plain object | challenge-invites | yes | mutate invite |
| `PATCH` | `/challenge-invites/:id/reject` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | none | invite/plain object | challenge-invites | yes | mutate invite |
| `PATCH` | `/challenge-invites/:id/cancel` | SAFE | `ChallengeInvitesController` | `ChallengeInvitesService` | none | invite/plain object | challenge-invites | yes | mutate invite |

## Matches

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/matches/me` | HYBRID | `MatchesController` | `MatchesV2BridgeService` by default, `MatchesService` with `legacy=1` | query `legacy?` | default `MatchListResponseDto`, legacy plain array | hybrid bridge | yes | default route is safe; edge is still hybrid |
| `GET` | `/matches/me/pending-confirmations` | HYBRID | `MatchesController` | `MatchesV2BridgeService` by default, `MatchesService` with `legacy=1` | `PendingConfirmationsQueryDto` | `MyPendingConfirmationsResponseDto` | hybrid bridge | yes | safe frontend route |
| `POST` | `/matches` | HYBRID | `MatchesController` | `MatchesV2BridgeService` | `ReportMatchDto` | legacy-shaped match result plain object | hybrid bridge | yes | canonical only when safe legacy correlation preserves public ids |
| `PATCH` | `/matches/:id/confirm` | HYBRID | `MatchesController` | `MatchesV2BridgeService` | none | legacy-shaped match result plain object | hybrid bridge | yes | safe frontend route |
| `PATCH` | `/matches/:id/admin-confirm` | LEGACY | `MatchesController` | `MatchesService` | none | legacy match result plain object | legacy matches | no | league-admin override semantics remain legacy |
| `PATCH` | `/matches/:id/reject` | HYBRID | `MatchesController` | `MatchesV2BridgeService` | `RejectMatchDto` | legacy-shaped match result plain object | hybrid bridge | yes | safe frontend route |
| `POST` | `/matches/:id/dispute` | LEGACY | `MatchesController` | `MatchesV2BridgeService` -> `MatchesService` fallback | `DisputeMatchDto` | plain `{ dispute, matchStatus }` | legacy matches | partial | bridge currently always falls back |
| `POST` | `/matches/:id/resolve` | FRAGILE | `MatchesController` | `MatchesV2BridgeService` or `MatchesService` | `ResolveDisputeDto` | plain `{ dispute, matchStatus, resolution }` | hybrid legacy/admin | no | admin-only; canonical subset is narrow |
| `POST` | `/matches/:id/resolve-confirm-as-is` | LEGACY | `MatchesController` | `MatchesService` | none | legacy/plain object | legacy matches | no | legacy league-admin path |
| `GET` | `/matches/:id/ranking-impact` | SAFE | `MatchesController` | `MatchesService` | none | `MatchRankingImpactResponseDto` | legacy matches read model | yes | documented contract |
| `GET` | `/matches/:id` | LEGACY | `MatchesController` | `MatchesService` | none | legacy match result detail/plain object | legacy matches | partial | explicitly legacy/fragile per current brief |
| `GET` | `/matches` | LEGACY | `MatchesController` | `MatchesService` | query `challengeId?` | `[]` or legacy match detail/plain object | legacy matches | partial | `GET /matches?challengeId=...` only |
| `GET` | `/leagues/:leagueId/matches` | SAFE | `LeagueMatchesController` | `MatchesService` | none | `LeagueMatchResponseDto[]` | leagues + legacy matches | yes | league surface |
| `GET` | `/leagues/:leagueId/pending-confirmations` | SAFE | `LeagueMatchesController` | `MatchesService` | `PendingConfirmationsQueryDto` | `LeaguePendingConfirmationsResponseDto` | leagues + legacy matches | partial | supported in league contract, but not in user safe subset |
| `POST` | `/leagues/:leagueId/pending-confirmations/:confirmationId/confirm` | SAFE | `LeagueMatchesController` | `MatchesService` | none | `ConfirmLeaguePendingConfirmationResponseDto` | leagues + legacy matches | partial | canonical POST path inside league contract |
| `PATCH` | `/leagues/:leagueId/pending-confirmations/:confirmationId/confirm` | LEGACY | `LeagueMatchesController` | `MatchesService` | none | `ConfirmLeaguePendingConfirmationResponseDto` | leagues + legacy matches | no | deprecated PATCH alias |
| `POST` | `/leagues/:leagueId/pending-confirmations/:confirmationId/reject` | SAFE | `LeagueMatchesController` | `MatchesService` | `RejectLeaguePendingConfirmationDto` | `RejectLeaguePendingConfirmationResponseDto` | leagues + legacy matches | partial | canonical POST path inside league contract |
| `PATCH` | `/leagues/:leagueId/pending-confirmations/:confirmationId/reject` | LEGACY | `LeagueMatchesController` | `MatchesService` | `RejectLeaguePendingConfirmationDto` | `RejectLeaguePendingConfirmationResponseDto` | leagues + legacy matches | no | deprecated PATCH alias |
| `POST` | `/leagues/:leagueId/matches` | SAFE | `LeagueMatchesController` | `MatchesService` | `CreateLeagueMatchDto` | league match/plain object | leagues + legacy matches | partial | not part of current frontend-safe subset, but active |
| `PATCH` | `/leagues/:leagueId/matches/:matchId/result` | SAFE | `LeagueMatchesController` | `MatchesService` | `SubmitLeagueMatchResultDto` | league match/plain object | leagues + legacy matches | partial | runtime accepts canonical and legacy body forms |
| `GET` | `/leagues/:leagueId/eligible-reservations` | SAFE | `LeagueMatchesController` | `MatchesService` | none | eligible reservation list/plain array | leagues + legacy matches | partial | league tooling surface |
| `POST` | `/leagues/:leagueId/report-from-reservation` | SAFE | `LeagueMatchesController` | `MatchesService` | `ReportFromReservationDto` | match/plain object | leagues + legacy matches | partial | league tooling surface |
| `POST` | `/leagues/:leagueId/report-manual` | SAFE | `LeagueMatchesController` | `MatchesService` | `ReportManualDto` | match/plain object | leagues + legacy matches | partial | league tooling surface |

## Leagues

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/leagues` | SAFE | `LeaguesController` | `LeaguesService` | `CreateLeagueDto` | league/plain object | leagues | yes | documented |
| `POST` | `/leagues/mini` | SAFE | `LeaguesController` | `LeaguesService` | `CreateMiniLeagueDto` | league/plain object | leagues | yes | mini league creation |
| `GET` | `/leagues` | SAFE | `LeaguesController` | `LeaguesService` | none | `ListLeaguesResponseDto` | leagues | yes | documented |
| `GET` | `/leagues/discover` | SAFE | `LeaguesController` | `LeaguesService` | `DiscoverLeaguesQueryDto` | `DiscoverLeaguesResponseDto` | leagues | yes | discover surface |
| `GET` | `/leagues/invites/:token` | SAFE | `LeaguesController` | `LeaguesService` | none | invite summary/plain object | leagues | yes | public-in-app invite token path |
| `POST` | `/leagues/invites/:inviteId/accept` | SAFE | `LeaguesController` | `LeaguesService` | none | invite acceptance/plain object | leagues | yes | documented |
| `POST` | `/leagues/invites/:inviteId/decline` | SAFE | `LeaguesController` | `LeaguesService` | none | invite decline/plain object | leagues | yes | documented |
| `POST` | `/leagues/:id/join-requests` | SAFE | `LeaguesController` | `LeaguesService` | `CreateLeagueJoinRequestDto` | `LeagueJoinRequestItemDto` | leagues | yes | newer than `leagues-contract.md` |
| `GET` | `/leagues/:id/join-requests` | SAFE | `LeaguesController` | `LeaguesService` | `ListLeagueJoinRequestsQueryDto` | `LeagueJoinRequestListResponseDto` | leagues | partial | not described in current league contract doc |
| `POST` | `/leagues/:id/join-requests/:requestId/approve` | SAFE | `LeaguesController` | `LeaguesService` | none | `LeagueJoinRequestApproveResponseDto` | leagues | partial | not described in current league contract doc |
| `POST` | `/leagues/:id/join-requests/:requestId/reject` | SAFE | `LeaguesController` | `LeaguesService` | none | `LeagueJoinRequestItemDto` | leagues | partial | not described in current league contract doc |
| `DELETE` | `/leagues/:id/join-requests/:requestId` | SAFE | `LeaguesController` | `LeaguesService` | none | `LeagueJoinRequestItemDto` | leagues | partial | not described in current league contract doc |
| `GET` | `/leagues/:id` | SAFE | `LeaguesController` | `LeaguesService` | none | league detail/plain object | leagues | yes | documented |
| `GET` | `/leagues/:leagueId/settings` | SAFE | `LeaguesController` | `LeaguesService` | none | inline settings schema | leagues | yes | documented |
| `PATCH` | `/leagues/:leagueId/settings` | SAFE | `LeaguesController` | `LeaguesService` | `UpdateLeagueSettingsDto` | inline `{ settings, recomputeTriggered }` | leagues | yes | documented |
| `PATCH` | `/leagues/:id` | SAFE | `LeaguesController` | `LeaguesService` | `UpdateLeagueProfileDto` | league/plain object | leagues | yes | documented |
| `PATCH` | `/leagues/:id/avatar` | SAFE | `LeaguesController` | `LeaguesService` | `SetLeagueAvatarDto` | league/plain object | leagues | yes | documented |
| `GET` | `/leagues/:id/share` | SAFE | `LeaguesController` | `LeaguesService` | none | inline share status schema | leagues | partial | share tooling, not general frontend core |
| `POST` | `/leagues/:id/share/enable` | SAFE | `LeaguesController` | `LeaguesService` | none | inline share enable schema | leagues | partial | share tooling |
| `POST` | `/leagues/:id/share/disable` | SAFE | `LeaguesController` | `LeaguesService` | none | plain disable response | leagues | partial | share tooling |
| `DELETE` | `/leagues/:id` | SAFE | `LeaguesController` | `LeaguesService` | none | inline `{ ok, deletedLeagueId }` | leagues | no | destructive/admin-like |
| `PATCH` | `/leagues/:id/members/:memberId/role` | SAFE | `LeaguesController` | `LeaguesService` | `UpdateMemberRoleDto` | member/plain object | leagues | no | owner-only backoffice/member admin |
| `GET` | `/leagues/:id/activity` | SAFE | `LeaguesController` | `LeagueActivityService` | `LeagueActivityQueryDto` | `ActivityListResponseDto` | leagues | yes | documented |
| `GET` | `/leagues/:id/standings` | SAFE | `LeaguesController` | `LeagueStandingsService` | none | `StandingsWithMovementDto` | leagues | yes | documented |
| `GET` | `/leagues/:id/standings/latest` | SAFE | `LeaguesController` | `LeagueStandingsService` | none | standings/plain object | leagues | yes | documented |
| `GET` | `/leagues/:id/standings/history` | SAFE | `LeaguesController` | `LeagueStandingsService` | `LeagueStandingsHistoryQueryDto` | snapshot version list/plain array | leagues | partial | documented but less central |
| `GET` | `/leagues/:id/standings/history/:version` | SAFE | `LeaguesController` | `LeagueStandingsService` | none | standings snapshot/plain object | leagues | partial | documented but less central |
| `POST` | `/leagues/:id/invites` | SAFE | `LeaguesController` | `LeaguesService` | `CreateInvitesDto` | invite batch/plain object | leagues | partial | admin/member-management surface |
| `POST` | `/leagues/:id/recompute` | INTERNAL/ADMIN | `LeaguesController` | `LeagueStandingsService` | none | plain `{ updated }` | leagues ops | no | member-accessible operational trigger; not a frontend product contract |
| `POST` | `/leagues/:leagueId/challenges` | SAFE | `LeagueChallengesController` | `LeagueChallengesService` | `CreateLeagueChallengeDto` | league challenge/plain object | leagues | partial | active but league-specific |
| `GET` | `/leagues/:leagueId/challenges` | SAFE | `LeagueChallengesController` | `LeagueChallengesService` | `ListLeagueChallengesQueryDto` | league challenge list/plain array | leagues | partial | active/history query |
| `POST` | `/challenges/:id/accept` | SAFE | `LeagueChallengeActionsController` | `LeagueChallengesService` | none | league challenge/plain object | leagues | partial | canonical league challenge accept; distinct from `PATCH /challenges/:id/accept` |
| `POST` | `/challenges/:id/decline` | SAFE | `LeagueChallengeActionsController` | `LeagueChallengesService` | none | league challenge/plain object | leagues | partial | canonical league challenge decline |
| `POST` | `/challenges/:id/link-match` | SAFE | `LeagueChallengeActionsController` | `LeagueChallengesService` | `LinkLeagueChallengeMatchDto` | league challenge/plain object | leagues | partial | links finalized match to league challenge |
| `GET` | `/public/leagues/:id/standings` | SAFE | `PublicLeaguesController` | `LeaguesService` | query `token` | inline public standings schema | leagues public share | yes | tokenized public surface |
| `GET` | `/public/leagues/:id/og` | SAFE | `PublicLeaguesController` | `LeaguesService` | query `token` | plain OG payload | leagues public share | partial | public metadata surface |

## Competitive / Rankings / Players / Intents / Insights / Endorsements

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/competitive/me` | SAFE | `CompetitiveController` | `CompetitiveService` | none | competitive profile/plain object | competitive | yes | canonical current profile |
| `GET` | `/competitive/profile/me` | LEGACY | `CompetitiveController` | `CompetitiveService` | none | competitive profile/plain object | competitive | partial | deprecated alias |
| `POST` | `/competitive/profile/init` | LEGACY | `CompetitiveController` | `CompetitiveService` | `InitCompetitiveProfileDto` | profile/plain object | competitive | partial | old init path |
| `GET` | `/competitive/profile/me/history` | SAFE | `CompetitiveController` | `CompetitiveService` | `HistoryQueryDto` | history/plain object | competitive | yes | route is active and covered by OpenAPI check |
| `GET` | `/competitive/profile/me/radar` | SAFE | `CompetitiveController` | `CompetitiveService` | none | `SkillRadarResponseDto` | competitive | yes | DTO-backed |
| `GET` | `/competitive/matchmaking/rivals` | LEGACY | `CompetitiveController` | `CompetitiveService` | `MatchmakingRivalsQueryDto` | `MatchmakingRivalsResponseDto` | competitive | partial | deprecated |
| `GET` | `/competitive/matchmaking/partners` | LEGACY | `CompetitiveController` | `CompetitiveService` | `MatchmakingRivalsQueryDto` | `MatchmakingRivalsResponseDto` | competitive | partial | deprecated |
| `GET` | `/competitive/matchmaking/candidates` | SAFE | `CompetitiveController` | `CompetitiveService` | `MatchmakingCandidatesQueryDto` | `MatchmakingCandidatesResponseDto` | competitive | yes | canonical matchmaking endpoint |
| `GET` | `/competitive/challenges` | SAFE | `CompetitiveController` | `CompetitiveService` | `CompetitiveChallengesQueryDto` | challenge list/plain object | competitive | yes | active |
| `GET` | `/competitive/discover/candidates` | LEGACY | `CompetitiveController` | `CompetitiveService` | `DiscoverCandidatesQueryDto` | `DiscoverCandidatesResponseDto` | competitive | partial | deprecated adapter over canonical candidates |
| `GET` | `/competitive/onboarding` | SAFE | `CompetitiveController` | `CompetitiveService` | none | onboarding/plain object | competitive | yes | current endpoint |
| `PUT` | `/competitive/onboarding` | SAFE | `CompetitiveController` | `CompetitiveService` | `UpsertOnboardingDto` | onboarding/plain object | competitive | yes | current endpoint |
| `GET` | `/competitive/ranking` | LEGACY | `CompetitiveController` | `CompetitiveService` | `RankingQueryDto` | ranking/plain object | competitive | partial | deprecated in favor of `/rankings` |
| `POST` | `/players/me/onboarding` | LEGACY | `CompetitiveOnboardingCompatController` | `CompetitiveService` | `UpsertOnboardingDto` | onboarding/plain object | competitive | partial | backward-compatible alias |
| `GET` | `/rankings` | SAFE | `RankingsController` | `RankingsService` | `RankingsQueryDto` | leaderboard/plain object | rankings | yes | canonical rankings list |
| `GET` | `/rankings/scopes` | SAFE | `RankingsController` | `RankingsService` | none | scopes/plain object | rankings | yes | available scopes |
| `GET` | `/rankings/me/progress` | SAFE | `RankingsController` | `RankingsService` | `RankingEligibilityProgressQueryDto` | `RankingEligibilityProgressResponseDto` | rankings | yes | DTO-backed |
| `GET` | `/rankings/me/intelligence` | SAFE | `RankingsController` | `RankingsService` | `RankingsInsightQueryDto` | `RankingIntelligenceResponseDto` | rankings | yes | DTO-backed |
| `GET` | `/rankings/me/suggested-rivals` | SAFE | `RankingsController` | `RankingsService` | `RankingsInsightQueryDto` | `SuggestedRivalsResponseDto` | rankings | yes | DTO-backed |
| `GET` | `/rankings/me/movement-feed` | SAFE | `RankingsController` | `RankingsService` | `RankingMovementFeedQueryDto` | `RankingMovementFeedResponseDto` | rankings | yes | DTO-backed |
| `POST` | `/rankings/snapshots/run` | INTERNAL/ADMIN | `RankingsController` | `RankingsSnapshotSchedulerService` | `RunRankingSnapshotsQueryDto` | batch summary/plain object | rankings ops | no | admin-only manual trigger |
| `GET` | `/players/:id/competitive-summary` | SAFE | `PlayersPublicController` | `PlayerCompetitiveSummaryService` | none | `PlayerCompetitiveSummaryDto` | players | yes | DTO-backed |
| `GET` | `/players/:id/competitive-profile` | SAFE | `PlayersPublicController` | `PlayerCompetitiveProfileService` | none | `PlayerCompetitiveProfileDto` | players | yes | DTO-backed |
| `GET` | `/players/me/profile` | SAFE | `PlayersMeProfileController` | `PlayersService` | none | `PlayerProfileResponseDto` | players | yes | player role only |
| `PATCH` | `/players/me/profile` | SAFE | `PlayersMeProfileController` | `PlayersService` | `UpdatePlayerProfileDto` | `PlayerProfileResponseDto` | players | yes | player role only |
| `GET` | `/players/me/favorites/ids` | SAFE | `PlayersFavoritesController` | `PlayersService` | none | `PlayerFavoriteIdsResponseDto` | players | yes | DTO-backed |
| `POST` | `/players/me/favorites/:targetUserId` | SAFE | `PlayersFavoritesController` | `PlayersService` | none | `PlayerFavoriteMutationResponseDto` | players | yes | DTO-backed |
| `DELETE` | `/players/me/favorites/:targetUserId` | SAFE | `PlayersFavoritesController` | `PlayersService` | none | `PlayerFavoriteMutationResponseDto` | players | yes | DTO-backed |
| `GET` | `/players/me/favorites` | SAFE | `PlayersFavoritesController` | `PlayersService` | `PlayerFavoritesQueryDto` | `PlayerFavoritesListResponseDto` | players | yes | DTO-backed |
| `GET` | `/me/intents` | SAFE | `MeIntentsController` | `MatchIntentsService` | `MeIntentsQueryDto` | `MatchIntentsResponseDto` | intents | yes | DTO-backed |
| `POST` | `/me/intents/direct` | SAFE | `MeIntentsController` | `MatchIntentsService` | `CreateDirectIntentDto` | `MatchIntentItemResponseDto` | intents | yes | DTO-backed |
| `POST` | `/me/intents/open` | SAFE | `MeIntentsController` | `MatchIntentsService` | `CreateOpenIntentDto` | `MatchIntentItemResponseDto` | intents | yes | DTO-backed |
| `POST` | `/me/intents/find-partner` | SAFE | `MeIntentsController` | `MatchIntentsService` | `CreateFindPartnerIntentDto` | `MatchIntentItemResponseDto` | intents | yes | DTO-backed |
| `GET` | `/me/insights` | SAFE | `MeInsightsController` | `InsightsService` | `InsightsQueryDto` | `InsightsDto` | insights | yes | DTO-backed |
| `POST` | `/matches/:matchId/endorsements` | SAFE | `MatchEndorsementsController` | `MatchEndorsementsService` | `CreateMatchEndorsementDto` | `CreateMatchEndorsementResponseDto` | endorsements | yes | documented contract |
| `GET` | `/me/reputation` | SAFE | `MeReputationController` | `MatchEndorsementsService` | none | `ReputationResponseDto` | endorsements | yes | DTO-backed |
| `GET` | `/me/endorsements/pending` | SAFE | `MeReputationController` | `MatchEndorsementsService` | `PendingEndorsementsQueryDto` | `PendingEndorsementsResponseDto` | endorsements | yes | DTO-backed |
| `GET` | `/players/:userId/strengths` | SAFE | `PlayerStrengthsController` | `MatchEndorsementsService` | `StrengthSummaryQueryDto` | `StrengthSummaryResponseDto` | endorsements | yes | canonical read |
| `GET` | `/players/:userId/strengths/summary` | LEGACY | `PlayerStrengthsController` | `MatchEndorsementsService` | `StrengthSummaryQueryDto` | `StrengthSummaryResponseDto` | endorsements | partial | backward-compatible alias |

## Notifications / Media / Health

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/notifications` | SAFE | `UserNotificationsController` | `UserNotificationsService` | `UserNotificationsQueryDto` | `LegacyNotificationsFeedResponseDto` | notifications | partial | compatibility alias over canonical inbox/feed data |
| `GET` | `/notifications/inbox` | SAFE | `UserNotificationsController` | `UserNotificationsService` | `UserNotificationsQueryDto` | `CanonicalNotificationsInboxResponseDto` | notifications | yes | canonical notification inbox |
| `GET` | `/notifications/unread-count` | SAFE | `UserNotificationsController` | `UserNotificationsService` | none | plain `{ count }` | notifications | yes | stable simple response |
| `POST` | `/notifications/:id/read` | SAFE | `UserNotificationsController` | `UserNotificationsService` | none | `{ ok: true }` | notifications | yes | canonical mark-read supported |
| `PATCH` | `/notifications/:id/read` | SAFE | `UserNotificationsController` | `UserNotificationsService` | none | `{ ok: true }` | notifications | yes | canonical mark-read supported |
| `POST` | `/notifications/read-all` | SAFE | `UserNotificationsController` | `UserNotificationsService` | none | service response/plain object | notifications | yes | canonical mark-all-read |
| `GET` | `/me/inbox` | LEGACY | `MeInboxController` | `InboxService` | `MeInboxQueryDto` | `InboxResponseDto` | notifications legacy alias | partial | deprecated in controller docs |
| `GET` | `/me/notifications` | LEGACY | `MeInboxController` | `UserNotificationsService` | `UserNotificationsQueryDto` | `LegacyNotificationsFeedResponseDto` | notifications legacy alias | partial | deprecated |
| `POST` | `/me/notifications/:id/read` | LEGACY | `MeInboxController` | `UserNotificationsService` | none | `{ ok: true }` | notifications legacy alias | partial | deprecated |
| `POST` | `/me/notifications/read-all` | LEGACY | `MeInboxController` | `UserNotificationsService` | none | plain object | notifications legacy alias | partial | deprecated |
| `GET` | `/me/activity` | SAFE | `MeActivityController` | `ActivityFeedService` | `MeActivityQueryDto` | activity feed/plain object | notifications/activity | yes | active feed |
| `GET` | `/admin/notifications` | INTERNAL/ADMIN | `NotificationsAdminController` | `NotificationEventsService` | `NotificationEventsQueryDto` | event list/plain array | notifications admin | no | admin-only |
| `GET` | `/admin/notifications/:id` | INTERNAL/ADMIN | `NotificationsAdminController` | `NotificationEventsService` | none | event detail/plain object | notifications admin | no | admin-only |
| `GET` | `/health` | INTERNAL/ADMIN | `HealthController` | `NotificationService` | none | health/plain object | ops | no | public healthcheck/ops surface |
| `POST` | `/media/cloudinary/signature` | SAFE | `MediaController` | `MediaService` | signature DTO/body | signature/plain object | media | partial | upload tooling |
| `POST` | `/media/register` | SAFE | `MediaController` | `MediaService` | `RegisterMediaDto` | media asset/plain object | media | partial | upload tooling |
| `GET` | `/media` | SAFE | `MediaController` | `MediaService` | query params | media asset list/plain object | media | partial | tooling/admin-ish surface |
| `DELETE` | `/media/:id` | SAFE | `MediaController` | `MediaService` | none | delete/plain object | media | no | destructive/admin-like |
| `GET` | `/public/media` | SAFE | `PublicMediaController` | `MediaService` | query params | media asset/plain object | media public | partial | public media fetch |
| `GET` | `/public/media/clubs/:clubId/logo` | SAFE | `PublicMediaController` | `MediaService` | none | media asset/plain object | media public | yes | public asset |
| `GET` | `/public/media/clubs/:clubId/cover` | SAFE | `PublicMediaController` | `MediaService` | none | media asset/plain object | media public | yes | public asset |
| `GET` | `/public/media/courts/:courtId/primary` | SAFE | `PublicMediaController` | `MediaService` | none | media asset/plain object | media public | yes | public asset |
| `GET` | `/public/media/courts/:courtId/gallery` | SAFE | `PublicMediaController` | `MediaService` | none | media asset/plain object | media public | yes | public asset |
| `GET` | `/public/media/users/:userId/avatar` | SAFE | `PublicMediaController` | `MediaService` | none | media asset/plain object or 204 | media public | yes | public avatar |

## Legacy Booking / Clubs / Courts / Payments / Reports

| Method | Path | Classification | Public owner | Internal owner | Request DTO | Response DTO | Source of truth | Frontend safe to consume? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/clubs/search` | LEGACY | `ClubsController` | `ClubsService` | query `q` | club list/plain array | legacy clubs | partial | legacy club surface |
| `GET` | `/clubs/mine` | LEGACY | `ClubsController` | `ClubsService` | none | club list/plain array | legacy clubs | partial | auth required |
| `POST` | `/clubs` | LEGACY | `ClubsController` | `ClubsService` | `CreateClubDto` | club/plain object | legacy clubs | no | creation/admin-like |
| `GET` | `/clubs` | LEGACY | `ClubsController` | `ClubsService` | none | club list/plain array | legacy clubs | partial | listing surface |
| `GET` | `/clubs/:id` | LEGACY | `ClubsController` | `ClubsService` | none | club detail/plain object | legacy clubs | partial | legacy |
| `PATCH` | `/clubs/:id` | INTERNAL/ADMIN | `ClubsController` | `ClubsService` | `UpdateClubDto` | club/plain object | legacy clubs admin | no | admin role required |
| `DELETE` | `/clubs/:id` | INTERNAL/ADMIN | `ClubsController` | `ClubsService` | none | delete/plain object | legacy clubs admin | no | admin role required |
| `PATCH` | `/clubs/:clubId/details` | LEGACY | `ClubsController` | `ClubsService` | `UpdateClubDto` | club/plain object | legacy clubs | no | club-admin member tooling |
| `GET` | `/public/clubs/search` | SAFE | `PublicClubsController` | `ClubsService` | query `q` | club list/plain array | legacy clubs public | yes | public search |
| `GET` | `/public/clubs` | SAFE | `PublicClubsController` | `ClubsService` | none | club list/plain array | legacy clubs public | yes | public list |
| `GET` | `/public/clubs/:clubId` | SAFE | `PublicClubsController` | `ClubsService` | none | club overview/plain object | legacy clubs public | yes | public detail |
| `GET` | `/clubs/:clubId/members` | LEGACY | `ClubMembersController` | `ClubMembersService` | none | member list/plain array | legacy clubs | partial | member/admin surface |
| `POST` | `/clubs/:clubId/members` | LEGACY | `ClubMembersController` | `ClubMembersService` | inline `{ email, role }` | member/plain object | legacy clubs | no | invite/admin surface |
| `POST` | `/courts` | LEGACY | `CourtsController` | `CourtsService` | `CreateCourtDto` | court/plain object | legacy courts | no | admin-like |
| `GET` | `/courts/by-club/:clubId` | LEGACY | `CourtsController` | `CourtsService` | none | court list/plain array | legacy courts | partial | legacy |
| `GET` | `/courts/:id` | LEGACY | `CourtsController` | `CourtsService` | none | court/plain object | legacy courts | partial | legacy |
| `PATCH` | `/courts/:id` | LEGACY | `CourtsController` | `CourtsService` | `UpdateCourtDto` | court/plain object | legacy courts | no | mutating/admin-like |
| `DELETE` | `/courts/:id` | LEGACY | `CourtsController` | `CourtsService` | none | delete/plain object | legacy courts | no | mutating/admin-like |
| `GET` | `/public/courts/club/:clubId` | SAFE | `PublicCourtsController` | `CourtsService` | none | court list/plain array | legacy courts public | yes | public list |
| `GET` | `/public/courts/:id` | SAFE | `PublicCourtsController` | `CourtsService` | none | court/plain object | legacy courts public | yes | public detail |
| `POST` | `/availability/rules` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | `CreateAvailabilityRuleDto` | rule/plain object | booking legacy | no | club-admin tooling |
| `POST` | `/availability/rules/bulk` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | `BulkCreateAvailabilityDto` | bulk result/plain object | booking legacy | no | club-admin tooling |
| `GET` | `/availability/rules/court/:courtId` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | none | rule list/plain array | booking legacy | no | club-admin tooling |
| `POST` | `/availability/overrides` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | `CreateOverrideDto` | override/plain object | booking legacy | no | club-admin tooling |
| `DELETE` | `/availability/overrides/:id` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | none | delete/plain object | booking legacy | no | club-admin tooling |
| `GET` | `/availability/slots` | SAFE | `AvailabilityController` | `AvailabilityService` | `AvailabilityRangeQueryDto` | `AvailabilitySlotDto[]` | booking legacy | partial | read-only but legacy |
| `DELETE` | `/availability/admin/cleanup-duplicates` | INTERNAL/ADMIN | `AvailabilityController` | `AvailabilityService` | none | cleanup/plain object | booking ops | no | maintenance endpoint |
| `GET` | `/clubs/:clubId/agenda` | LEGACY | `AgendaController` | `AgendaService` | query `AgendaQueryDto` | `AgendaResponseDto` | booking legacy | partial | legacy club agenda |
| `POST` | `/clubs/:clubId/agenda/block` | INTERNAL/ADMIN | `AgendaController` | `AgendaService` | `AgendaBlockDto` | block/plain object | booking legacy | no | scheduling admin |
| `PATCH` | `/clubs/:clubId/agenda/blocks/:overrideId` | INTERNAL/ADMIN | `AgendaController` | `AgendaService` | `AgendaUpdateBlockDto` | block/plain object | booking legacy | no | scheduling admin |
| `GET` | `/reservations/mine` | LEGACY | `ReservationsController` | `ReservationsService` | none | reservation list/plain array | booking legacy | partial | legacy user reservations |
| `POST` | `/reservations/hold` | LEGACY | `ReservationsController` | `ReservationsService` | `CreateHoldDto` | hold/plain object | booking legacy | partial | booking flow |
| `PATCH` | `/reservations/:id/confirm` | LEGACY | `ReservationsController` | `ReservationsService` | `ConfirmReservationDto` | reservation/plain object | booking legacy | partial | booking flow |
| `PATCH` | `/reservations/:id/cancel` | LEGACY | `ReservationsController` | `ReservationsService` | none | reservation/plain object | booking legacy | partial | booking flow |
| `GET` | `/reservations/:id` | LEGACY | `ReservationsController` | `ReservationsService` | none | reservation/plain object | booking legacy | partial | legacy |
| `GET` | `/reservations/list` | LEGACY | `ReservationsController` | `ReservationsService` | `ReservationsRangeQueryDto` + filters | reservation list/plain array | booking legacy | no | club/admin surface |
| `GET` | `/reservations/club/:clubId` | LEGACY | `ReservationsController` | `ReservationsService` | `ReservationsRangeQueryDto` | reservation list/plain array | booking legacy | no | club/admin surface |
| `GET` | `/reservations/court/:courtId` | LEGACY | `ReservationsController` | `ReservationsService` | `ReservationsRangeQueryDto` | reservation list/plain array | booking legacy | no | club/admin surface |
| `GET` | `/reservations/club/:clubId/range` | LEGACY | `ReservationsController` | `ReservationsService` | query `from`, `to` | reservation list/plain array | booking legacy | no | club/admin surface |
| `GET` | `/me/reservations` | LEGACY | `MeReservationsController` | `ReservationsService` | query map | reservation list/plain array | booking legacy | partial | legacy alias surface |
| `POST` | `/me/reservations/:reservationId/receipt-link` | LEGACY | `MeReservationsController` | `ReservationsService` | none | receipt-link/plain object | booking legacy | partial | legacy utility path |
| `GET` | `/public/reservations/:id` | SAFE | `PublicReservationsController` | `ReservationsService` | query `token` | public reservation/plain object | booking public | yes | tokenized public confirmation flow |
| `GET` | `/public/reservations/:id/receipt` | SAFE | `PublicReservationsController` | `ReservationsService` | query `token` | receipt/plain object | booking public | yes | tokenized public |
| `GET` | `/public/reservations/:id/notifications` | SAFE | `PublicReservationsController` | `ReservationsService` | `PublicNotificationsQueryDto` | notifications/plain object | booking public | partial | tokenized public |
| `POST` | `/public/reservations/:id/notifications/resend` | SAFE | `PublicReservationsController` | `ReservationsService` | resend body DTO | resend/plain object | booking public | partial | tokenized public |
| `POST` | `/public/reservations/:id/confirm` | SAFE | `PublicReservationsController` | `ReservationsService` | token in query/body | confirmation/plain object | booking public | partial | tokenized public |
| `POST` | `/payments/intents` | LEGACY | `PaymentsController` | `PaymentsService` | `CreatePaymentIntentDto` | payment intent/plain object | payments legacy | partial | authenticated payment flow |
| `POST` | `/payments/intents/:id/simulate-success` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `SimulatePaymentDto` | payment intent/plain object | payments testing | no | simulation tooling |
| `POST` | `/payments/intents/:id/simulate-failure` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `SimulatePaymentDto` | payment intent/plain object | payments testing | no | simulation tooling |
| `GET` | `/payments/intents/:id` | LEGACY | `PaymentsController` | `PaymentsService` | none | payment intent/plain object | payments legacy | partial | payment detail |
| `GET` | `/payments/intents` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `AdminListPaymentIntentsDto` | payment intent list/plain object | payments admin | no | admin/backoffice |
| `GET` | `/payments/intents/by-reference` | LEGACY | `PaymentsController` | `PaymentsService` | query filters | payment intent/plain object | payments legacy | partial | reference lookup |
| `POST` | `/payments/public/intents` | SAFE | `PaymentsController` | `PaymentsService` | `CreatePaymentIntentDto` | payment intent/plain object | payments public | partial | public payment intent entry |
| `POST` | `/payments/webhook/mock` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `MockPaymentWebhookDto` | webhook/plain object | payments testing | no | mock webhook |
| `POST` | `/payments/public/intents/:id/simulate-success` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `SimulatePaymentDto` | payment intent/plain object | payments testing | no | public simulation tooling |
| `POST` | `/payments/public/intents/:id/simulate-failure` | INTERNAL/ADMIN | `PaymentsController` | `PaymentsService` | `SimulatePaymentDto` | payment intent/plain object | payments testing | no | public simulation tooling |
| `GET` | `/reports/revenue` | INTERNAL/ADMIN | `ReportsController` | `ReportsService` | `RevenueQueryDto` | `RevenueResponseDto` | reports | no | backoffice reporting |
| `GET` | `/reports/occupancy` | INTERNAL/ADMIN | `ReportsController` | `ReportsService` | `OccupancyQueryDto` | `OccupancyResponseDto` | reports | no | backoffice reporting |
| `GET` | `/reports/peak-hours` | INTERNAL/ADMIN | `ReportsController` | `ReportsService` | `PeakHoursQueryDto` | `PeakHoursResponseDto` | reports | no | backoffice reporting |
| `GET` | `/reports/summary` | INTERNAL/ADMIN | `ReportsController` | `ReportsService` | `SummaryQueryDto` | `SummaryResponseDto` | reports | no | backoffice reporting |
