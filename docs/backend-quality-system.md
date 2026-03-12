# Backend Quality System

Date: 2026-03-12

Scope:

- Strengthen backend quality discipline without changing public contracts
- Prefer narrow contract and integration coverage over broad refactors
- Keep migration verification lightweight and operationally realistic

## Current Test Layers

### Unit and service specs

The repository already has broad service and controller unit coverage across:

- auth
- matches and matches-v2
- challenges
- notifications
- leagues and rankings
- legacy reservations, availability, clubs, courts, and reports

These tests are good for local logic, DTO validation, and branch behavior.

### Public contract specs

Contract-focused controller specs now cover the highest-signal backend boundaries:

- [matches.contract.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/matches/controllers/matches.contract.spec.ts)
- [challenges.contract.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/challenges/controllers/challenges.contract.spec.ts)
- [user-notifications.contract.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/notifications/controllers/user-notifications.contract.spec.ts)

Coverage intent:

- preserve response shapes
- preserve request-to-service mapping
- preserve stable and hybrid public edge behavior
- avoid accidental DTO drift during internal hardening

### Focused integration specs

Hardening-sensitive integration coverage now includes:

- [auth-hardening.integration.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/auth/controllers/auth-hardening.integration.spec.ts)
- [csrf.middleware.integration.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/common/security/csrf.middleware.integration.spec.ts)

Coverage intent:

- refresh rotation and reuse-rejection behavior at HTTP level
- password reset limiter behavior at HTTP level
- CSRF safe vs unsafe request behavior
- CSRF double-submit cookie flow
- CSRF exemption for Apple OAuth callback

### E2E coverage

The `test/` folder already contains broader feature E2E coverage for:

- inbox and notifications wrappers
- challenges
- leagues
- matches and pending confirmations
- players profile endpoints
- rankings and insights

These are valuable, but they are broader and slower than the contract/integration layer above.

## Gap Analysis

What is already good:

- strong service-level coverage across most modules
- existing public contract work for matches
- migration verification scripts already exist
- build, lint, and test scripts are already straightforward

What was missing:

- contract coverage for challenge coordination/messages and notifications
- HTTP-level verification for auth hardening and CSRF middleware
- a single named quality path for contracts, integration, and migration verification
- one place documenting the intended backend quality stack

Highest-value additions:

- narrow controller contract specs for public edge stability
- focused integration specs for security-sensitive flows
- explicit migration verification command in the quality system
- documented distinction between unit, contract, integration, and E2E responsibilities

## Migration Verification Expectations

Existing workflow support was already present and remains the recommended path:

- `npm run test:migrations`
  Runs `verify:migrations:clean`, which prefers Docker, then a temporary local PostgreSQL cluster, then `DATABASE_URL` fallback.
- `npm run migration:smoke:prod`
  Verifies the compiled datasource and runs `migration:show` when `DATABASE_URL` is available.

Expectation:

- local feature work should at minimum run `npm run lint`, `npm run build`, and relevant focused specs
- release-sensitive or migration-bearing changes should also run `npm run test:migrations`

## Script Discipline

Added scripts:

- `npm run test:contracts`
- `npm run test:integration`
- `npm run test:migrations`
- `npm run quality:backend`
- `npm run quality:backend:migrations`

Intended usage:

- `test:contracts`
  Fast public-edge DTO and mapping verification
- `test:integration`
  Focused hardening and middleware confidence checks
- `quality:backend`
  Main backend quality gate: lint, build, full test suite
- `quality:backend:migrations`
  Extra migration confidence step when schema changes are involved

## CI Status

As of 2026-03-12, no checked-in `.github` workflow was present in the repository.

Recommended backend CI path if a workflow is added later:

1. `npm run quality:backend`
2. `npm run quality:backend:migrations` for migration-bearing changes

This keeps CI expectations explicit without introducing a new brittle workflow in this epic.

## Known Gaps

- No checked-in CI workflow yet
- Migration verification is script-driven rather than enforced by repository CI
- Availability and other heavy SQL paths still rely more on unit/spec coverage than DB-backed integration coverage
- OpenAPI drift checks still rely on the existing snapshot workflow rather than an always-on pipeline

## Known Failing Test Status

The previously known players-domain failure in
[player-competitive-profile.service.spec.ts](/c:/Users/fasol/Documents/GitHub/PadelPoint/src/modules/core/players/services/player-competitive-profile.service.spec.ts)
was fixed in this epic with a tiny isolated test-only stabilization:

- the spec now freezes `Date.now()` so `matchesLast30Days` does not drift as wall-clock time advances

No production behavior was changed for that fix.
