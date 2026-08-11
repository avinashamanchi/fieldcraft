# FieldCraft 25k MAU Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production monetization foundation for a required-identity FieldCraft, including the complete estimate-to-paid-and-exported workflow, RevenueCat Pro, separate Stripe Connect customer payments, and bounded operation at 25,000 MAU.

**Architecture:** Preserve the owner-bound SQLite cache, durable outbox, paged Supabase RPC/RLS sync, and thin Edge Function adapters. StoreKit through RevenueCat is the only iOS payment rail for digital Pro; Stripe Connect-hosted Checkout is used only for real-world customer invoice payments, and verified server webhooks remain authoritative.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router 6, TypeScript 5.9, SQLite, Supabase Auth/Postgres/Realtime/Edge Functions, Zod 4, RevenueCat `react-native-purchases` 10.7.0, StoreKit, Stripe Connect Checkout, Deno 2, PGlite, Jest, k6.

## Global Constraints

- Target exactly 25,000 monthly active users and 2,500 simultaneous foreground sessions.
- Every production user must have a verified Supabase identity; production must contain no guest, demo, local-only owner, or environment-enabled bypass.
- FieldCraft Pro uses RevenueCat entitlement `pro`, offering `default`, and products `fieldcraft_pro_monthly` and `fieldcraft_pro_annual`; render StoreKit-localized prices rather than hardcoded prices.
- Launch catalog is USD $14.99/month and USD $149.99/year in App Store Connect.
- Stripe Connect checkout is only for real-world trade services and must never grant or renew Pro.
- Persist money as integer cents, currency as uppercase ISO 4217, quantities as integer thousandths, and timestamps as UTC ISO 8601.
- Preserve SQLite local durability, one outbox envelope per mutation, idempotent RPC writes, RLS owner checks, and explicit conflicts.
- Cloud pull pages contain at most 200 rows; local UI pages contain at most 50 rows; a sync slice processes at most 10 pages or 2,000 rows before yielding.
- Mutation payloads are at most 256 KiB, each owner may retain at most 1,000 queued operations, and no queued/quarantined write may be silently deleted.
- `sync_changes` retention is 90 days; mutation/provider receipts retain 400 days; content-free operational events retain 30 days.
- Quarantine after 8 automatic attempts or immediately on verified corruption; discard requires typed confirmation after an export offer.
- AAL2 verified within 15 minutes is required for Stripe link/account actions, payment adjustments, full export, MFA disablement, and account deletion.
- Free limits are 10 non-archived clients, 3 open jobs, and 5 newly issued estimates or invoices per rolling 30 days; downgrade never hides or deletes data.
- Pro's technical cap is 10,000 non-archived rows per entity; estimates/invoices contain at most 100 line items.
- Account exports are at most 50 MiB and temporary files are deleted after share or by startup cleanup within 24 hours.
- Multi-user crews remain out of scope until organizations, memberships, roles, invitations, seat billing, attribution, and RLS are explicitly designed; do not add a team flag or shared owner shortcut.
- Never place service-role, Stripe, RevenueCat secret, email-provider, Apple, banking, identity, two-factor, private-key, or raw session material in the client, repository, logs, chat, screenshots, or shell history.

---

### Task 1: Enforce Production Identity and Persist Onboarding/MFA Lifecycle

