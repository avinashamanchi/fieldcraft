# Task 1 Report: Production Identity, Onboarding, and MFA

## Baseline

- HEAD before implementation: `ac6e8a43681739c86ba03bacc41780afba83bcb6`
- Node 22 focused auth/foundation baseline: 52/52 tests passed.
- PGlite sync baseline: 27/27 checks passed.
- Pre-existing release/legal edits and the SQLite compatibility files were preserved outside this task.

## RED evidence

The first focused run failed at the intended missing behavior:

- production auth accepted a noncanonical owner ID;
- auth subscriptions did not carry lifecycle events;
- no authenticated owner lease existed;
- synthetic demo auth still activated from an environment flag;
- onboarding still emitted the legacy six-field shape and had no durable saver/gate;
- MFA and recent-AAL2 modules did not exist.

Additional regression tests were observed failing before their fixes for incomplete-profile routing, drifting onboarding timestamps, repository-reset invalidation, relaunch lease uniqueness, and pre-settlement sign-out invalidation.

## Implementation

- Removed synthetic demo authentication and made Supabase identity canonical and event-bearing.
- Added monotonic immutable owner leases, serialized owner teardown, local/global sign-out, and fail-closed lifecycle invalidation.
- Added the complete versioned onboarding profile, stable idempotent local mutation, cloud RPC/receipt replay, pull normalization, and deep-link-safe onboarding gate.
- Added Supabase TOTP enrollment/step-up, a 15-minute owner/session/repository-bound AAL2 guard, security routes, and SQL AAL2 enforcement.
- Added the identity/security migration and PGlite coverage for complete profile round-trip, receipt replay, and missing/aal1/aal2 claims.

## Verification

- Prescribed Node 22 focused suites: 64/64 passed.
- PGlite verifier: 29/29 passed.
- TypeScript: passed.
- Expo lint: passed with no diagnostics.
- Full mobile Jest suite: 384/384 passed across 46 suites.
