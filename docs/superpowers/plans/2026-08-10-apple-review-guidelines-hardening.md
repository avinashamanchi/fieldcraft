# FieldCraft Apple Review Guidelines Hardening Plan

> **For implementation:** Execute each task in order with RED-before-production TDD and preserve every external App Store gate as blocked until directly verified.

**Goal:** Make the FieldCraft source package explicitly conform to every applicable current Apple App Review requirement and make non-applicable rules auditable.

**Architecture:** Keep FieldCraft's authenticated, offline-first Supabase model and its server-verified RevenueCat subscription boundary. Add purchase-help affordances at the existing plan surface, record the complete Apple guideline applicability decision, and tighten the reviewer package without pretending that provider configuration, signed-device testing, or App Store approval happened locally.

**Tech stack:** Expo SDK 54, React Native, Expo Router, RevenueCat, Jest, TypeScript, Supabase.

---

### Task 1: Record complete applicability

**Files:**
- Create: `docs/app-store/apple-review-guideline-applicability.md`
- Modify: `docs/app-store/fieldcraft-ios-release-checklist.md`

1. Map Safety, Performance, Business, Design, and Legal guideline families to `IMPLEMENTED`, `EXTERNAL GATE`, or `NOT APPLICABLE`.
2. Record evidence for first-party authentication, in-app deletion, explicit AI consent, subscriptions, physical-service invoice records, privacy links, permissions, and iPhone-only scope.
3. Add archive, signed-device, live-backend, public-link, screenshot, demo-account, and App Store Connect gates to the checklist.

### Task 2: Add Apple purchase and refund help

**Files:**
- Test: `mobile/__tests__/subscriptionFlow.test.tsx`
- Modify: `mobile/app/subscription/index.tsx`
- Modify: `public/support.html`

1. Add a failing screen test requiring a Support link and an Apple purchase/refund-help link to their exact HTTPS destinations.
2. Run the focused test and observe the missing controls fail.
3. Add the two accessible links without changing purchase/entitlement behavior.
4. Update the static support page with restore, management, refund, and account-deletion boundaries.
5. Rerun the focused test to green.

### Task 3: Make reviewer instructions exact

**Files:**
- Modify: `docs/app-store/fieldcraft-ios-metadata.md`
- Modify: `docs/app-store/fieldcraft-ios-release-checklist.md`

1. Add a deterministic reviewer path, demo-account requirement, subscription identifiers, AI-consent path, deletion path, and physical-service payment explanation.
2. State that optional offers, Family Sharing, promoted purchases, and alternative payments remain disabled unless separately configured and tested.
3. Preserve all external blockers and the no-approval-guarantee boundary.

### Task 3A: Make required in-app account deletion reachable

**Files:**
- Test: `mobile/__tests__/deleteAccount.test.tsx`
- Test: `mobile/__tests__/mfaLifecycle.test.tsx`
- Modify: `mobile/app/settings/delete-account.tsx`
- Modify: `mobile/app/security/step-up.tsx`

1. Add failing tests proving account deletion routes to recent-MFA verification before any destructive request and that users without an enrolled factor can reach authenticator setup.
2. Observe RED, add the route/recovery controls, and keep the server-side recent-AAL2 requirement unchanged.
3. Rerun focused deletion and MFA suites to green.

### Task 3B: Enforce HTTPS-only production transport

**Files:**
- Test: `mobile/__tests__/foundation.test.tsx`
- Create: `mobile/plugins/withReleaseNetworkPolicy.cjs`
- Modify: `mobile/app.config.ts`

1. Add a failing release-policy contract test, then register a production-only Info.plist config plugin that removes Expo development Bonjour/local-network keys, disables arbitrary ATS loads, and removes localhost transport exceptions.
2. Preserve development-client behavior outside the production EAS profile.

### Task 4: Verify

**Files:** none

1. Run the focused subscription test.
2. Run the complete FieldCraft mobile tests, typecheck, lint, Expo Doctor, production dependency audit gate, and cache-free iOS export.
3. Run relevant root/server and PGlite suites.
4. Confirm only intended files are staged and commit this app independently.
