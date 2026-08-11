# FieldCraft Native iOS Design

Date: 2026-08-03  
Status: approved in conversation; written-spec review pending  
Target branch: `codex/fieldcraft-ios`

## 1. Objective

Build a production-grade native iOS version of FieldCraft for tradespeople. The app must support the complete core workflow—authentication, onboarding, jobs, clients, invoices, expenses, service settings, voice-assisted job entry, receipt scanning, PDF sharing, offline work, and cross-device synchronization—without wrapping the existing website in a WebView.

The first release targets iOS only. Android work begins only after the iOS app is published and its release state is verified from the public App Store listing.

The native implementation lives in `mobile/`. The existing React/Vite website remains available and receives only the safety and shared-backend changes required by this design.

## 2. Existing-System Findings

The starting repository is a React 19/Vite website backed by Supabase. It is not an acceptable native release foundation by itself:

- voice capture uses the browser Speech Recognition API;
- receipt OCR uses browser-side Tesseract and `File` objects;
- PDF generation and printing use browser DOM/canvas APIs;
- navigation uses `HashRouter` and browser history;
- the Groq provider key is compiled into the browser bundle through `VITE_GROQ_API_KEY`;
- marketing copy claims phone-only storage even though business records sync to Supabase;
- the package lock is not reproducible with `npm ci`;
- there is no automated test suite;
- the current dependency audit reports known advisories;
- multi-record invoice creation is sequential and can leave partial records;
- inventory is local-only despite cross-device-sync claims.

These issues are inputs to the native design, not accepted release behavior.

## 3. Product Decisions

The approved product decisions are:

- Use a fully native Expo/React Native interface, not a WebView or Capacitor wrapper.
- Keep Supabase authentication and cross-device cloud synchronization.
- Require sign-in before product use.
- Permit cached offline use after the first successful login.
- Use Apple Speech for on-device job transcription when available.
- Never upload or retain raw voice recordings.
- Use Apple Vision for on-device receipt OCR.
- Never upload receipt images for OCR or categorization.
- Send only user-reviewed transcripts or minimized extracted receipt fields to the AI proxy after consent.
- Keep all AI results editable and require human confirmation before persistence or sharing.
- Do not add payments, automatic email/message delivery, contacts access, or push notifications in version 1.

## 4. Native Architecture

### 4.1 Application foundation

Create an Expo SDK 54 TypeScript app in `mobile/` so the current iPhone Expo Go client can exercise compatible JavaScript and Expo SDK features. The production app uses Expo Router, React Native, strict TypeScript, Node 22, deterministic lockfiles, and EAS configuration.

Initial native identifiers and targets:

- display name: `FieldCraft`;
- iOS bundle identifier: `com.avinashamanchi.fieldcraft`;
- URL scheme: `fieldcraft`;
- minimum iOS deployment target: 15.1;
- version: 1.0.0;
- initial build number: 1.

The app uses a five-tab layout:

1. Dashboard
2. Jobs
3. Clients
4. Expenses
5. Settings

Voice/manual job entry is a prominent Dashboard action and a stack route, not a sixth tab. Job, client, invoice, receipt, authentication, privacy, and conflict-resolution screens are stack routes or native sheets.

### 4.2 Module boundaries

Keep the native implementation divided into small, testable units:

- `domain/`: versioned schemas, money arithmetic, invoice calculations, statuses, validation, and conflict policy;
- `data/`: SQLite cache, migrations, repositories, mutation outbox, sync coordinator, and Supabase adapters;
- `auth/`: Supabase client, SecureStore session adapter, deep-link parsing, email verification, password reset, sign-out, and account deletion;
- `ai/`: consent state, proxy contract, transcript/receipt minimization, timeout/error mapping, and response validation;
- `native/`: Apple Speech and Apple Vision module boundaries plus Expo Go fallbacks;
- `files/`: scoped temporary-artifact registry, PDF creation, sharing, logo import, and cleanup;
- `features/`: screens and focused UI components;
- `theme/`: typed colors, spacing, typography, touch-target, and motion tokens.

Screens depend on repository and service interfaces, not directly on Supabase, SQLite, provider APIs, or native modules.

## 5. Authentication and Account Lifecycle

Use the Supabase publishable/anonymous key in the app; this key is public by design and is protected by Row Level Security. Store the authenticated session through an iOS SecureStore adapter. Do not silently fall back to plaintext storage if SecureStore fails.

Authentication supports:

