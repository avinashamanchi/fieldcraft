# FieldCraft 25k MAU Monetization Design

Date: 2026-08-07
Status: approved decisions captured; implementation has not started
Target: 25,000 monthly active users and 2,500 simultaneous foreground sessions

## 1. Objective

Extend the existing iOS-first FieldCraft application into a paid, production service for independent tradespeople. The release must keep the current offline-first SQLite/outbox/Supabase architecture, require a real Supabase identity, sell digital FieldCraft Pro access through the iOS App Store via RevenueCat, and collect customer payments for real-world field services separately through Stripe Connect-hosted Checkout with Apple Pay when eligible.

The product workflow is complete only when a signed-in owner can persist onboarding, prepare an estimate, convert accepted work into a job, issue an invoice, collect and reconcile partial or full payments, send or share reminders, and export records. A share sheet, payment redirect, webhook receipt, store purchase callback, or optimistic local write is an intermediate state rather than proof of delivery, payment, entitlement, or synchronization.

## 2. Existing Foundation and Required Corrections

The repository already provides the correct structural foundation:

- Expo SDK 54, React Native, Expo Router, strict TypeScript, and an iPhone-first EAS configuration;
- required Supabase email identity for production, SecureStore session storage, authenticated account deletion, SQLite migrations, and owner-bound local data;
- integer-cent invoice calculations, a durable SQLite mutation outbox, idempotent Supabase RPC writes, RLS, Realtime invalidation, and explicit conflict handling;
- local invoice PDF generation and user-initiated sharing;
- server-side AI functions with consent, bounded contracts, and no provider key in the client.

The monetized release must correct these gaps instead of layering flags over them:

- `EXPO_PUBLIC_FIELDCRAFT_DEMO_MODE` currently creates a synthetic local identity. Production must contain no route, environment switch, or fallback capable of creating a demo session.
- onboarding currently gathers fields without a repository-backed completion transaction or durable route gate;
- the local repository exposes unbounded `list()` calls and the sync client needs explicit page/yield budgets, retention recovery, and poison-operation recovery;
- estimates, payment ledger entries, reminder schedules, and durable exports do not yet exist;
- invoice status is not derived from an immutable payment ledger;
- subscriptions, RevenueCat reconciliation, Stripe Connect onboarding, hosted customer checkout, and payment webhooks do not yet exist;
- authentication lacks TOTP enrollment/challenge and AAL2 step-up for payout, export, and deletion operations.

Uncommitted App Store-readiness changes already in the worktree belong to the current release effort and must be preserved.

## 3. Product and Monetization Rules

### 3.1 One identity and two payment rails

Every production user has a verified Supabase user ID before product access. That UUID is the owner boundary in SQLite, Postgres, RevenueCat, Stripe-account linkage, entitlement mirrors, logs, and deletion orchestration. Email addresses and provider customer IDs are not ownership keys.

There are two deliberately separate payment systems:

1. **FieldCraft Pro is a digital app subscription.** iOS purchases and restores use StoreKit through RevenueCat. Stripe Connect must never sell or renew Pro inside the iOS app.
2. **Customer invoice payments buy real-world trade services.** They use Stripe Connect-hosted Checkout outside the app. Eligible customer devices may show Apple Pay. These payments never grant Pro and never pass through RevenueCat.

This boundary follows Apple App Review Guidelines 3.1.1 for digital access and 3.1.3(e) for physical goods or services consumed outside the app. It must be rechecked before submission: <https://developer.apple.com/app-store/review/guidelines/>.

### 3.2 Launch catalog

RevenueCat configuration uses:

- entitlement: `pro`;
- offering: `default`;
- products: `fieldcraft_pro_monthly` and `fieldcraft_pro_annual`;
- launch prices: USD $14.99/month and USD $149.99/year, represented by App Store Connect price points and always rendered from StoreKit-localized product data;
- no lifetime purchase, consumable, introductory trial, web checkout, or externally linked Pro purchase in the first monetized iOS release.

The repository stores identifiers and feature policy, never localized prices. App Store Connect remains authoritative for price, tax, currency, renewal, trial, and availability copy.

### 3.3 Free and Pro behavior

The free tier preserves a useful complete manual loop:

