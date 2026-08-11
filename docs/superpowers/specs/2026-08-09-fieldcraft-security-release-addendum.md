# FieldCraft Security, Capacity, and App Review Addendum

**Status:** Approved through the owner's standing approval on 2026-08-09.
**Extends:** `2026-08-07-fieldcraft-25k-monetization-design.md`.

## Outcome and claims

FieldCraft is an authenticated, offline-capable contractor workspace. Cloud rows, account actions, AI requests, subscription state, and future invoice payments cross different authority boundaries and must remain separate. The goal is safe operation at 25,000 MAU and 1,000 foreground sessions, not a promise that every one of those sessions can invoke AI or payment mutations simultaneously.

## Selected approach

Keep Supabase Auth/Postgres/Edge Functions, RevenueCat for digital Pro, and Stripe Connect hosted payment surfaces for customer invoice payments. Enforce authorization in Postgres/Edge Functions, not in UI flags; add global provider admission and current webhook authentication; finish the bounded sync/payment lifecycle already approved.

## Trust boundaries and required controls

- Production startup must fail closed unless the Supabase URL is HTTPS, the public anon key is present and non-placeholder, and the RevenueCat public iOS key has the expected platform prefix. No service role, Stripe secret, AI key, or webhook secret may enter the app bundle.
- Every cloud table must have RLS enabled, explicit least-privilege grants, owner predicates, indexed policy columns, and negative cross-tenant tests against PostgreSQL—not only mocked clients.
- Sensitive mutations and account deletion require recent TOTP AAL2 on the server. UI state alone never proves step-up authentication.
- Offline mutation receipts must bind owner, entity, operation, idempotency key, and canonical payload hash. Owner changes, delete epochs, poison payloads, and late devices must fail closed without rolling back newer cloud state.
- The AI function must authenticate the Supabase user, require recorded consent, cap bodies/output, enforce per-user/per-network limits, and use global concurrency plus daily provider-budget admission.
- RevenueCat webhooks require raw-body HMAC verification, timestamp freshness, constant-time comparison, replay/idempotency handling, and tolerance for additional bounded fields.
- Stripe webhooks require raw-body Stripe signature verification before JSON parsing, idempotent event storage, out-of-order reconciliation, and no client-authored payment truth.

## Capacity and failure design

- 1,000 active sessions must be served through bounded pagination, indexed queries, connection pooling, short transactions, exponential backoff, and offline reads; they do not create 1,000 open database connections.
- AI overload returns bounded `429`/`503` responses and leaves local work usable. Payment/provider outages show pending truth and reconcile later; they never mark an invoice paid from a redirect.
- Load gates cover authentication, list/sync, mutation replay, AI admission, webhook bursts, and account deletion with sanitized metrics. Production-like Supabase/Stripe tests remain external gates.

## App Store release design

- Apple IAP is used only for digital Pro. Stripe Connect is limited to real-world contractor invoice payments and is clearly described to reviewers.
- Sign-in is required for cloud work; review receives a durable demo account with MFA instructions or an approved full demo mode.
- In-app account deletion removes cloud data/auth and clears local cache, queue, tokens, receipts, and temporary artifacts with retryable partial-failure states.
- Privacy/terms/support pages must describe Supabase, AI processing, RevenueCat, Stripe, retention, deletion, and local receipt handling; all links must be public HTTPS and non-placeholder.
- Camera/photo/speech permissions are requested only at the feature moment with accurate purpose strings. Screenshots use fictional contractor/customer data.
- A signed Xcode 26 archive, privacy report, VoiceOver/Dynamic Type checks, TestFlight IAP/restore, Stripe sandbox evidence, live backend, and review notes are external gates.

## Verification order

1. Add failing production-config, cross-tenant, webhook forgery/replay, AI overload, sync race, and deletion tests.
2. Close configuration, webhook, and AI-admission gaps before adding new payment/UI surface.
3. Complete the canonical estimate/job/invoice/payment model, bounded sync, Stripe reconciliation, and mobile states from the approved 25k plan.
4. Run mobile, Edge, PostgreSQL/RLS, secret/dependency, export, and load gates, then record external Apple/provider evidence separately.

## Non-goals

No storage of raw card data, no direct card form, no automatic payment truth from redirects, no public invoice PII, and no release claim based on Expo Go or mocked RLS tests.