- email/password signup;
- email verification;
- sign-in;
- password reset;
- session refresh while the app is active;
- explicit sign-out;
- universal/deep-link callback routing in the production development build;
- authenticated account deletion.

After the first successful login and data hydration, the user may open cached data offline. If the session cannot be refreshed after connectivity returns, uploads pause and the app requests reauthentication without deleting queued local work.

Account deletion requires typed confirmation and calls an authenticated Supabase Edge Function. The function deletes the auth user; database foreign keys cascade owned cloud records. The app then removes SecureStore sessions, SQLite records, pending mutations, imported logos, receipts, PDFs, audio buffers, and in-memory state. Partial local cleanup is visible and retryable.

## 6. Data Model, Persistence, and Synchronization

### 6.1 Cloud schema

Convert the one-shot schema into ordered migrations under `supabase/migrations/`. Retain RLS and add missing integrity controls:

- foreign keys between jobs, clients, invoices, and expenses where practical;
- enumerated/check-constrained status values;
- nonnegative money, quantity, hours, and rate constraints;
- `updated_at` triggers on every mutable table;
- a monotonically increasing `version` on mutable records;
- a cloud-synced `inventory_items` table;
- unique invoice numbers per user;
- bounded text fields;
- explicit indexes for user, client, job, status, and update ordering;
- authenticated transactional RPCs for compound operations.

All policies explicitly use `auth.uid()` and every security-definer function fixes its search path and rechecks ownership. Service-role credentials never enter the app or web bundle.

### 6.2 Money and calculations

Represent persisted money as integer cents. Hours and quantities use bounded decimal values. The domain layer calculates each line total, subtotal, tax amount, and invoice total locally using deterministic rounding. AI-supplied totals are ignored and recomputed before preview and save.

### 6.3 Local cache

SQLite mirrors the signed-in user's jobs, clients, invoices, expenses, services, inventory, and profile. Every row records:

- owner user ID;
- schema version;
- cloud version and `updated_at`;
- local modification state;
- last sync error, when present.

The app sandbox and iOS Data Protection protect local files. Authentication tokens and local encryption/key material, if later required, remain in SecureStore. Receipt images and raw audio are never persisted in the database.

### 6.4 Mutation outbox

Every offline write is a SQLite transaction that updates the cached view and inserts an outbox operation with a UUID idempotency key. Operations have pending, syncing, failed, conflict, and complete states.

On reconnection or app foregrounding, the sync coordinator:

1. refreshes authentication;
2. pulls newer server versions;
3. uploads outbox operations in dependency order;
4. applies authoritative server responses;
5. subscribes to Supabase Realtime while active;
6. schedules bounded retries with jitter for transient failures.

Compound client/job/invoice creation uses one idempotent `save_invoice_bundle` RPC. The database transaction either creates all records or none. Replaying the same mutation ID returns the prior result instead of duplicating data.

If the server version changed after an offline edit began, the app does not silently overwrite it. The operation enters conflict state, preserves both versions, and presents a field-level choice to keep the cloud version or apply the local edit.

## 7. Feature Flows

### 7.1 Dashboard

Show the greeting, outstanding balance, jobs this month, paid revenue, logged expenses, estimated profit, overdue invoices, recent jobs, and quick actions. Financial summaries are derived from validated local records and clearly labeled as business tracking—not accounting or tax advice.

The Dashboard always shows current sync state: offline, pending changes, syncing, conflict, or current.

### 7.2 Jobs and clients

Support full create/read/update/delete workflows, search, status filtering, pull-to-refresh, accessible empty states, and large-list virtualization. Deleting a client or job must explain linked-record behavior before confirmation. The database and local repositories must not leave dangling relationships.

Job statuses are Scheduled, In Progress, Invoiced, and Paid. Status changes are explicit user actions. The app never marks work complete or invoices paid automatically.

### 7.3 Voice/manual invoice creation

The flow is:

1. choose voice or manual entry;
2. for voice, request microphone and speech-recognition permission at the moment of use;
3. transcribe with Apple Speech when available;
4. discard the raw audio buffer after transcription, cancellation, timeout, or error;
5. show the editable transcript;
6. offer local manual invoice entry without network or AI;
7. after explicit AI consent, send the reviewed transcript through the authenticated proxy;
8. validate the versioned AI response;
9. recompute every monetary value locally;
10. show an editable invoice review;
11. atomically save the client/job/invoice bundle.

Expo Go cannot load the custom Apple Speech module. In Expo Go, typed transcript entry is fully functional and the app truthfully labels voice as requiring the FieldCraft development build.

### 7.4 Receipt expenses