- up to 10 non-archived clients;
- up to 3 open jobs at once;
- up to 5 newly issued estimates or invoices in a rolling 30-day window;
- manual estimate/job/invoice creation, PDF sharing, manual reminder sharing, offline edits, sync, payment recording, and complete CSV/JSON export;
- existing records remain readable, editable, syncable, payable, refundable, and exportable after a limit is reached or Pro expires.

Pro unlocks:

- business records up to the technical caps in this design rather than the free commercial caps;
- Stripe Connect online payment links and hosted Apple Pay/card checkout;
- scheduled email reminders;
- removal of the small `Created with FieldCraft` PDF footer;
- operational revenue/aging dashboards.

Feature limits are enforced in one versioned policy module and repeated transactionally in server RPCs. The client may explain a limit before a write, but the database is authoritative for connected writes. Downgrade never deletes, hides, or mutates prior data. If a user is above a free creation cap, new capped records are disabled while edits, payments, reminders for existing invoices, export, privacy actions, and account deletion remain available.

RevenueCat `CustomerInfo` is authoritative for the device experience. A webhook-maintained Supabase mirror is authoritative for server-only Pro actions. Entitlement disagreement fails closed for a new premium action, preserves existing data, offers refresh/restore, and emits a content-free mismatch metric.

## 4. Product Lifecycle

### 4.1 Persisted onboarding

Onboarding is a versioned business-profile transaction, not a screen-local boolean. Version 1 requires display name, business name, trade type, hourly rate in cents, tax basis points, payment terms, country `US`, currency `USD`, and time zone. Completion writes the profile and `onboardingVersion: 1`, `onboardingCompletedAt`, and one outbox mutation in the same SQLite transaction.

The route gate reads the owner-bound repository only after local initialization. Offline relaunch after one completed hydration routes to the app from persisted state. A new account with no completed onboarding cannot enter the product offline. Repeating the submission reuses one mutation ID and cannot duplicate or regress completion. Future onboarding changes increment the required version and use an explicit migration screen; they do not clear the old completion silently.

### 4.2 Estimate to job

An estimate contains a client, title, scope, line items, locally calculated subtotal/tax/total, expiration date, notes, and statuses `Draft`, `Issued`, `Accepted`, `Declined`, `Expired`, `Converted`, and `Void`. Issuing fixes an estimate number and immutable issued snapshot while later revisions create a new revision number.

Acceptance may be recorded manually by the owner in the foundation release. The record states who recorded it and when; the app does not imply customer e-signature. Converting an accepted estimate is one idempotent RPC/local transaction that creates or updates the linked job, records `convertedJobId`, and prevents a second conversion.

### 4.3 Job to invoice

Job statuses become `Scheduled`, `In Progress`, `Completed`, `Invoiced`, `Partially Paid`, `Paid`, and `Cancelled`. The app never infers completion. Issuing an invoice from a job uses an immutable invoice-number allocation and stores issued and due timestamps. Invoice statuses are `Draft`, `Issued`, `Viewed`, `Partially Paid`, `Paid`, `Overdue`, and `Void`.

`Overdue` is a derived display state when an issued balance is positive and `dueAt` is before the current instant. Persisted status transitions occur only through domain commands/RPCs. Device clocks never mark payment or write an overdue transition.

### 4.4 Partial and full payments

Payments are append-only ledger entries. Each entry records invoice ID, integer amount and currency, method (`Stripe`, `Cash`, `Check`, `Bank Transfer`, `Other`), provider references when present, provider event time, status (`Pending`, `Succeeded`, `Failed`, `Partially Refunded`, `Refunded`, `Disputed`), and refund totals. Manual payments require explicit owner confirmation and are labeled manual.

The server derives:

`amountPaidCents = sum(succeeded amounts) - sum(refunded amounts)`

`balanceDueCents = max(invoiceTotalCents - amountPaidCents, 0)`

An invoice is `Partially Paid` only when `0 < amountPaidCents < totalCents`, and `Paid` only when the balance is zero. A payment cannot exceed the remaining balance, use another invoice currency, or mutate invoice totals. Stripe events are deduplicated by provider event ID and PaymentIntent/charge identity. Client callbacks and redirect URLs never mark an invoice paid.

### 4.5 Reminders

Every issued invoice supports a manual reminder action that opens the iOS share sheet with reviewed text and the invoice PDF or secure payment link. Opening the share sheet records `Share sheet opened`, not `Delivered`.

