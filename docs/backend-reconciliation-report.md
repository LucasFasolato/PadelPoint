# Backend Reconciliation Report

Date: 2026-03-12

## Scope And Method

- Historical / contract sources available in the workspace:
  - [`docs/api/matches-contract.md`](/c:/Users/fasol/Documents/GitHub/PadelPoint/docs/api/matches-contract.md)
  - [`docs/leagues-contract.md`](/c:/Users/fasol/Documents/GitHub/PadelPoint/docs/leagues-contract.md)
  - [`src/modules/core/matches-v2/ARCHITECTURE.md`](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches-v2/ARCHITECTURE.md)
- Recent git history also confirms the `matches-v2` bridge rollout sequence between 2026-03-10 and 2026-03-12.
- No local file explicitly named as the "audit 09/03/2026" was found in the working tree or tracked files. That historical source is therefore treated as unavailable evidence in this repo snapshot.
- Per instruction, current repository code is authoritative for present state; divergences are called out explicitly instead of normalized away.

## Executive Reconciliation

- `matches-v2` is canonically positioned as the internal lifecycle owner, and the code agrees.
- The public edge is not fully canonized; the code also agrees.
- The strongest code/document alignment exists for:
  - default delegation of `GET /matches/me`
  - default delegation of `GET /matches/me/pending-confirmations`
  - hybrid challenge coordination reads/writes
  - explicit legacy ownership of `admin-confirm` and `resolve-confirm-as-is`
  - explicit fallback language around dispute/admin boundaries
- The main current drift is not route presence but contract authority:
  - OpenAPI mostly lists current routes
  - OpenAPI does not represent delegation rules, canonical-vs-legacy source of truth, or conditional runtime routes

## Reconciliation Table