The user may take a photo, choose an image, or enter an expense manually. The native Apple Vision module performs OCR locally. The app shows the extracted vendor, date, total, confidence, and editable raw text before saving.

Optional AI categorization sends only bounded extracted fields needed for categorization. It never sends image bytes, unrelated receipt text, client records, or job lists. A deterministic keyword fallback and manual category selection remain available offline.

Picker copies and OCR artifacts are registered as FieldCraft-owned temporary files and deleted in `finally` on success, failure, cancellation, timeout, and unmount. Delete-all retries any cleanup failure.

### 7.5 PDF and sharing

Generate invoices locally with native PDF/print APIs. Include the business identity, invoice number, client, line items, locally calculated totals, payment terms, and human-reviewed notes. Do not claim an invoice was sent merely because the iOS share sheet opened.

PDFs use scoped cache filenames, are excluded from long-term storage by default, and are deleted after the share attempt. Saving or sharing is always user-initiated.

### 7.6 Settings

Settings covers profile, business identity, logo, trade type, hourly rate, tax rate, payment terms, service catalog, inventory, AI consent/revocation, sync diagnostics, privacy/retention, support, sign-out, local cache clearing, and account deletion.

Logo imports are bounded, decoded as safe raster images, resized locally, and stored through a dedicated user-owned Supabase Storage bucket or a bounded profile representation. Arbitrary SVG/HTML data URLs are not rendered.

## 8. AI Proxy and Privacy Boundary

Implement authenticated Supabase Edge Functions rather than calling Groq from the app. The functions verify the Supabase JWT and expose narrow, versioned routes for:

- invoice parsing;
- expense categorization;
- optional message drafting.

The Groq key is stored only as a function secret. Remove `VITE_GROQ_API_KEY` and all direct provider access from the website and deployment workflow. The website may call the same authenticated/minimized proxy after its consent flow is corrected.

Proxy controls include:

- strict method and route allowlists;
- request body byte limits;
- per-field character and array limits;
- exact anonymous/minimized DTOs;
- authenticated per-user and independent network rate limits enforced atomically;
- provider deadline and response-byte limit;
- strict response schema with unknown fields rejected;
- content-free public errors;
- no provider body, stack, secret, prompt, transcript, receipt, client, or invoice data in normal logs;
- fixed model and bounded output tokens;
- no persistence of prompt or generated content.

AI consent is versioned and revocable. Revocation prevents future remote calls without deleting business records. The local/manual workflow always remains available.

## 9. Interface and Accessibility

Preserve FieldCraft's charcoal (`#1A1A1A`), warm-white (`#F5F0EB`), and orange (`#FF6B2B`) identity while using native controls and platform navigation.

Every release screen must support:

- 44–48 point minimum touch targets;
- Dynamic Type through at least 200%;
- layouts that stack or scroll instead of clipping;
- VoiceOver names, values, hints, headings, and logical focus order;
- keyboard avoidance and dismissal;
- safe-area insets;
- Reduce Motion;
- status icons/text in addition to color;
- explicit loading, empty, offline, pending, retry, conflict, and failure states;
- destructive confirmations with disabled duplicate submission;
- screen-reader announcements for saves, sync changes, and errors;
- accessible large-list search and filtering.

The marketing website remains separate. The native app starts at authentication/onboarding and contains no web marketing shell.

## 10. Error and Lifecycle Handling

All asynchronous work is abortable or invalidated across navigation, sign-out, account deletion, superseding requests, and unmount.

Required behaviors include:

- retain editable user input after validation, network, AI, OCR, or save failure;
- classify offline, authentication, permission, rate-limit, validation, provider, storage, conflict, and unknown failures distinctly;
- surface retry times for rate limits;
- prevent duplicate taps from creating duplicate records;
- keep response-body reads inside deadlines and byte caps;
- never report an optimistic write as saved until local durability succeeds;
- distinguish locally saved/pending from cloud-synced;
- prevent stale reads or late requests from repopulating data after sign-out/delete-all;
- clear sensitive state immediately when the owner changes;
- retry scoped cleanup and preserve an observable failure marker until it succeeds.

## 11. Existing Website Safety Work

The website is not redesigned, but the iOS project must not leave the public web version unsafe or contradictory. Required shared work is limited to:

- restore reproducible Node 22 clean installs;
- add tests, lint, and build gates;
- remove browser-bundled Groq credentials and direct provider calls;
- route optional AI through the authenticated proxy;
- add bounded request lifecycle handling;
- correct claims that all data stays on the phone or no download is required;
- publish accurate privacy and support pages;
- gate Pages deployment on tests and a redacted repository/bundle secret scan;
- ignore local secret and backend state files.