Pro owners may enable scheduled email reminders at 3 days before due, on the due date, and 7 days overdue. Each schedule is owner-editable and each delivery has a deterministic idempotency key `(invoiceId, scheduleId, dueOccurrence)`. A server worker claims due deliveries with `FOR UPDATE SKIP LOCKED`, rechecks current balance/recipient/consent/entitlement, and sends through a narrow email gateway. Paid, void, missing-recipient, revoked, or non-Pro invoices cancel unsent deliveries. Provider acceptance records `Accepted by provider`; webhook delivery/bounce events record the later outcome. Reminder logs retain no message body.

### 4.6 Exports

The app provides:

- bounded local invoice/estimate PDFs;
- CSV exports for clients, jobs, estimates, invoices, payments, and expenses;
- one versioned JSON account export with a manifest, schema version, UTC creation time, owner ID, counts, and SHA-256 checksums;
- no receipt images, auth tokens, provider secrets, or deleted data unless a future explicit image-export choice is designed.

Exports stream or page records rather than loading the entire account into memory. A temporary export is capped at 50 MiB, registered in the existing artifact registry, shared only by explicit user action, and deleted after the share attempt or within 24 hours on restart cleanup. Data portability and account deletion are never Pro-gated.

## 5. Architecture and Ownership Boundaries

### 5.1 Mobile modules

Retain current module boundaries and add focused units:

- `domain/monetization.ts`: plan, entitlement, feature, and free-limit policy;
- `domain/estimates.ts`, `domain/payments.ts`, `domain/reminders.ts`: strict schemas and deterministic calculations;
- `billing/revenueCatClient.ts`: native StoreKit/RevenueCat adapter;
- `billing/entitlementStore.ts`: owner-bound cached entitlement projection;
- `payments/paymentService.ts`: authenticated Connect/link commands; no card handling;
- `auth/mfaService.ts`: TOTP enroll/challenge/unenroll and AAL checks;
- `exports/accountExport.ts`: paged CSV/JSON writer and manifest;
- focused estimate, payment, reminder, subscription, and security routes under `mobile/app/`.

Screens depend on interfaces. Tests inject fakes. Expo Go renders a truthful `Purchases require the FieldCraft development build` state; it cannot simulate or grant Pro. The production root imports no local-demo authentication service.

### 5.2 Cloud modules

Ordered migrations add estimates, payment ledger entries, reminder schedules/deliveries, Stripe account linkage, subscription entitlement mirrors, webhook receipts, operational event counters, retention watermarks, and sync quarantine metadata. All user business tables retain explicit owner IDs and RLS. Security-definer RPCs fix `search_path`, derive `auth.uid()`, validate exact JSON keys and bounds, lock affected rows, and return canonical sync receipts.

Supabase Edge Functions remain thin adapters:

- `revenuecat-webhook`: verifies a fixed authorization secret, bounds the raw body, deduplicates event IDs, validates app user UUID/product/environment, and updates the entitlement mirror;
- `stripe-connect`: creates account onboarding/status links for the authenticated AAL2 owner;
- `stripe-checkout`: creates a hosted Checkout Session for an invoice-authoritative partial amount on the connected account;
- `stripe-webhook`: verifies Stripe's signature over the raw body, deduplicates event IDs, and invokes ledger RPCs;
- `payment-link`: resolves an opaque public invoice token to a minimal payment page without exposing owner/client tables;
- `reminder-worker` and `reminder-webhook`: claim schedules and reconcile provider delivery events;
- `delete-account`: expands the existing coordinated deletion boundary to billing/reminder/provider references.

Provider secrets stay in function secrets. The mobile app contains only the public RevenueCat iOS SDK key, Supabase URL/publishable key, and public application identifiers. Stripe secret keys, Connect client secret, webhook secrets, RevenueCat secret API/webhook credentials, email credentials, service-role key, and Apple private material never enter the app, repository, build logs, or chat.

### 5.3 Stripe customer checkout

FieldCraft uses Stripe Connect direct charges on connected accounts and Stripe-hosted Checkout Sessions. The connected trade business is merchant of record and is responsible for its Stripe fees, disputes, and refunds. The foundation applies no FieldCraft application fee; adding one requires a separate pricing, tax, disclosure, and accounting design.

