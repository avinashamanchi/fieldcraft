# FieldCraft App Store Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare FieldCraft's phone-first release configuration and submission packet while preserving authenticated sync and native Speech/Vision as explicit signed-build gates.

**Architecture:** Retain the Expo SDK 54 app, Supabase repository, SQLite queue, and server-side AI proxy. Ship the first App Store record as iPhone-only because the iPad UI and screenshot set have not been physically validated; production configuration remains credential-free in source and receives only public Supabase values from EAS.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router, SQLite, Supabase, EAS Build, Jest.

## Global Constraints

- iOS first; first release supports iPhone only.
- No service-role, Groq, HMAC, Apple, or Expo secret may enter the client bundle or repository.
- Production upload must use Xcode 26 and iOS 26 SDK or later.
- Native Speech and Vision require a signed development/TestFlight build and cannot be accepted from Expo Go.
- The local Expo Go mode is test-only and must not be enabled in the production EAS environment.

---

### Task 1: Lock the FieldCraft release configuration

**Files:**
- Modify: `mobile/__tests__/foundation.test.tsx`
- Modify: `mobile/app.config.ts`
- Modify: `mobile/eas.json`
- Create: `mobile/.env.example`

**Interfaces:**
- Consumes: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the optional local Expo Go mode flag.
- Produces: iPhone-only, export-compliance-declared, store-distributed EAS builds with remote build-number auto-increment.

- [ ] **Step 1: Extend the failing release test**

Assert `supportsTablet === false`, `ITSAppUsesNonExemptEncryption === false`, disabled OTA updates, exact legal URLs, and production EAS `{ distribution: "store", autoIncrement: true, ios: { image: "auto" } }` with remote versioning and no submit credentials.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --runInBand __tests__/foundation.test.tsx`
Expected: FAIL against the universal build and incomplete production profile.

- [ ] **Step 3: Implement the minimal configuration**

Make the binary iPhone-only, declare non-exempt encryption false, disable OTA drift, add public legal URLs, make EAS production store-distributed with remote auto-increment, and document only public environment values in `.env.example`.

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -- --runInBand __tests__/foundation.test.tsx`
Expected: PASS.

### Task 2: Align the listing and screenshot plan

**Files:**
- Modify: `docs/app-store/fieldcraft-ios-release-checklist.md`
- Modify: `docs/app-store/fieldcraft-ios-screenshot-matrix.md`
- Modify: `docs/app-store/fieldcraft-ios-metadata.md`

- [ ] **Step 1: Remove the unverified iPad release promise**

Change the screenshot matrix to require only a 6.9-inch iPhone set and explain that iPad may be enabled in a later tested version.

- [ ] **Step 2: Record current public and account blockers**

Record HTTP 404 for Privacy, Terms, and Support; EAS logged-out state; missing Xcode/CocoaPods; and pending Supabase, Speech, Vision, TestFlight, screenshots, and App Review.

- [ ] **Step 3: Record the observed Expo Go result narrowly**

Mark only launch/dashboard and SQLite migration startup as physically observed; keep invoice, offline, accessibility, share, and native-module checks open.

### Task 3: Verify all locally controllable gates

- [ ] **Step 1: Run full mobile checks**

Run: `npm test -- --runInBand && npm run typecheck && npm run lint && npx expo-doctor && npm run export:ios`.

- [ ] **Step 2: Run root/backend checks**

Run the repository's web, database, Edge function, audit, and redacted secret-scan commands. Report unavailable Deno or Xcode gates honestly.

- [ ] **Step 3: Stop before credentials**

Do not enable demo mode in production, invent a review account, deploy migrations/functions, or submit to Apple without the authorized provider and Apple prompts.
