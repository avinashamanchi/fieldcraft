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

## Static-review follow-up

The post-commit review identified five fail-closed gaps. Regression tests were
added first; the RED checkpoint was 56 failing and 80 passing focused tests,
and the role-aware PGlite verifier failed the new malicious-payload check.

- Product admission now classifies only the intended public auth/privacy
  routes as public. Every tabs, jobs, invoices, settings, and security route is
  blocked or redirected for signed-out, verification-required, initializing,
  hydrating, missing-lease, and owner-mismatch states. Secure onboarding and
  product routes require the current hydrated lease and repository owner.
- Sign-out, invalid-session callbacks, session-restore failures, and
  subscription failures capture the prior owner and register serialized local
  erasure before revoking access. Failed clears remain retryable across
  provider remounts, and later owners cannot hydrate until the registry drains.
- MFA challenge completion is coordinated by `AuthProvider`: the provider's
  `MFA_CHALLENGE_VERIFIED` event still rotates session generation, and only the
  resulting current lease is marked recently verified. Refresh, background,
  sign-out, owner changes, repository changes, timeout, and teardown cancel it.
- One strict `OnboardingProfileV1Schema` now governs create, SQLite, cloud, and
  gate normalization. SQL mirrors its identity, exact-key, enum, range,
  whitespace, metadata, and canonical millisecond-UTC timestamp contract with
  a `pg_catalog`-only security-definer search path.
- PGlite now executes as public-only, `anon`, and `authenticated` roles and
  proves execution grants, missing/cross-owner/malformed rejection,
  authenticated apply/replay, RLS owner reads, and direct-DML denial.

Follow-up verification under Node 22:

- Exact `b4259f7` checkout: 159/159 prescribed focused tests passed across 4 suites.
- The working tree at that checkpoint: 160/160 focused tests passed; the extra
  test was a preserved, unstaged App Store/EAS release assertion in
  `mobile/__tests__/foundation.test.tsx`, not part of `b4259f7`.
- Exact `b4259f7` PGlite verifier: 34/34 checks passed.
- TypeScript and Expo lint passed with no diagnostics.
- The dirty working-tree full mobile suite passed 480/480 across 46 suites. It
  included preserved release work, so this is not presented as an exact-commit
  test count.
- Root and mobile `npm audit --audit-level=high`: zero vulnerabilities.

## Validation and role-alignment follow-up

The second static review found that the mobile schema used JavaScript UTF-16
length and runtime `trim()`, while PostgreSQL used code-point length and
`btrim()`. It also found that year `0000` was accepted by the mobile timestamp
schema and that the PGlite `service_role` fixture did not model Supabase's
platform role or exercise AAL checks under each runtime role.

Tests were added before implementation. The RED checkpoint was 7 failing and
73 passing onboarding tests: U+0085 boundary whitespace and year `0000` were
accepted, while valid astral strings at the code-point maxima were rejected.
PGlite failed the malicious-payload durability check and the service-role
platform contract; its new four-role AAL matrix already passed.

- Mobile and SQL now share one frozen boundary set: Unicode White_Space plus
  ECMAScript's U+FEFF. Both count Unicode code points, reject the same boundary
  characters, and avoid `trim()`/`btrim()` semantics.
- Canonical timestamps explicitly support years `0001` through `9999` and
  reject year `0000`, malformed dates, offsets, and missing milliseconds.
- Rejected onboarding inputs are checked after every RPC attempt to prove that
  neither a profile mutation nor a durable receipt was written.
- PGlite models `service_role` with `BYPASSRLS` and platform table/sequence
  grants. It proves service access and RLS bypass, serialized-write integrity,
  and explicit onboarding/AAL denial without granting those user-facing RPCs.
- Public-only, `anon`, `authenticated`, and `service_role` execute AAL checks
  under their actual roles for missing, `aal1`, and `aal2` claims; no case is
  executed as the database owner.

Validation-alignment verification under Node 22:

- Exact final Git-index snapshot: 191/191 prescribed focused tests passed
  across 4 suites. This is the commit-owned count; the report itself does not
  affect test discovery.
- Preserved dirty working tree: 192/192 focused tests passed. The one-test
  difference remains the unstaged App Store/EAS release assertion.
- PGlite verifier: 36/36 checks passed from the exact final Git-index snapshot.
- Dirty working-tree full mobile suite: 512/512 passed across 46 suites. This
  includes the preserved foundation assertion and untracked SQLite release
  test, so it is intentionally not labeled an exact-commit count.
- Mobile TypeScript and Expo lint passed with no diagnostics.
- Root and mobile `npm audit --audit-level=high`: zero vulnerabilities.
