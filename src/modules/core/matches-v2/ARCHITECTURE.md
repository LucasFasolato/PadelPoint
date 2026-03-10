# Matches V2 Architecture

## 1. Overview

`matches-v2` is the canonical backend module for match lifecycle, coordination, and read models that were historically spread across legacy challenge, match, and league services.

It exists to solve the main structural problems of the legacy domain:

- match state was distributed across multiple services with mixed responsibilities
- public DTO compatibility leaked into domain behavior
- lifecycle side effects were coupled to legacy write paths
- compatibility and migration rules were implicit instead of explicit

Today the source of truth for match lifecycle is the canonical `matches-v2` aggregate plus its canonical services. Legacy tables and endpoints still exist as compatibility surfaces, but they are no longer the preferred place to evolve lifecycle behavior.

The current model is:

- canonical state lives in `matches-v2` entities and services
- legacy projections are synchronized by canonical effects when safe
- bridges decide whether a public legacy flow can delegate to canonical services or must stay on fallback/legacy

## 2. Domain Ownership

| Flow | Owner | Notes |
| --- | --- | --- |
| List my matches | matches-v2 | Canonical read flow delegated through `MatchesV2BridgeService` |
| Pending confirmations | matches-v2 | Canonical cursor pagination, legacy shape adapted in bridge |
| Challenge coordination reads | hybrid | Delegated through `ChallengesV2CoordinationBridgeService` when safe correlation exists |
| Challenge proposal/message writes | hybrid | Canonical when challenge correlation is safe, otherwise legacy fallback |
| Match scheduling | matches-v2 | Managed by `MatchSchedulingService` |
| Match result reporting | hybrid | Canonical only when stable legacy correlation preserves public ids |
| Match confirm/reject | hybrid | Canonical only when observable legacy result correlation is safe |
| Match result lifecycle | matches-v2 | Managed by `MatchResultLifecycleService` |
| Match effects and projection sync | matches-v2 | Managed by `MatchEffectsService` |
| Dispute resolution safe subset | hybrid | Narrow delegated subset through `MatchesV2BridgeService` |
| Legacy admin overrides | legacy | `admin-confirm` and `resolve-confirm-as-is` are not modeled canonically yet |
| Legacy dispute open flow | fallback legacy | Canonical dispute semantics do not match the legacy public contract yet |

## 3. Canonical Services

### MatchQueryService

What it does:

- serves canonical match reads
- resolves legacy correlations by `legacyChallengeId` and `legacyMatchResultId`
- owns cursor pagination for canonical match feeds
- hydrates proposals, messages, and dispute state for match detail reads

What it does not do:

- no lifecycle mutations
- no compatibility fallback decisions
- no side effects

Key invariants:

- pagination order is stable and deterministic
- canonical detail reads return a single aggregate view
- legacy correlation queries remain explicit instead of inferred

### MatchSchedulingService

What it does:

- creates, accepts, and rejects canonical scheduling proposals
- persists coordination messages
- moves coordination state between draft, coordinating, and scheduled states

What it does not do:

- no legacy DTO adaptation
- no legacy proposal id compatibility rules
- no result lifecycle transitions

Key invariants:

- only participants can coordinate a match
- proposals must belong to the target match
- only actionable proposals can be accepted or rejected
- a scheduled match cannot be scheduled again

### MatchResultLifecycleService

What it does:

- reports results
- confirms or rejects reported results
- opens and resolves canonical disputes
- enforces canonical participant and state preconditions

What it does not do:

- no legacy response shaping
- no legacy admin override semantics
- no bridge-level compatibility branching

Key invariants:

- only participants can change lifecycle state
- lifecycle transitions are guarded by canonical status checks
- open dispute state is explicit and mutually consistent with match status

### MatchEffectsService

What it does:

- synchronizes the legacy projection when a canonical match has a correlated legacy result id
- applies ELO and standings recomputation when ranking-impacting
- records canonical audit events
- preserves derived fields such as `eloApplied`, `standingsApplied`, and `rankingImpactJson`

What it does not do:

- no request-level compatibility decisions
- no public API adaptation
- no admin RBAC modeling

Key invariants:

- effects are driven by canonical lifecycle transitions
- ranking and standings effects remain idempotent
- legacy projection sync is conditional on explicit correlation, never inferred

## 4. Legacy Bridges

### MatchesV2BridgeService

Why it exists:

- legacy `/matches` endpoints still expose public ids and response shapes that clients depend on
- migration has to be safe per flow, not forced globally

What it does:

- resolves safe legacy-to-canonical correlation
- decides canonical delegation versus legacy fallback
- adapts canonical responses back into legacy-compatible shapes where supported
- documents ownership boundaries for reads, writes, and dispute flows

What it must not do:

- it must not contain domain lifecycle rules that belong in canonical services
- it must not invent new RBAC semantics
- it must not hide fallback behind opaque conditionals