The owner completes provider-hosted Connect onboarding in an `ASWebAuthenticationSession`/browser flow. FieldCraft stores only connected account ID, capability state, requirements state, and timestamps. It never stores bank or identity-verification details.

A payment request uses a random 256-bit public token whose SHA-256 digest is stored. The token is invoice-scoped, revocable, and expires no later than 30 days after invoice due date. The public page exposes business display name, invoice number, currency, total, paid, balance, and owner-approved payment amount; it does not expose notes, address, phone, email, local IDs, or job details. The server re-locks the invoice and recomputes the balance before creating a Checkout Session. Customer-entered partial amounts must be at least USD $1.00, at most the balance, and in whole cents.

Stripe-hosted Checkout decides whether Apple Pay is eligible based on the customer device, browser, connected account, currency, and provider configuration. FieldCraft copy says `Apple Pay or card when available`, never guarantees Apple Pay. Official Connect/Checkout behavior must be rechecked at implementation and release: <https://docs.stripe.com/connect> and <https://docs.stripe.com/payments/checkout>.

### 5.4 RevenueCat lifecycle

After a verified Supabase session and owner-bound data initialization, the app configures RevenueCat and calls `logIn(ownerId)`. Anonymous RevenueCat identities are not used. On owner change or sign-out it removes listeners, clears owner-bound entitlement memory, and calls `logOut` before another owner can initialize.

The app obtains the `default` offering, renders localized packages, performs purchase/restore, and unlocks only when `customerInfo.entitlements.active.pro` is active. Purchase cancellation is not an error. Pending, billing issue, expired, revoked, and refunded states have distinct copy. The app exposes Apple's subscription-management surface and restore action.

The cached entitlement stores status, product ID, environment, verified-at, and expiration. Offline it may preserve an entitlement only through RevenueCat's reported expiration; it never invents an extra grace period. Existing premium-created data remains usable after expiry, while new server-gated premium actions await reconciliation.

RevenueCat webhook configuration, products, offering, App Store shared secret/API permissions, and sandbox/TestFlight verification are external release gates. RevenueCat's current Expo/React Native and webhook guidance must be rechecked during implementation: <https://www.revenuecat.com/docs/getting-started/installation/reactnative> and <https://www.revenuecat.com/docs/integrations/webhooks>.

## 6. Authentication, Session, MFA, and Privacy Lifecycle

### 6.1 Production identity and sessions

Production has no guest, demo, local-only owner, or bypass. Tests use injected service fakes. Signed development builds authenticate against a non-production Supabase project with real test users.

Supabase project policy uses a 30-day absolute session lifetime and 7-day inactivity timeout. The app refreshes only while foregrounded. Cached offline work remains available to the last successfully hydrated owner when the network is unavailable; uploads, payment actions, subscription reconciliation, reminders, exports, and destructive cloud actions pause if the session is expired or cannot be refreshed. Returning online requires reauthentication before queued writes leave the device.

Sign out defaults to the current device and clears owner-visible memory before async cleanup. Settings separately offers `Sign out all devices`, using global scope. Owner switches invalidate generations before any pull, provider callback, entitlement listener, or file task can commit.

### 6.2 MFA

TOTP MFA is supported through Supabase enrollment, challenge, verification, factor listing, and unenrollment. Recovery codes are not invented by FieldCraft. The app explains that losing the authenticator may require provider-supported account recovery.

AAL2 step-up is required immediately before:

- starting, refreshing, or disconnecting Stripe Connect onboarding;
- creating or revoking a customer payment link;
- recording a manual refund or changing payment state;
- exporting all account data;
- disabling MFA;
- deleting the cloud account.

An AAL2 assertion older than 15 minutes is stepped up again for these operations. Database policies/RPCs and Edge Functions check the JWT `aal` claim; a client route check alone is insufficient. Ordinary offline entry, edits, sync, invoice viewing, and StoreKit purchase/restore remain available at AAL1.

### 6.3 Privacy and deletion

Provider and application data have explicit retention:

- canonical business data: until user deletion, subject to provider/legal retention disclosed in policy;
- `sync_changes`: 90 days, then pruned only past every active-device cursor watermark or made recoverable through snapshot reset;
- mutation receipts: 400 days to preserve idempotent replay across long-offline devices;
- webhook deduplication records: 400 days for payment/subscription events;
- content-free operational events: 30 days;
- reminder delivery metadata: 400 days; no message body;
- temporary exports/PDFs: deleted after share or by startup cleanup within 24 hours;
- poison/quarantined local writes: retained until successful repair or explicit user export-and-discard; never silently expired.