| Topic | Expected documentary source | Evidence in current code | Status | Impact | Recommendation for EPIC A |
| --- | --- | --- | --- | --- | --- |
| Public contract is still hybrid, not fully canonical | `matches-v2/ARCHITECTURE.md` + user brief | `MatchesController` and `ChallengesController` still route through bridge + fallback services | COINCIDE | EPIC A must treat current public edge as compatibility-first | Freeze current observed responses before attempting canonical HTTP contracts |
| `matches-v2` owns internal match lifecycle | `matches-v2/ARCHITECTURE.md` | `MatchesV2Module` provides `MatchQueryService`, `MatchSchedulingService`, `MatchResultLifecycleService`, `MatchEffectsService`; no public controllers | COINCIDE | Internal authority is clear | Build EPIC A on canonical services, not on `MatchesService` |
| `GET /matches/me` delegates to canonical by default | `matches-v2/ARCHITECTURE.md` | `MatchesController.getMyMatches()` calls `MatchesV2BridgeService.listMyMatches()` unless `legacy=1` | COINCIDE | Frontend can keep using default route, but wrapper/legacy toggle both exist | Document legacy query-param fallback as migration debt |
| `GET /matches/me/pending-confirmations` delegates to canonical by default | `docs/api/matches-contract.md`, `matches-v2/ARCHITECTURE.md` | `MatchesController.getPendingConfirmations()` delegates to bridge unless `legacy=1`; bridge adapts canonical matches into legacy DTO | COINCIDE | Safe route for frontend remains valid | Preserve current DTO while extracting canonical response contract separately |
| Challenge coordination reads delegate to `matches-v2` when safe | `matches-v2/ARCHITECTURE.md` | `ChallengesV2CoordinationBridgeService.getCoordinationState()` / `listMessages()` delegate only with exact `legacyChallengeId` correlation | COINCIDE | Public read surface is hybrid but deliberate | EPIC A should formalize correlation preconditions, not remove them implicitly |
| Challenge proposal/message writes delegate when safe | `matches-v2/ARCHITECTURE.md` | `createProposal()` and `createMessage()` delegate to `MatchSchedulingService` only when correlation exists | COINCIDE | Current write behavior is safe but non-canonical at the edge | Keep bridge explicit; do not flatten write paths prematurely |
| Report / confirm / reject are fully canonical already | User brief treats them as safe frontend routes, but not fully canonized | Bridge delegates only when correlation preserves public ids; otherwise falls back to `MatchesService` | DIVERGE | Safe for frontend use, but not canonical at edge ownership level | EPIC A should separate "safe to consume" from "canonical owner" |
| `POST /matches/:id/dispute` is legacy-owned today | `matches-v2/ARCHITECTURE.md` says legacy dispute open flow remains fallback | `MatchesV2BridgeService.openDispute()` always falls back to `MatchesService.disputeMatch()` | COINCIDE | Frontend should treat dispute open as legacy/fragile | Keep out of first canonicalization tranche |
| `POST /matches/:id/resolve` is narrow hybrid, not fully canonical | `matches-v2/ARCHITECTURE.md` | Controller is admin-only; bridge only delegates when admin also satisfies canonical participant semantics and open-dispute mapping is safe | COINCIDE | Admin dispute resolution remains fragile | Model admin override semantics before claiming canonical ownership |
| `PATCH /matches/:id/admin-confirm` remains legacy | `matches-v2/ARCHITECTURE.md`, user brief | Controller comment explicitly says league-admin override semantics remain legacy | COINCIDE | Canonical lifecycle does not cover league admin override | Keep as separate legacy/admin flow in EPIC A backlog |
| `POST /matches/:id/resolve-confirm-as-is` remains legacy | `matches-v2/ARCHITECTURE.md`, user brief | Controller comment explicitly says flow remains legacy until `matches-v2` models league-admin path | COINCIDE | Same as above | Do not collapse into canonical dispute flow without explicit semantics |
| `GET /matches/:id` is still a viable canonical read | User brief marks it legacy/fragile | `MatchesController.getById()` directly calls `MatchesService.getById()` over `match_results` | DIVERGE | Treating it as canonical would be wrong | Keep outside EPIC A safe contract set unless reimplemented |
| `GET /matches?challengeId=...` is still a viable canonical read | User brief marks it legacy/fragile | `MatchesController.getByChallenge()` directly calls `MatchesService.getByChallenge()` and returns `[]` when query missing | DIVERGE | Same risk as above | Keep as compatibility-only in contract docs |
| OpenAPI is trustworthy as the only source of truth | User brief says do not assume that | Snapshot includes routes, but not delegation/fallback semantics; Apple OAuth routes are missing in default snapshot because module registration is conditional | COINCIDE | OpenAPI alone would hide runtime/ownership nuance | EPIC A should pair generated spec with hand-maintained ownership notes |
| OpenAPI route presence aligns with current controllers | Expected if snapshot was refreshed | Mechanical controller-vs-snapshot check found only 2 missing operations: `/auth/apple`, `/auth/apple/callback` | AMBIGUO | Mostly aligned, but conditional runtime routes are underrepresented | Keep snapshot, but annotate env-dependent routes |
| Websocket contract for match domain is canonicalized | User brief says do not assume that | Only `NotificationsGateway` exists; namespace `/notifications`, room events for users/leagues, no dedicated `matches-v2` gateway | COINCIDE | No canonical websocket match contract exists | Keep websocket out of EPIC A canonical contracts unless explicitly designed |
| Fallback boundaries are explicit in code | `matches-v2/ARCHITECTURE.md` | Bridge service comments and predicates explicitly encode correlation/fallback conditions | COINCIDE | This is strong implementation clarity | Preserve this explicitness during future migration |
| Historical 09/03/2026 audit can be directly reconciled from repo contents | User brief expects it as historical base | No such local file was found in workspace or tracked paths | NO EVIDENCIA | Some original architectural intent cannot be quoted directly from local files | Bring the missing audit into repo before relying on it for further recovery work |

## Notable Divergences Worth Carrying Forward

1. "Frontend-safe" does not currently mean "canonically owned at the HTTP edge".
2. The repo implements a stronger hybrid boundary discipline than OpenAPI can express.
3. Legacy result ids and legacy challenge ids are still first-class compatibility constraints for bridge delegation.
4. The current websocket surface is notification-centric, not match-domain canonical.

## EPIC A Risk Notes

- Contract extraction must start from observed controller/bridge output, not from `matches-v2` DTOs alone.
- Any attempt to "just switch `/matches` to v2" will break legacy id chaining and admin semantics.
- `GET /matches/:id` and `GET /matches?challengeId=...` should remain compatibility routes until a replacement is designed and shipped.
- OpenAPI generation is useful, but insufficient to encode source-of-truth ownership.