Examples:

- Safe correlation: `legacyMatchResultId` maps to a canonical match and the canonical row still preserves that same observable id.
- Fallback: `openDispute` always stays legacy because the public contract is confirmed-only, windowed, and idempotent, while canonical dispute opening is not.
- Narrow delegation: `resolveDispute` delegates only when the admin caller is also a canonical participant and the match is already canonically disputed with an open dispute.

### ChallengesV2CoordinationBridgeService

Why it exists:

- challenge coordination is exposed through legacy challenge endpoints while canonical coordination state lives in `matches-v2`
- proposal id compatibility still matters for older clients and cached legacy reads

What it does:

- resolves challenge-to-match correlation through `legacyChallengeId`
- delegates coordination reads and writes when the correlated canonical match is safe to use
- falls back when challenge correlation is missing or when a public `proposalId` cannot be resolved canonically

What it must not do:

- it must not reimplement scheduling domain rules
- it must not mint compatibility-only proposal ids inside `matches-v2`
- it must not infer correlation from partial data

Examples:

- Safe correlation: `challengeId` resolves to a canonical match whose `legacyChallengeId` is exactly that same challenge id.
- Fallback: proposal accept/reject stays legacy when the public `proposalId` is not present in the canonical proposal list.

## 5. Correlation Model

| Legacy surface | Canonical field |
| --- | --- |
| `challenge.id` | `matches_v2.legacy_challenge_id` |
| `match_results.id` | `matches_v2.legacy_match_result_id` |

These correlations are required because public legacy endpoints still expose legacy ids while the canonical aggregate lives in separate tables.

Without explicit correlation:

- bridges cannot safely delegate writes
- canonical effects cannot synchronize the correct legacy projection
- compatibility responses would drift away from the observable public contract

The rule is strict: if a correlation is not explicit and exact, delegation must not happen.

## 6. Effects and Projections

Canonical lifecycle writes trigger effects through `MatchEffectsService`.

Main effects:

- ELO application for ranking-impacting matches
- standings recomputation for correlated league matches
- ranking impact persistence
- canonical audit event recording
- legacy match projection synchronization when `legacyMatchResultId` exists

Idempotence is preserved by storing and checking canonical derived flags:

- `eloApplied`
- `standingsApplied`
- `rankingImpactJson`

This allows canonical lifecycle services to remain authoritative while avoiding duplicate ranking side effects when the same logical transition is observed more than once.

## 7. Fallback Boundaries

This section is intentionally explicit. These flows still rely on fallback or legacy ownership because their public contract is not modeled canonically yet.

| Flow | Reason |
| --- | --- |
| `openDispute` | Legacy dispute is confirmed-only, windowed, and idempotent; canonical dispute opens from reported/rejected states and rejects already-open disputes |
| `resolveDispute` non-participant admin path | Public route is admin-only, but canonical resolution is participant-scoped |
| `adminConfirm` | League admin override RBAC and legacy admin-confirm audit semantics are not modeled in `matches-v2` |
| `resolveConfirmAsIs` | Legacy league admin override semantics span disputed and pending-confirm cases and are not expressed canonically |
| Legacy dispute reason codes such as `wrong_winner` or `match_not_played` | No safe canonical reason-code mapping |
| Match result writes without stable correlated legacy ids | Public legacy id chaining would drift |
| Challenge coordination reads/writes without safe `legacyChallengeId` correlation | Cannot safely identify the canonical aggregate |
| Challenge proposal accept/reject with non-resolvable public `proposalId` | Canonical proposal ids cannot be assumed from legacy-compatible inputs |

Fallback is not a failure path. It is an explicit compatibility boundary.

## 8. Future Evolution

Completely removing legacy requires architectural convergence, not more bridge branching.

The main prerequisites are:

- model admin RBAC and override semantics directly in canonical lifecycle services
- formalize dispute windows in canonical lifecycle rules if the public contract still needs them
- normalize dispute and rejection reason codes across legacy and canonical APIs
- migrate legacy admin-only flows to canonical commands with preserved public behavior
- stop exposing legacy-only proposal identifiers and public legacy match result identifiers as compatibility requirements
- remove dependency on legacy projection sync once canonical reads and writes are the only public surfaces

Until those conditions exist, bridges should stay small, explicit, and removable.

## 9. Architectural Principles

- Canonical source of truth: lifecycle state belongs to `matches-v2`, not to compatibility layers.
- Safe delegation: delegation happens only when correlation and semantics are exact.
- Explicit fallback: unsupported cases stay readable in code and tests.
- Idempotent effects: ranking and projection side effects must remain repeat-safe.
- Bridge isolation: bridges adapt contracts and choose ownership, but do not own domain rules.
- No domain logic in compatibility layers: canonical services protect invariants; bridges protect compatibility boundaries.