Account deletion first blocks new provider and sync work, revokes public payment links/reminders, attempts provider unlink/deletion where APIs and legal requirements allow, deletes cloud business/auth data, then clears RevenueCat/Stripe identifiers, SecureStore, SQLite, outbox, quarantine, conflicts, consent, files, and memory. Any incomplete subsystem is visible with a retry marker. Privacy copy distinguishes FieldCraft deletion from records Stripe, Apple, RevenueCat, or an email provider must retain independently.

## 7. Bounded Offline Sync at 25k MAU

### 7.1 Data and queue bounds

All persisted payloads use strict versioned schemas. Maximums are:

- 200 records per cloud pull page;
- 50 records per local UI page;
- 10 pull pages or 2,000 records per foreground work slice before yielding;
- 256 KiB per mutation payload;
- 1,000 pending/failed/quarantined mutations per owner;
- 100 line items per estimate or invoice;
- 10,000 non-archived records per entity per Pro owner;
- 50 MiB per generated export.

Reaching a cap never drops data. The app blocks the new write, identifies the limit, and offers sync/export/archive steps. Local and cloud list APIs use stable keyset pagination `(updatedAt, id)` or server `changeSeq`; offset pagination is not used for mutable business data.

### 7.2 Pull, Realtime, retention, and reset

Realtime carries invalidation only. Foreground subscriptions debounce invalidations for 2 seconds and initiate no more than one pull every 5 seconds. The sync coordinator pulls pages of 200, commits each page transactionally, yields after 10 pages, and resumes from the durable cursor. Backgrounding closes the subscription and aborts current network work without rolling back committed pages.

The server returns `cursorExpired` with a snapshot watermark when a cursor predates retained `sync_changes`. The client stages a paged canonical snapshot, preserves the local outbox, verifies page order/ownership/schema, swaps the snapshot only after the terminal page, then replays local mutations. A reset cannot overwrite or discard unsynced work.

### 7.3 Poison queue recovery

Transient failures retry with existing jittered backoff. Validation, unsupported schema, integrity/hash mismatch, and repeated invalid response are not retried forever. After 8 automatic attempts, or immediately for verified corruption, the operation moves atomically to `quarantined` with reason code, safe diagnostic metadata, original bounded payload, hash, and recovery history.

Quarantined work is excluded from normal upload so later independent mutations can progress when dependency order permits. Dependent operations remain `blockedByMutationId`. The diagnostics screen lets the owner:

- retry an unchanged operation after service recovery;
- open an editable repair flow that creates a new mutation and supersedes the quarantined one;
- export the operation and related local record;
- discard only after explicit typed confirmation and a successful export offer.

The app never auto-discards or rewrites a quarantined business mutation. Queue depth, oldest age, quarantine count, and blocked dependency count are visible without including business content in telemetry.

## 8. Capacity, Observability, and Release Gates

### 8.1 Capacity contract

The production readiness target is 25,000 MAU and 2,500 simultaneous foreground sessions. A staging environment with production-equivalent schema/indexes must pass:

- 2,500 authenticated Realtime invalidation subscriptions sustained for 30 minutes;
- 250 pull requests/second in pages of 200 for 10 minutes;
- 100 idempotent mutation RPCs/second for 10 minutes with 20% replayed mutation IDs;
- 25 Stripe/RevenueCat/reminder webhook events/second for 10 minutes with 20% duplicates;
- p95 under 750 ms and p99 under 1,500 ms for pull pages;
- p95 under 1,000 ms and p99 under 2,000 ms for mutation/webhook RPCs;
- less than 1% HTTP/RPC error rate excluding injected failures;
- zero cross-owner rows, duplicate ledger entries, duplicate conversions, lost acknowledged mutations, or unbounded worker loops.

The gate also records database CPU, connection saturation, lock waits, index hit rate, Realtime disconnects, Edge Function concurrency/latency, and recovery after a 5-minute injected provider outage. Passing local mocks does not satisfy this gate.

### 8.2 Content-free observability