**Files:**
- Modify: `mobile/src/auth/authService.ts`
- Modify: `mobile/src/auth/AuthProvider.tsx`
- Create: `mobile/src/auth/mfaService.ts`
- Create: `mobile/src/auth/requireAal2.ts`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/(auth)/onboarding.tsx`
- Create: `mobile/app/security/mfa.tsx`
- Create: `mobile/app/security/step-up.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/src/domain/entities.ts`
- Create: `mobile/src/features/onboarding/saveOnboarding.ts`
- Create: `mobile/src/features/onboarding/OnboardingGate.tsx`
- Modify: `mobile/src/data/sqliteRepository.ts`
- Modify: `mobile/src/data/supabaseGateway.ts`
- Create: `supabase/migrations/202608070001_fieldcraft_identity_security.sql`
- Modify: `mobile/__tests__/authLifecycle.test.tsx`
- Create: `mobile/__tests__/onboardingPersistence.test.tsx`
- Create: `mobile/__tests__/mfaLifecycle.test.tsx`
- Modify: `mobile/__tests__/foundation.test.tsx`
- Modify: `mobile/.env.example`
- Modify: `scripts/verify-fieldcraft-sync-pglite.mjs`

**Interfaces:**
- Consumes: `FieldCraftRepository.get<UserProfile>('profile', ownerId)`, `transactLocalMutation`, Supabase session and `auth.mfa` methods.
- Produces: `OnboardingProfileV1`, `createOnboardingMutation`, `MfaService`,
  `requireRecentAal2`, local/global sign-out, `OnboardingGate`, SQL
  `fieldcraft_require_aal2()`, and an immutable
  `AuthenticatedOwnerLease { ownerId; sessionGeneration; repositoryRevision }`;
  no production demo service remains.

- [ ] **Step 1: Write failing identity, relaunch, duplicate-submit, owner-switch, TOTP, and AAL tests**

```tsx
process.env.EXPO_PUBLIC_FIELDCRAFT_DEMO_MODE = 'true'
mockedGetSupabaseClient.mockReturnValue(providerClientWithSession('real-owner-id'))
await expect(getAuthService().getSession()).resolves.toMatchObject({ user: { id: 'real-owner-id' } })
expect(mockedGetSupabaseClient).toHaveBeenCalledTimes(1)
await pressFinishSetupTwice()
expect(repository.transactLocalMutation).toHaveBeenCalledTimes(1)
unmount(); renderGateWithPersistedProfile({ onboardingVersion: 1 })
expect(screen.getByText('Dashboard')).toBeTruthy()
await expect(guard.requireRecentAal2('stripe-connect', now)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' })
await guard.verify('123456')
await expect(guard.requireRecentAal2('stripe-connect', now + 16 * 60_000)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' })
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `cd mobile && npm test -- --runInBand __tests__/authLifecycle.test.tsx __tests__/onboardingPersistence.test.tsx __tests__/mfaLifecycle.test.tsx __tests__/foundation.test.tsx`
Expected: FAIL because demo auth remains and repository-backed onboarding/MFA/AAL2 do not exist.

- [ ] **Step 3: Implement the exact onboarding and MFA contracts**

```ts
export type OnboardingProfileV1 = {
  displayName: string; businessName: string; tradeType: TradeType
  hourlyRateCents: MoneyCents; taxBasisPoints: number; paymentTerms: PaymentTerms
  countryCode: 'US'; currency: 'USD'; timeZone: string
  onboardingVersion: 1; onboardingCompletedAt: string
}
export type SensitiveOperation =
  | 'stripe-connect' | 'payment-link' | 'payment-adjustment'
  | 'account-export' | 'disable-mfa' | 'delete-account'
export interface MfaService {
  enrollTotp(): Promise<{ factorId: string; qrCode: string }>
  verifyEnrollment(factorId: string, code: string): Promise<void>
  stepUp(factorId: string, code: string): Promise<void>
  listVerifiedTotp(): Promise<Array<{ id: string; friendlyName?: string }>>
  unenroll(factorId: string): Promise<void>
}
```

Delete `createLocalDemoAuthService`, `isFieldCraftLocalDemoMode`, and the root
demo branch. Tests inject fakes. Onboarding writes the complete profile plus one
stable mutation ID in a SQLite transaction and round-trips every field through
cloud sync; ambiguous retries reuse the same mutation ID and content. The gate
reads a matching initialized active owner and fails closed on direct/deep-linked
product routes. Increment `sessionGeneration` on every token/session lifecycle
event and `repositoryRevision` on each initialized/cleared owner boundary; issue
an immutable owner lease only when all three values still match. Clear in-memory
AAL2 on background, token refresh, owner/session/repository change, and sign-out.

- [ ] **Step 4: Add server AAL enforcement and pass green gates**

```sql
create function public.fieldcraft_require_aal2() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'AAL2_REQUIRED';
  end if;
end $$;
```

Run: `npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/authLifecycle.test.tsx __tests__/onboardingPersistence.test.tsx __tests__/mfaLifecycle.test.tsx __tests__/foundation.test.tsx && npm run typecheck && npm run lint`
Expected: PASS, including 15-minute step-up expiry, local/global sign-out, offline relaunch, and no synthetic demo session under any environment value.

- [ ] **Step 5: Commit the identity boundary**

Stage only the literal Task 1 file list, require the cached name-status list to
equal that allowlist, inspect the cached diff, and commit with
`feat: require identity and secure onboarding`. Reconcile already-dirty files
line by line and never stage a directory wholesale.

### Task 2: Add Downgrade-Safe Pro Policy and RevenueCat Reconciliation

**Files:**
- Create: `mobile/src/domain/monetization.ts`
- Create: `mobile/src/billing/entitlementStore.ts`
- Create: `mobile/src/billing/revenueCatClient.ts`
- Create: `mobile/src/billing/SubscriptionProvider.tsx`
- Create: `mobile/src/billing/featureAdmission.ts`
- Modify: `mobile/src/domain/sync.ts`
- Modify: `mobile/src/data/supabaseGateway.ts`
- Create: `mobile/app/subscription/index.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`
- Modify: `mobile/app.config.ts`
- Modify: `mobile/.env.example`
- Create: `supabase/migrations/202608070002_fieldcraft_entitlements.sql`
- Create: `supabase/functions/revenuecat-webhook/index.ts`
- Create: `supabase/functions/revenuecat-webhook/index_test.ts`
- Create: `supabase/functions/_shared/observability.ts`
- Create: `mobile/__tests__/monetizationPolicy.test.ts`
- Create: `mobile/__tests__/revenueCatClient.test.ts`
- Create: `mobile/__tests__/subscriptionFlow.test.tsx`
- Create: `mobile/__tests__/featureAdmission.test.ts`
- Modify: `supabase/tests/database/fieldcraft_rls.test.sql`
- Modify: `supabase/tests/database/fieldcraft_idempotency.test.sql`
- Modify: `scripts/verify-fieldcraft-sync-pglite.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/release-readiness.yml`

**Interfaces:**
- Consumes: Task 1's immutable
  `AuthenticatedOwnerLease { ownerId; sessionGeneration; repositoryRevision }`,
  stable outbox mutation IDs, public iOS RevenueCat SDK key, offering `default`,
  entitlement `pro`, and a bounded authorized webhook.
- Produces: `evaluateFeature`, owner-lease-bound `EntitlementStore`,
  `RevenueCatClient`, `FeatureAdmissionService`, purchase/restore/manage UI,
  `subscription_entitlements`, atomic provider receipt reconciliation,
  `get_my_entitlement()`, and idempotent `reserve_feature_admission()`.

- [ ] **Step 1: Install the exact SDK and write failing policy/client/webhook tests**

Run: `cd mobile && npm install --save-exact react-native-purchases@10.7.0`
Then cover free limits at limit-1/limit, downgrade edits/exports, server/client
mismatch, configure/logIn order, owner logOut, cancellation/pending/restore,
query-time and timer-driven expiry, billing retry/grace, refund/revoke, Expo Go
no-purchase, wrong webhook auth, body over 64 KiB, malformed UUID,
duplicate/out-of-order/equal-timestamp events, atomic rollback, and RLS.

For every create that would exceed a free limit, allocate the stable mutation ID
first and prove the client obtains exactly one online
`reserve_feature_admission(mutation_id, feature)` result before starting the
local SQLite transaction. A timeout/offline/stale entitlement returns
`ENTITLEMENT_STALE` and queues nothing. Ambiguous retries reuse the same mutation
ID and admission. A retained admission must allow the matching outbox mutation
to replay after subscription expiry but never allow a different owner, feature,
mutation, or second business write.

Exercise owner change, token refresh, repository reset, foreground refresh,
purchase, restore, and a late RevenueCat listener callback at every await point.
The old lease must become inert before provider logout/repository teardown, and
the next owner must not start until teardown completes.

```ts
export type Feature =
  | 'create-client' | 'create-open-job' | 'issue-document'
  | 'stripe-payment-link' | 'scheduled-reminder' | 'revenue-dashboard'
  | 'edit-existing-record' | 'record-payment' | 'export-account' | 'delete-account'
export type FeatureDecision =
  | { allowed: true }
  | { allowed: false; reason: 'FREE_LIMIT' | 'PRO_REQUIRED' | 'ENTITLEMENT_STALE'; limit?: number }
```

- [ ] **Step 2: Verify red across mobile/function/database**

Run: `cd mobile && npm test -- --runInBand __tests__/monetizationPolicy.test.ts __tests__/revenueCatClient.test.ts __tests__/subscriptionFlow.test.tsx && cd .. && deno test supabase/functions/revenuecat-webhook/index_test.ts && npm run test:supabase-pglite`
Expected: FAIL before modules, route, migration, and function exist.

- [ ] **Step 3: Implement the mobile purchase and owner lifecycle**

```ts
export interface RevenueCatClient {
  start(lease: AuthenticatedOwnerLease): Promise<ProEntitlement>
  getPackages(): Promise<SubscriptionPackage[]>
  purchase(packageId: string): Promise<'purchased' | 'cancelled' | 'pending'>
  restore(): Promise<ProEntitlement>
  openManageSubscriptions(): Promise<void>
  stop(lease: AuthenticatedOwnerLease): Promise<void>
  subscribe(listener: (value: ProEntitlement) => void): () => void
}
export const FREE_LIMITS = { clients: 10, openJobs: 3, issuedDocumentsPerRolling30Days: 5 } as const
```

Render StoreKit package prices and renewal copy. Only an unexpired provider and
server-verified `pro` unlocks. Expo Go says `Purchases require the FieldCraft
development build`; no state/button grants Pro. Downgrade preserves
read/edit/sync/pay/export/delete.

Bind every request, listener, purchase, restore, and refresh result to the full
owner lease. Invalidate it before calling RevenueCat logout or repository
teardown, serialize teardown/start, ignore every late result whose lease no
longer matches, and expose `unknown` while the new owner is being verified.
Above-free offline creation is unavailable by design; all other offline edits,
payments, exports, deletes, and below-limit creates retain their current local
durability.

- [ ] **Step 4: Implement the strict webhook mirror and pass green gates**

```sql
create table public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entitlement text not null check (entitlement = 'pro'),
  product_id text not null check (product_id in ('fieldcraft_pro_monthly','fieldcraft_pro_annual')),
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  status text not null check (status in
    ('active','cancelled','billing_retry','grace_period','expired','revoked','refunded')),
  expires_at timestamptz, provider_event_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp()
);
```

Migration `202608070002` must run after `202608070001`, create
`revenuecat_event_receipts` and `feature_admissions`, and replace any entitlement
or admission write surface with strict RPCs. The Edge Function may validate and
normalize, but only the service-role-only SQL RPC
`apply_revenuecat_event(...)` may write provider receipts or entitlements. In
one transaction it hashes/stores the `(provider,event_id)` receipt, locks the
owner entitlement row, applies the event or classifies it as duplicate/stale,
and returns exactly `applied | duplicate | stale`; a failure changes neither
table.

Use this transition policy: initial purchase/renewal/uncancellation/product
change is active; cancellation remains entitled until `expires_at`; billing
issue/retry or grace remains entitled only while RevenueCat reports the
entitlement active and its provider expiry is future; expiration becomes
inactive at the earlier of an expiration event or query/client-timer/relaunch
observing `expires_at`; refund/revoke is immediately inactive and terminal.
Older events never overwrite newer state. At equal provider timestamps,
refund/revoke outranks expiration, which outranks cancellation/billing state,
which outranks active state. A later nonterminal event cannot resurrect a
terminal refund/revoke without an explicitly newer qualifying purchase event.

`reserve_feature_admission(mutation_id, feature)` locks the authenticated owner,
rechecks query-time entitlement plus authoritative rolling/current counts, and
stores one immutable 400-day receipt keyed by owner/mutation/feature. A retry
returns the original decision. Existing mutation RPCs must require and consume
that matching retained receipt for above-free client/open-job/document creates,
including after the subscription later expires; no receipt means no above-free
write. Below-free creates and downgrade-safe operations retain their existing
path.

Bound the webhook to 64 KiB/10 seconds, use constant-time authorization, exact
field/UUID/product/app/environment validation, and content-free logs. PGlite
must load `070001` then `070002`, provide `auth.jwt()`, and prove anon/direct
table/cross-owner access is denied; only authenticated owners may execute
`get_my_entitlement` and `reserve_feature_admission`, and only service role may
execute `apply_revenuecat_event`.

Add dynamic root scripts that test and check every
`supabase/functions/*/index_test.ts` and `supabase/functions/*/index.ts`. CI,
deployment, and release-readiness workflows must call those shared scripts so a
new function cannot be silently omitted.

Run: `deno fmt --check supabase/functions && deno lint supabase/functions && npm run test:supabase-functions && npm run check:supabase-functions && npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/monetizationPolicy.test.ts __tests__/revenueCatClient.test.ts __tests__/subscriptionFlow.test.tsx __tests__/featureAdmission.test.ts && npm run typecheck && npm run lint && npx expo-doctor && npm run export:ios`
Expected: PASS with atomic event/application receipts, no bypassable above-free
write, and no client/server entitlement leak across owner/session/repository
change.

- [ ] **Step 5: Commit Pro subscriptions**

Stage only the literal Task 2 file list, require the cached name-status list to
equal that allowlist, inspect the cached diff, and commit with
`feat: add RevenueCat Pro subscriptions`. Reconcile already-dirty files line by
line and never stage a directory wholesale.

### Task 3: Add the Canonical Estimate-to-Payment Lifecycle

**Files:**
- Modify: `mobile/src/domain/entities.ts`
- Modify: `mobile/src/domain/sync.ts`
- Modify: `mobile/src/domain/invoice.ts`
- Create: `mobile/src/domain/estimates.ts`
- Create: `mobile/src/domain/payments.ts`
- Create: `mobile/src/domain/reminders.ts`
- Create: `supabase/migrations/202608070003_fieldcraft_business_lifecycle.sql`
- Modify: `supabase/tests/database/fieldcraft_constraints.test.sql`
- Modify: `supabase/tests/database/fieldcraft_idempotency.test.sql`
- Modify: `supabase/tests/database/fieldcraft_rls.test.sql`
- Modify: `supabase/tests/database/fieldcraft_sync_feed.test.sql`
- Modify: `scripts/verify-fieldcraft-sync-pglite.mjs`
- Create: `mobile/__tests__/estimateDomain.test.ts`
- Create: `mobile/__tests__/paymentDomain.test.ts`
- Create: `mobile/__tests__/reminderDomain.test.ts`
- Modify: `mobile/__tests__/invoiceDomain.test.ts`

**Interfaces:**
- Consumes: existing integer-cent invoice math, owner/version envelope, mutation receipt, sync-change capture, and Task 1 AAL2 helper.
- Produces: strict `Estimate`, `Payment`, `ReminderSchedule`, lifecycle transitions, payment summary math, canonical tables/RLS/indexes, and idempotent lifecycle RPCs.

- [ ] **Step 1: Write failing domain/SQL tests**

```ts
expect(calculatePaymentSummary(10_000, [succeeded(2_500), succeeded(2_500)]))
  .toEqual({ paidCents: 5_000, balanceCents: 5_000, status: 'Partially Paid' })
expect(calculatePaymentSummary(10_000, [succeeded(10_000), refunded(2_000)]))
  .toMatchObject({ paidCents: 8_000, status: 'Partially Paid' })
expect(() => calculatePaymentSummary(10_000, [succeeded(10_001)])).toThrow('PAYMENT_EXCEEDS_BALANCE')
```

SQL tests cover owner mismatch, 101 line items, invalid transition, duplicate conversion/issue/payment event, overpayment/refund, stale base version, replay equality, free/server cap, AAL2 adjustment, and cross-owner access.

- [ ] **Step 2: Run mobile/database tests and verify red**

Run: `cd mobile && npm test -- --runInBand __tests__/estimateDomain.test.ts __tests__/paymentDomain.test.ts __tests__/reminderDomain.test.ts __tests__/invoiceDomain.test.ts && cd .. && npm run test:supabase-pglite`
Expected: FAIL before contracts and schema exist.

- [ ] **Step 3: Implement exact lifecycle types and calculations**

```ts
export type EstimateStatus = 'Draft' | 'Issued' | 'Accepted' | 'Declined' | 'Expired' | 'Converted' | 'Void'
export type JobStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Invoiced' | 'Partially Paid' | 'Paid' | 'Cancelled'
export type InvoiceStatus = 'Draft' | 'Issued' | 'Viewed' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Void'
export type PaymentStatus = 'Pending' | 'Succeeded' | 'Failed' | 'Partially Refunded' | 'Refunded' | 'Disputed'
export type PaymentMethod = 'Stripe' | 'Cash' | 'Check' | 'Bank Transfer' | 'Other'
export type LifecycleMutationKind = 'save_estimate' | 'convert_estimate' | 'issue_invoice' | 'record_manual_payment'
```

Issued estimates retain immutable snapshots/revisions. Manual acceptance records actor/time without claiming signature. Payments are append-only; invoice/job payment projection derives from succeeded minus refunded cents. `Overdue` is display-derived from due time and positive balance.

- [ ] **Step 4: Add locked RLS/RPC implementation and pass green gates**

Create owned `estimates`, `payments`, `reminder_schedules`, and `reminder_deliveries` with composite foreign keys, exact bounds, `(user_id,status,updated_at,id)` indexes, select-only RLS, and sync triggers. Add RPCs:

```sql
save_estimate(p_mutation_id uuid, p_payload jsonb) returns jsonb
convert_estimate(p_mutation_id uuid, p_payload jsonb) returns jsonb
issue_invoice(p_mutation_id uuid, p_payload jsonb) returns jsonb
record_manual_payment(p_mutation_id uuid, p_payload jsonb) returns jsonb
apply_provider_payment_event(p_provider_event_id text, p_payload jsonb) returns jsonb
```

Each derives `auth.uid()` where user-called, fixes `search_path=''`, validates exact JSON, locks owner/rows, enforces server limits/AAL2, writes one receipt, and returns identical replay.

Run: `npm run check:supabase-boundary && npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/estimateDomain.test.ts __tests__/paymentDomain.test.ts __tests__/reminderDomain.test.ts __tests__/invoiceDomain.test.ts && npm run typecheck && npm run lint`
Expected: PASS with atomic conversion and one ledger result per replayed event.

- [ ] **Step 5: Commit lifecycle contracts**

```bash
git add mobile/src/domain mobile/__tests__ supabase/migrations supabase/tests scripts/verify-fieldcraft-sync-pglite.mjs
git commit -m "feat: add canonical service lifecycle"
```

### Task 4: Bound SQLite, Pagination, Sync Retention, and Poison Recovery

**Files:**
- Modify: `mobile/src/data/migrations.ts`
- Modify: `mobile/src/data/repository.ts`
- Modify: `mobile/src/data/sqliteRepository.ts`
- Modify: `mobile/src/data/outbox.ts`
- Modify: `mobile/src/data/remoteGateway.ts`
- Modify: `mobile/src/data/supabaseGateway.ts`
- Modify: `mobile/src/data/syncCoordinator.ts`
- Create: `mobile/src/data/pagination.ts`
- Create: `mobile/src/data/quarantine.ts`
- Create: `supabase/migrations/202608070004_fieldcraft_sync_retention.sql`
- Create: `mobile/app/settings/sync-diagnostics.tsx`
- Create: `mobile/__tests__/repositoryPagination.test.ts`
- Create: `mobile/__tests__/quarantine.test.ts`
- Modify: `mobile/__tests__/migrations.sqlite.test.ts`
- Modify: `mobile/__tests__/outbox.test.ts`
- Modify: `mobile/__tests__/syncCoordinator.test.ts`
- Modify: `mobile/__tests__/syncUpgrade.test.ts`
- Modify: `mobile/__tests__/realtimeLifecycle.test.ts`
- Modify: `mobile/__tests__/supabaseGatewayHardening.test.ts`
- Modify: `supabase/tests/database/fieldcraft_sync_feed.test.sql`
- Modify: `scripts/verify-fieldcraft-sync-pglite.mjs`

**Interfaces:**
- Consumes: active owner boundary, canonical records/outbox hash, change-sequence feed, staged snapshot support.
- Produces: 50-row keyset local paging, 200-row cloud paging, 10-page slice yield, cursor-expired snapshot reset, 2-second/5-second Realtime coalescing, queue caps, and recoverable quarantine.

- [ ] **Step 1: Write failing boundary/recovery tests**

```ts
expect(await repository.listPage('invoice', { limit: 50, after: null })).toEqual({ items: expect.any(Array), next: expect.anything() })
await expect(repository.listPage('invoice', { limit: 51, after: null })).rejects.toThrow('PAGE_LIMIT')
await repository.recordMutationAttempt(owner, mutationId, 8, 'invalid-response')
expect(await repository.listQuarantined(owner)).toContainEqual(expect.objectContaining({ mutationId, attempts: 8 }))
expect(clock.yields).toBe(1) // after 10 pages
expect(resetResult).toMatchObject({ preservedOutbox: true, snapshotWatermark: 9_000 })
```

Add SQL tests for expired cursor metadata, safe 90-day pruning, 400-day receipts, 30-day operational events, and no pruning past a required watermark.

- [ ] **Step 2: Run focused tests and verify red**

Run: `npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/repositoryPagination.test.ts __tests__/quarantine.test.ts __tests__/migrations.sqlite.test.ts __tests__/outbox.test.ts __tests__/syncCoordinator.test.ts __tests__/syncUpgrade.test.ts __tests__/realtimeLifecycle.test.ts __tests__/supabaseGatewayHardening.test.ts`
Expected: FAIL before paged/quarantine/reset contracts exist.

- [ ] **Step 3: Implement exact local/remote interfaces and migrations**

```ts
export type PageCursor = { updatedAt: string; id: string }
export type Page<T> = { items: T[]; next: PageCursor | null }
export type PullResult =
  | { type: 'page'; rows: CloudRowEnvelope[]; cursor: string; hasMore: boolean }
  | { type: 'cursorExpired'; snapshotWatermark: number; snapshotCursor: string | null }
export type QuarantineReason = 'validation' | 'unsupported-schema' | 'integrity' | 'invalid-response' | 'attempt-limit'
export interface QuarantineRepository {
  listQuarantined(ownerId: string): Promise<QuarantinedMutation[]>
  retryQuarantined(ownerId: string, mutationId: string): Promise<void>
  supersedeQuarantined(ownerId: string, mutationId: string, replacement: MutationEnvelope): Promise<void>
  discardQuarantined(ownerId: string, mutationId: string, confirmation: 'DISCARD UNSYNCED CHANGE'): Promise<void>
}
```

Add SQLite `quarantined_outbox` and `outbox_dependencies`; move atomically, retain bounded payload/hash, never log content. Queue 1,001 and payload 256 KiB+1 fail before local mutation. Diagnostics supports retry, edit/supersede, export, and confirmed discard.

- [ ] **Step 4: Implement retention/reset/coalescing and pass green gates**

Add `sync_device_cursors`, `sync_retention_watermarks`, and `prune_fieldcraft_operational_data(now)`. Pull 200, commit per page, yield after 10, resume durable cursor. On expiration, stage/verify/swap snapshot while preserving outbox/quarantine, then replay. Realtime transports invalidation only, debounces 2 seconds, and pulls at most every 5 seconds.

Run: `npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/repositoryPagination.test.ts __tests__/quarantine.test.ts __tests__/migrations.sqlite.test.ts __tests__/outbox.test.ts __tests__/syncCoordinator.test.ts __tests__/syncUpgrade.test.ts __tests__/realtimeLifecycle.test.ts __tests__/supabaseGatewayHardening.test.ts && npm run typecheck && npm run lint`
Expected: PASS at 49/50/51, 999/1000/1001, 7/8 attempts, equal-timestamp pages, reset, abort, owner switch, and dependency-block boundaries.

- [ ] **Step 5: Commit bounded offline sync**

```bash
git add mobile/src/data mobile/app/settings/sync-diagnostics.tsx mobile/__tests__ supabase/migrations supabase/tests scripts/verify-fieldcraft-sync-pglite.mjs
git commit -m "feat: bound sync and recover poison writes"
```

### Task 5: Build the Complete Mobile Estimate/Job/Invoice/Payment/Reminder/Export Loop

**Files:**
- Create: `mobile/src/features/estimates/estimateForm.ts`
- Create: `mobile/src/features/estimates/EstimateEditor.tsx`
- Create: `mobile/src/features/estimates/estimateCommands.ts`
- Create: `mobile/src/features/payments/paymentCommands.ts`
- Create: `mobile/src/features/payments/PaymentHistory.tsx`
- Create: `mobile/src/features/reminders/reminderService.ts`
- Create: `mobile/src/exports/exportSchemas.ts`
- Create: `mobile/src/exports/accountExport.ts`
- Create: `mobile/src/exports/csvExport.ts`
- Modify: `mobile/src/features/invoices/saveInvoiceBundle.ts`
- Modify: `mobile/src/files/invoicePdf.ts`
- Modify: `mobile/src/files/tempArtifactRegistry.ts`
- Create: `mobile/app/(tabs)/estimates.tsx`
- Create: `mobile/app/estimates/new.tsx`
- Create: `mobile/app/estimates/[id].tsx`
- Create: `mobile/app/invoices/[id]/record-payment.tsx`
- Create: `mobile/app/invoices/[id]/reminders.tsx`
- Create: `mobile/app/settings/export.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/app/invoices/[id].tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/src/components/VirtualizedEntityList.tsx`
- Create: `mobile/__tests__/estimateFlow.test.tsx`
- Create: `mobile/__tests__/manualPaymentFlow.test.tsx`
- Create: `mobile/__tests__/reminderFlow.test.tsx`
- Create: `mobile/__tests__/accountExport.test.ts`
- Modify: `mobile/__tests__/invoiceFlow.test.tsx`
- Modify: `mobile/__tests__/invoicePdf.test.ts`
- Modify: `mobile/__tests__/navigation.test.tsx`
- Modify: `mobile/__tests__/accessibilityRelease.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 owner/AAL, policy, lifecycle RPC envelopes, `listPage`, repository transaction, and artifact registry.
- Produces: accessible complete manual loop, ledger-derived paid/balance state, manual reminders, and paged CSV/JSON exports available to free/expired users.

- [ ] **Step 1: Write failing end-to-end component/file tests**

Test offline draft→issue→manual accept→convert once→invoice→$25 partial→$75 full→manual reminder→PDF/CSV/JSON export; duplicate taps; free fifth/sixth issue; downgrade; validation/local failure input retention; 50-row pagination; owner switch; AAL2 export; 50 MiB stop; checksum; share cleanup; 24-hour sweep; 200% Dynamic Type and VoiceOver.

Run: `cd mobile && npm test -- --runInBand __tests__/estimateFlow.test.tsx __tests__/manualPaymentFlow.test.tsx __tests__/reminderFlow.test.tsx __tests__/accountExport.test.ts __tests__/invoiceFlow.test.tsx __tests__/invoicePdf.test.ts __tests__/navigation.test.tsx __tests__/accessibilityRelease.test.tsx`
Expected: FAIL before routes/features exist.

- [ ] **Step 2: Implement exact command and export interfaces**

```ts
export function buildEstimateMutation(input: EstimateMutationInput): MutationEnvelope
export function buildIssueEstimateMutation(input: { estimate: Estimate; mutationId: string; issuedAt: string }): MutationEnvelope
export function buildConvertEstimateMutation(input: { estimate: Estimate; mutationId: string; jobId: string; now: string }): MutationEnvelope
export function buildManualPaymentMutation(input: {
  ownerId: string; invoice: Invoice; payments: Payment[]; amountCents: MoneyCents
  method: Exclude<PaymentMethod, 'Stripe'>; note?: string
  paymentId: string; mutationId: string; recordedAt: string
}): MutationEnvelope
export type ExportManifestV1 = {
  schemaVersion: 1; ownerId: string; createdAt: string
  files: Array<{ name: string; rows: number; sha256: string; bytes: number }>
}
```

Allocate entity/mutation IDs once. Calculate locally and preserve issued snapshots. Manual acceptance says owner-recorded, not signed. Manual payment cannot exceed balance. Manual reminder says share sheet opened, not delivered.

- [ ] **Step 3: Build paged accessible routes and bounded export**

Lists fetch/virtualize 50 at a time. Every flow renders loading, empty, offline, pending, conflict, quarantine, validation, and failure states. Payment history shows captured/refunded/disputed/balance provenance. Invoice PDF shows payment summary and `Created with FieldCraft` for free users. Export fetches 50 at a time, deterministically escapes CSV/JSON, excludes tokens/receipt paths/provider secrets, aborts on owner change, caps 50 MiB, and cleans partial/final files.

- [ ] **Step 4: Run green mobile gates**

Run: `cd mobile && npm test -- --runInBand __tests__/estimateFlow.test.tsx __tests__/manualPaymentFlow.test.tsx __tests__/reminderFlow.test.tsx __tests__/accountExport.test.ts __tests__/invoiceFlow.test.tsx __tests__/invoicePdf.test.ts __tests__/navigation.test.tsx __tests__/accessibilityRelease.test.tsx && npm run typecheck && npm run lint`
Expected: PASS for the complete manual loop without a provider account.

- [ ] **Step 5: Commit the complete manual workflow**

```bash
git add mobile/src/features mobile/src/exports mobile/src/files mobile/src/components mobile/app mobile/__tests__
git commit -m "feat: complete FieldCraft service workflow"
```

### Task 6: Add Stripe Connect Checkout and Scheduled Reminder Backends

**Files:**
- Create: `supabase/migrations/202608070005_fieldcraft_pro_services.sql`
- Create: `supabase/functions/_shared/stripe.ts`
- Create: `supabase/functions/_shared/reminderProvider.ts`
- Create: `supabase/functions/stripe-connect/index.ts`
- Create: `supabase/functions/stripe-connect/index_test.ts`
- Create: `supabase/functions/stripe-checkout/index.ts`
- Create: `supabase/functions/stripe-checkout/index_test.ts`
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `supabase/functions/stripe-webhook/index_test.ts`
- Create: `supabase/functions/payment-link/index.ts`
- Create: `supabase/functions/payment-link/index_test.ts`
- Create: `supabase/functions/reminder-worker/index.ts`
- Create: `supabase/functions/reminder-worker/index_test.ts`
- Create: `supabase/functions/reminder-webhook/index.ts`
- Create: `supabase/functions/reminder-webhook/index_test.ts`
- Create: `mobile/src/payments/paymentService.ts`
- Create: `mobile/app/settings/payments.tsx`
- Create: `mobile/app/invoices/[id]/payment-link.tsx`
- Modify: `mobile/app/invoices/[id]/reminders.tsx`
- Create: `mobile/__tests__/stripePaymentFlow.test.tsx`
- Modify: `mobile/__tests__/reminderFlow.test.tsx`
- Modify: `scripts/verify-fieldcraft-sync-pglite.mjs`
- Modify: `scripts/scan-secrets.mjs`

**Interfaces:**
- Consumes: AAL2 owner, active server `pro`, connected account capability, authoritative invoice balance, Stripe raw signature, reminder provider credential.
- Produces: Connect onboarding/status, opaque invoice links, direct-charge Checkout, webhook ledger reconciliation, scheduled reminder claim/send/delivery, and mobile management.

- [ ] **Step 1: Write failing function/mobile/database boundary tests**

Cover AAL1/free/unowned denial, inactive capability, random-token digest/expiry/revocation, $0.99 and over-balance rejection, exact-amount idempotency, raw Stripe signature failure, duplicate/out-of-order success/refund/dispute, redirect no-op, -3/0/+7 reminder occurrences, concurrent worker claims, paid/void/free/no-email cancellation, bounce, and content-free logs.

Run: `deno test supabase/functions/stripe-connect/index_test.ts supabase/functions/stripe-checkout/index_test.ts supabase/functions/stripe-webhook/index_test.ts supabase/functions/payment-link/index_test.ts supabase/functions/reminder-worker/index_test.ts supabase/functions/reminder-webhook/index_test.ts && cd mobile && npm test -- --runInBand __tests__/stripePaymentFlow.test.tsx __tests__/reminderFlow.test.tsx && cd .. && npm run test:supabase-pglite`
Expected: FAIL before schema/functions/client exist.

- [ ] **Step 2: Add minimal provider-reference schema and claims**

```sql
create table public.stripe_connected_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  requirements_state text not null check (requirements_state in ('pending','restricted','complete')),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.invoice_payment_links (
  id uuid primary key, user_id uuid not null, invoice_id uuid not null,
  token_hash bytea not null unique, expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create unique index reminder_delivery_occurrence_idx
  on public.reminder_deliveries(invoice_id, schedule_id, due_occurrence);
```

Store no raw public token, bank/identity/card data, message body, or provider secret. Reminder claim caps 100, uses `FOR UPDATE SKIP LOCKED`, leases 5 minutes, and rechecks balance/recipient/entitlement.

- [ ] **Step 3: Implement strict provider/mobile interfaces**

```ts
export interface PaymentService {
  createConnectOnboarding(): Promise<{ url: string; expiresAt: string }>
  refreshConnectStatus(): Promise<ConnectStatus>
  disconnectConnect(): Promise<void>
  createPaymentLink(invoiceId: string): Promise<{ url: string; expiresAt: string }>
  revokePaymentLink(invoiceId: string): Promise<void>
}
export interface ReminderDeliveryGateway {
  send(input: { idempotencyKey: string; to: string; subject: string; text: string; replyTo?: string }): Promise<{ providerMessageId: string; acceptedAt: string }>
}
```

Use HTTPS, 10-second deadlines, 64 KiB caps, provider idempotency keys, direct-charge `Stripe-Account`, hosted Checkout, and raw-byte signature verification before JSON. Payment redirect says confirmation is pending and cannot write ledger state. Public page exposes only business name, invoice number, USD total/paid/balance/allowed amount. Copy says `Apple Pay or card when available`.

- [ ] **Step 4: Pass provider boundary gates**

Run: `deno fmt --check supabase/functions && deno lint supabase/functions && deno test supabase/functions/stripe-connect/index_test.ts supabase/functions/stripe-checkout/index_test.ts supabase/functions/stripe-webhook/index_test.ts supabase/functions/payment-link/index_test.ts supabase/functions/reminder-worker/index_test.ts supabase/functions/reminder-webhook/index_test.ts && deno check supabase/functions/stripe-connect/index.ts supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/payment-link/index.ts supabase/functions/reminder-worker/index.ts supabase/functions/reminder-webhook/index.ts && npm run test:supabase-pglite && cd mobile && npm test -- --runInBand __tests__/stripePaymentFlow.test.tsx __tests__/reminderFlow.test.tsx && npm run typecheck`
Expected: PASS with one ledger/delivery transition per duplicate event.

- [ ] **Step 5: Commit Pro service adapters**

```bash
git add supabase/migrations supabase/functions scripts mobile/src/payments mobile/app mobile/__tests__
git commit -m "feat: add connected payments and reminders"
```

### Task 7: Extend Privacy, Observability, Capacity, and Release Documentation

**Files:**
- Create: `supabase/migrations/202608070006_fieldcraft_observability.sql`
- Modify: `supabase/functions/_shared/observability.ts`
- Modify: `supabase/functions/delete-account/index.ts`
- Modify: `supabase/functions/delete-account/index_test.ts`
- Modify: `mobile/src/privacy/deleteAccount.ts`
- Modify: `mobile/src/privacy/deleteLocalData.ts`
- Create: `mobile/src/observability/events.ts`
- Create: `mobile/src/observability/diagnostics.ts`
- Modify: `mobile/app/settings/delete-account.tsx`
- Modify: `mobile/app/settings/delete-data.tsx`
- Create: `scripts/load/sync-capacity.js`
- Create: `scripts/load/webhook-capacity.js`
- Create: `scripts/load/realtime-capacity.js`
- Create: `scripts/load/assert-no-cross-owner.js`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-readiness.yml`
- Modify: `scripts/scan-secrets.mjs`
- Modify: `mobile/__tests__/deleteAccount.test.tsx`
- Modify: `mobile/__tests__/deleteLocalData.test.ts`
- Create: `mobile/__tests__/observability.test.ts`
- Modify: `docs/app-store/fieldcraft-ios-metadata.md`
- Modify: `docs/app-store/fieldcraft-ios-release-checklist.md`
- Modify: `docs/app-store/fieldcraft-ios-screenshot-matrix.md`
- Modify: `public/privacy.html`
- Modify: `public/terms.html`
- Modify: `public/support.html`

**Interfaces:**
- Consumes: all local/provider subsystems, UUID request IDs, rotating-HMAC owner digests, production-equivalent staging URL/synthetic users.
- Produces: retryable coordinated deletion, allowlisted content-free telemetry, exact k6 gates, truthful legal/App Store artifacts, and full credential-free verification.

- [ ] **Step 1: Write failing deletion/redaction/static-release tests**

```ts
export type DeleteSubsystem =
  | 'repository' | 'outbox' | 'quarantine' | 'conflicts' | 'auth'
  | 'entitlement' | 'stripe-links' | 'reminders' | 'consent' | 'artifacts' | 'memory'
expect(redactEvent({ email: 'a@example.test', invoice: 'secret', status: 'failed' }))
  .toEqual({ status: 'failed' })
await expect(evaluateSyncLoad(sampleWithP95(749))).resolves.toMatchObject({ passed: true })
await expect(evaluateSyncLoad(sampleWithP95(751))).resolves.toMatchObject({ passed: false, reason: 'SYNC_P95' })
await expect(runRealtimeScenario({ foregroundSessions: 2_500, reconnectsIn60Seconds: 1_000 }))
  .resolves.toMatchObject({ passed: true, crossOwnerReads: 0 })
```

Cover AAL1 deletion denial, generation invalidation, link/reminder revocation, provider unlink failure, cloud success/local failure, retry restart, no false success, metadata Pro-vs-customer-payment separation, no guaranteed Apple Pay/demo path, and no secret pattern.

- [ ] **Step 2: Run focused tests and verify red**

Run: `deno test supabase/functions/delete-account/index_test.ts && cd mobile && npm test -- --runInBand __tests__/deleteAccount.test.tsx __tests__/deleteLocalData.test.ts __tests__/observability.test.ts && cd .. && npm run scan:secrets`
Expected: FAIL until new subsystems, telemetry, load scripts, and release copy are wired.

- [ ] **Step 3: Implement deletion, telemetry, load scenarios, and disclosures**

Invalidate owner/provider work first; revoke links/reminders; best-effort unlink providers; delete cloud/auth; clear all local subsystems; persist content-free failed-stage retry markers. Operational events allow only request ID, route, deployment, provider, environment, owner digest, status/reason, and latency bucket.

Create k6 gates:

- `sync-capacity.js`: 250 pull RPS plus 100 mutation RPS for 10 minutes, 20% idempotent replays;
- `webhook-capacity.js`: 25 RPS for 10 minutes, 20% duplicate events;
- `realtime-capacity.js`: 2,500 foreground subscriptions sustained 30 minutes;
- thresholds: pull p95 `<750 ms`, p99 `<1500 ms`; mutation/webhook p95 `<1000 ms`, p99 `<2000 ms`; unexpected errors `<1%`; cross-owner, duplicate-ledger, duplicate-conversion, and lost-ack counters `0`.

Legal/App Store copy states free limits, StoreKit/RevenueCat Pro, Stripe real-world invoice payments, conditional Apple Pay, processors/retention/deletion, no demo identity, restore/manage subscription, and webhook-confirmed payment.

- [ ] **Step 4: Run the full locally controllable matrix**

Run: `npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run check:supabase-boundary && npm run test:supabase-pglite && npm run scan:secrets && deno fmt --check supabase/functions && deno lint supabase/functions && deno test supabase/functions/*/index_test.ts && deno check supabase/functions/*/index.ts && cd mobile && npm ci && npm test -- --runInBand && npm run typecheck && npm run lint && npx expo-doctor && npm run export:ios && cd .. && npm run scan:secrets`
Expected: PASS. Record exact SHA/counts/runtime/warnings; signed-device/provider/staging-load gates remain open unless directly observed.

- [ ] **Step 5: Commit privacy/capacity/release foundation**

```bash
git add supabase/migrations supabase/functions mobile/src/privacy mobile/src/observability mobile/app mobile/__tests__ scripts package.json .github docs/app-store public
git commit -m "test: gate monetized FieldCraft release"
```

### Task 8: Execute External Account and Signed-Release Gates

**Files:**
- Modify after each direct observation: `docs/app-store/fieldcraft-ios-release-checklist.md`

**Interfaces:**
- Consumes: reviewed implementation SHA, provider-owned prompts, deployed staging/production, synthetic business/customer records, and signed builds.
- Produces: timestamped PASS/FAIL evidence; this task never places credentials in the repository and never treats setup/upload/submission as publication.

- [ ] **Step 1: Complete the Supabase gate in the user's provider session**

Apply ordered migrations through `202608070006`; configure 30-day absolute/7-day inactivity session limits and TOTP MFA; set masked function secrets; deploy functions; run synthetic RLS/idempotency/deletion checks. Record migration versions, function deployment IDs, and redacted results only. Expected: every check PASS before continuing.

- [ ] **Step 2: Complete Apple/RevenueCat catalog and signed purchase tests**

Accept Apple agreements; create the subscription group and exact two product IDs at approved price points; configure `pro`/`default`; inject only the public SDK key through EAS and webhook secret through Supabase; observe sandbox/TestFlight purchase, cancellation, pending, restore, expiry, billing issue, refund/revoke, owner switch, and server-mirror reconciliation. Recheck current Apple 3.1 and RevenueCat Expo/webhook guidance on execution day. Expected: exact signed build PASS; Expo Go is not evidence.

- [ ] **Step 3: Complete Stripe Connect and reminder-provider gates**

Create/verify the Connect platform, direct charges, HTTPS return/refresh/webhook URLs, eligible methods, and a synthetic connected trade account. Observe $1 minimum, partial+final payment, duplicate webhook, Apple Pay where eligible, card fallback, refund/dispute, revoked/expired link, and isolation. Verify reminder sending domain/SPF/DKIM/DMARC/webhook; observe accepted/delivered/bounced/duplicate/paid-before-send cancellation. Confirm FieldCraft application fee is zero. Expected: all PASS before enabling production payment/reminder actions.

- [ ] **Step 4: Complete production-equivalent capacity and outage gates**

Run all k6 scenarios against staging and record p95/p99/error rate, database CPU/connections/locks/index hit, Edge concurrency, Realtime disconnects, duplicate/isolation/lost-ack counters, and recovery after a 5-minute provider outage. Expected: every Task 7 threshold met; any miss blocks release.

- [ ] **Step 5: Complete physical iPhone, TestFlight, App Review, and publication gates**

Build the exact reviewed SHA with current required Xcode/iOS SDK. On a physical iPhone verify StoreKit, MFA, Connect return, customer link, offline/reset/quarantine recovery, estimates, partial payment, reminders, export cleanup, deletion, Speech/Vision, deep links, VoiceOver, 200% Dynamic Type, Reduce Motion, icon/splash, and privacy manifest. Complete metadata/screenshots/private review account, pass TestFlight and App Review, then verify the public App Store listing. Expected: checklist marks publication only after the listing is publicly verified.

## Plan Self-Review Record

- Spec coverage: Tasks 1–8 cover required identity/no demo, persisted onboarding, MFA/session/privacy, free/Pro policy, RevenueCat, estimate/job/invoice/partial-payment/reminder/export, Stripe Connect/conditional Apple Pay, bounded pagination/sync/retention/quarantine, observability, 25k/2.5k load, single-owner scope, and external release gates.
- Foundation scope: eight independently reviewable deliverables; provider accounts, live deployments, staging load, signed-device validation, and publication are isolated in Task 8.
- Placeholder scan: no placeholder markers, generic testing instructions, undefined task references, or implied provider credentials remain.
- Type consistency: `pro`, `default`, product IDs, lifecycle statuses, `PageCursor`, `PullResult`, AAL2 operations, 200/50 page limits, 8-attempt quarantine, 90/400/30-day retention, and 50 MiB export cap match the design.