## 12. Verification Strategy

### 12.1 Automated tests

Create test coverage for:

- domain schemas and exact boundaries;
- integer-cent calculations and rounding;
- invoice bundle atomicity/idempotency;
- SQLite migrations and corrupt-record rejection;
- offline outbox ordering, retries, owner changes, and conflicts;
- authentication callback and session lifecycle;
- RLS policies and security-definer ownership checks;
- AI consent, minimization, timeouts, rate limiting, content-free logs, and provider validation;
- Apple Speech/Vision adapter boundaries and stable error codes;
- temporary artifact cleanup on every exit path;
- PDF content, provenance, and cleanup;
- screen navigation, forms, lists, duplicate taps, stale work, and deletion;
- VoiceOver semantics, touch targets, Reduce Motion, and 200% Dynamic Type;
- existing web safety regressions;
- current-tree and built-bundle secret scanning.

### 12.2 Continuous integration

Node 22 CI runs clean installs and separate jobs for:

- website tests, lint, and production build;
- mobile tests, typecheck, lint, Expo Doctor, and iOS export;
- Supabase functions/tests and SQL static/integration checks;
- redacted tracked-tree plus built-artifact secret scans;
- workflow and configuration validation.

Dependency audits are recorded exactly. Breaking upgrades are not applied blindly; unresolved advisories are release blockers or explicitly documented risk decisions.

### 12.3 Device matrix

Expo Go verifies compatible UI, manual entry, authentication, Supabase reads/writes, offline cache behavior, navigation, lists, settings, and supported sharing paths.

A FieldCraft development build on a physical iPhone is mandatory for:

- Apple Speech permission, recording lifecycle, transcription, cancellation, and cleanup;
- Apple Vision camera/photo selection, orientation, OCR, review, and cleanup;
- SecureStore session behavior;
- SQL/data-protection configuration;
- email verification and password-reset deep links;
- native PDF/share sheet;
- offline/online transitions;
- small-screen layouts, 200% Dynamic Type, VoiceOver, and Reduce Motion;
- final app name, icon, splash, purpose strings, and privacy manifest.

No feature is marked passed solely because an export builds or Expo Go opens.

## 13. App Store Preparation

Repository deliverables include:

- credential-free Expo and EAS configuration;
- app icon and splash assets;
- least-privilege microphone, speech-recognition, camera, and photo-library purpose strings;
- privacy manifest inputs;
- App Store name/subtitle/description/keywords;
- age-rating and App Privacy answer drafts;
- support and privacy pages at public FieldCraft URLs;
- review notes explaining AI consent, manual fallback, offline behavior, and test account requirements;
- screenshot capture matrix and semantic test IDs;
- release checklist that separates implementation, device observation, credentials, submission, review, and publication.

As of this design date, App Store Connect uploads require Xcode 26 or later and an iOS 26 SDK or later. This requirement must be rechecked immediately before upload.

Credential boundaries remain user-owned. The implementation must not request or accept Apple passwords, two-factor codes, identity documents, payment details, Expo passwords, Supabase personal access tokens, provider keys, private keys, or raw browser sessions. The user signs in and enters secrets only through provider-owned prompts.

Submission is not publication. FieldCraft is published only after Apple approval and verification of the public App Store listing.

## 14. Out of Scope for iOS Version 1

- Android production work;
- payment collection or Stripe integration;
- automatic invoice delivery;
- automatic client messaging;
- contacts import;
- push notifications;
- background location;
- payroll, tax filing, or accounting advice;
- team/multi-employee accounts;
- web visual redesign;
- silent conflict resolution that overwrites business records.

## 15. Completion Criteria

Implementation is code-complete only when:

- native deliverables are committed on the feature branch;
- every task has independent spec and quality review;
- the final whole-branch review is clean or has explicit non-load-bearing rulings;
- clean-checkout Node 22 CI-equivalent gates pass;
- no provider or service-role secret exists in source or built bundles;
- Expo Go observations are recorded for supported paths;
- a physical development build passes Speech, Vision, authentication-link, offline, PDF, and accessibility matrices;
- privacy/support pages and release metadata match actual behavior;
- all remaining credentialed/App Store gates are reported as incomplete rather than implied complete.

App Store publication remains a separate external outcome requiring the user's Apple Developer access, a successful signed build, TestFlight verification, App Review approval, and a verified public listing.