Every network boundary accepts or creates a UUID request ID and records route, deployment version, coarse latency bucket, status/reason code, provider, environment, and a rotating-HMAC owner digest. Logs exclude email, client/invoice text, public payment token, raw provider body, transcript, receipt content, auth/refresh token, Stripe customer/payment method, and RevenueCat receipt.

Required dashboards/alerts cover:

- sync pull latency/error/reset rate, cursor lag, outbox age/depth, quarantine and conflict count;
- Realtime active/failed subscriptions and invalidation coalescing;
- entitlement webhook age, client/server mismatch, purchase/restore failure reason;
- Stripe onboarding capability state, checkout creation errors, webhook verification/dedupe lag, unreconciled succeeded payments, disputes/refunds;
- reminder claim/send/delivery/bounce age and duplicate suppression;
- export/delete cleanup failures and retry-marker age.

Alerts fire on p95 threshold breach for 10 minutes, error rate above 2% for 5 minutes, oldest entitlement/payment webhook above 5 minutes, oldest sync mutation above 24 hours while online, any cross-owner invariant failure, or any secret-scan finding.

### 8.3 External account gates

Implementation can be locally complete without claiming release completion. These gates require the user or release operator in provider-owned interfaces:

1. Supabase production project: apply reviewed migrations, configure Auth session/MFA policy, deploy functions, set secrets, and run synthetic RLS/deletion checks.
2. Apple/RevenueCat: accept Apple agreements, create subscription group/products, configure `pro`/`default`, add public SDK key and server webhook secret through EAS/Supabase, test sandbox and TestFlight purchase/restore/refund/expiry, and complete App Privacy/subscription metadata.
3. Stripe Connect: create the platform, complete business verification, select direct charges, configure account links/return URLs/webhook, enable eligible payment methods, verify hosted Apple Pay/card checkout, disputes, refunds, and payout ownership.
4. Reminder provider: verify sending domain, configure SPF/DKIM/DMARC and webhook secret, pass delivery/bounce/unsubscribe tests, and keep automated reminders disabled until complete.
5. Signed release: physical iPhone MFA, Connect browser return, StoreKit, deep-link, offline/reconnect, payment-link, export, deletion, VoiceOver/Dynamic Type, TestFlight, App Review, and public App Store listing verification.

No credential, two-factor code, banking/identity document, Apple session, provider private key, or raw webhook secret belongs in source, chat, shell history, screenshots, or release notes.

## 9. Multi-User Crews Are a Real Future Model

The 25k foundation remains single-owner. It must not add `teamEnabled`, shared credentials, an owner-ID array, or permissive RLS as a crew shortcut.

A future crew release requires explicit `organizations`, `memberships`, invitations, roles, row organization ownership, audit attribution, subscription seats, Stripe account authority, device/session revocation, offline membership snapshots, and RLS/RPC migration. Current owner IDs and APIs should be kept behind repository interfaces so that migration is possible, but no current behavior may imply multi-user access.

## 10. Verification and Completion Criteria

Automated coverage must include exact contract bounds, money/refund math, free-limit boundary/replay behavior, onboarding relaunch, no production demo path, TOTP/AAL2, owner switches, RevenueCat purchase/restore/expiry/webhooks, Stripe signature/dedupe/partial/refund/dispute flows, estimate conversion idempotency, reminder claiming/delivery, streaming export cleanup, paginated sync/reset, retention, quarantine repair/discard, RLS, content-free logs, load scripts, accessibility, and secret scanning.

The monetized foundation is code-complete only when:

- clean root/mobile installs, tests, typecheck, lint, Expo Doctor, iOS export, PGlite, Deno checks, migration-boundary checks, and secret scans pass;
- free and Pro flows preserve data through upgrade, downgrade, offline use, expiry, restore, owner change, and deletion;
- customer payment state is proven from verified Stripe webhooks and server ledger math;
- production cannot create or route through a demo/local identity under any environment value;
- queue/reset/load gates meet the exact bounds above in staging;
- privacy, support, terms, App Store metadata, subscription disclosures, and payment copy match observed production behavior;
- every external account and signed-device gate is either directly observed complete or explicitly reported blocked.

Upload, provider configuration, a sandbox purchase, a payment redirect, TestFlight processing, or App Review submission is not publication. Release is complete only after the intended production services are configured, the exact signed build passes the device matrix, Apple approves it, and the public App Store listing is verified.
