# FieldCraft Native iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a production-grade native FieldCraft iOS app with secure Supabase sync, durable offline work, on-device Speech/Vision workflows, a server-side AI proxy, and truthful App Store release gates.

**Architecture:** Add an Expo SDK 54 app in `mobile/` with Expo Router, strict domain schemas, SQLite repositories, an idempotent mutation outbox, and Supabase authentication/Realtime. Supabase migrations and authenticated Edge Functions provide transactional business operations and a bounded Groq proxy; the existing web app uses the same proxy after its browser secret path is removed.

**Tech Stack:** Node 22, TypeScript, Expo SDK 54, React Native, Expo Router, Expo SQLite, Expo SecureStore, Supabase/Postgres/Realtime/Edge Functions, Swift Expo modules for Apple Speech and Vision, Zod, Vitest, Jest Expo, React Native Testing Library, Maestro, EAS Build.

## Global Constraints

- iOS version 1 only; do not begin Android production work in this plan.
- Native app path: `mobile/`; do not use WebView or Capacitor for product screens.
- Expo SDK: 54; Node: 22; TypeScript strict mode; deterministic `npm ci` lockfiles.
- Display name: `FieldCraft`; bundle ID: `com.avinashamanchi.fieldcraft`; URL scheme: `fieldcraft`; iOS deployment target: 15.1; app version: 1.0.0; build number: 1.
- Keep five tabs exactly: Dashboard, Jobs, Clients, Expenses, Settings. Voice/manual job entry is a Dashboard action and stack route.
- Require Supabase sign-in. Cached offline access begins only after a successful verified login and first hydration.
- Store auth sessions through an iOS SecureStore adapter; never silently fall back to plaintext session storage.
- Store money as integer cents. Permit `0..100000000` cents per monetary field, `0..10000` quantity/hours, at most 100 invoice line items, and at most 500 Unicode code points per line-item description.
- Bound reviewed job transcripts to 20,000 Unicode code points, optional message-draft context to 10,000, local OCR text to 30,000, logo imports to 2 MiB, receipt images to 12 MiB and 4096 pixels per side, AI request bodies to 64 KiB UTF-8, and provider responses to 128 KiB.
- Bound Apple Speech sessions to 120 seconds. Require on-device recognition when Apple reports it available; otherwise keep the manual transcript path and do not upload audio.
- Never persist or upload raw audio. Never upload receipt images. Delete all FieldCraft-owned picker, audio, OCR, logo-processing, and PDF temporary artifacts in `finally` paths.
- Only the Supabase publishable/anonymous key may be public. Groq and service-role credentials stay in provider-managed Edge Function secrets and never enter app/web source or bundles.
- Every AI request requires versioned consent, an authenticated user, minimized DTOs, atomic independent user and network rate limits, bounded deadlines/bytes, strict response schemas, and content-free logs/errors.
- Do not log transcripts, receipt text, client contact data, tokens, invoice content, provider bodies, or environment values.
- AI output is always editable. Recompute invoice totals locally. Never auto-send a message/invoice, access contacts, charge money, or mark a job/invoice paid.
- Every offline mutation has a UUID idempotency key. Compound invoice creation is all-or-nothing. Conflicts preserve local and cloud versions until the user resolves them.
- All user-owned tables have explicit RLS. Security-definer functions set a fixed search path and recheck `auth.uid()` or are callable only by the service role.
- Support Dynamic Type through 200%, VoiceOver, Reduce Motion, safe areas, keyboard avoidance, no color-only status, 44–48 point targets, virtualized lists, and explicit loading/empty/offline/pending/retry/conflict/failure states.
- Expo Go may verify only bundled APIs. Apple Speech, Apple Vision, final permissions, deep links, app identity, and native configuration require a physical FieldCraft development build.
- Do not request or accept Apple/Expo/Supabase/Groq passwords, two-factor codes, identity documents, payment data, private keys, personal access tokens, or raw sessions. The user completes provider-owned authentication prompts.
- Submission is not publication. Claim publication only after Apple approval and verification of the public App Store listing.

---

## File and Responsibility Map

### Existing web and shared support

- `package.json`, `package-lock.json`, `.node-version`: reproducible Node 22 web toolchain.
- `vite.config.ts`: web build to `dist/` so tracked specs under `docs/` are never erased.
- `src/lib/fieldcraftAi.ts`: bounded client for the authenticated Supabase Edge Function.
- `src/lib/groq.ts`: removed after callers migrate; no provider key remains in web code.
- `src/lib/money.ts`, `src/lib/validation.ts`: web use of shared contract semantics.
- `src/**/*.test.tsx`: focused web security and lifecycle coverage.
- `scripts/scan-secrets.mjs`: redacted tracked-tree and bundle scanner.

### Native foundation

- `mobile/app.config.ts`, `mobile/eas.json`: credential-free native/release configuration.
- `mobile/app/**`: Expo Router layouts and screens.
- `mobile/src/domain/**`: schemas, money math, DTOs, validation, and conflict types.
- `mobile/src/data/**`: SQLite migrations, repositories, mutation outbox, Supabase gateway, and sync coordinator.
- `mobile/src/auth/**`: SecureStore storage, session lifecycle, and account deletion.
- `mobile/src/ai/**`: consent, minimization, Edge Function client, errors, and response validation.
- `mobile/src/files/**`: temporary-artifact registry, bounded imports, PDFs, and sharing.
- `mobile/src/components/**`: focused native UI components and accessibility states.
- `mobile/modules/fieldcraft-speech/**`: Swift Apple Speech Expo module.
- `mobile/modules/fieldcraft-vision/**`: Swift Apple Vision Expo module.

### Supabase backend

- `supabase/migrations/**`: versioned schema, RLS, triggers, storage policies, rate limits, account deletion, and transactional RPCs.
- `supabase/functions/fieldcraft-ai/**`: authenticated minimized AI proxy.
- `supabase/functions/delete-account/**`: authenticated auth-user deletion boundary.
- `supabase/tests/database/**`: pgTAP RLS, constraint, idempotency, and transaction tests.

### Release support

- `.github/workflows/ci.yml`: web/mobile/backend/secret-scan gates.
- `.github/workflows/deploy.yml`: Pages deploy dependent on the same green gates.
- `public/privacy.html`, `public/support.html`: truthful public policies.
- `docs/app-store/**`: metadata, privacy answers, review notes, screenshot matrix, and release checklist.
- `mobile/e2e/fieldcraft-core.yaml`: semantic native release flow.

---

### Task 1: Reproducible Web Baseline and Expo Foundation

**Files:**
- Modify: `.gitignore`
- Create: `.node-version`
- Modify: `package.json`
- Regenerate: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/baseline.test.ts`
- Create: `mobile/**` from Expo SDK 54 TypeScript template
- Create: `mobile/app.config.ts`
- Create: `mobile/eas.json`
- Modify: `mobile/package.json`
- Create: `mobile/__tests__/foundation.test.tsx`

**Interfaces:**
- Consumes: existing Vite app at repository root.
- Produces: reproducible root and `mobile/` packages with `test`, `typecheck`, `lint`, `expo:doctor`, and `export:ios` commands.

- [ ] **Step 1: Write root baseline tests before changing the build output**

Create `src/baseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('FieldCraft web baseline', () => {
  it('never uses docs as the Vite build directory', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).not.toMatch(/outDir:\s*['"]docs['"]/)
  })

  it('pins Node 22', () => {
    expect(readFileSync('.node-version', 'utf8').trim()).toBe('22')
  })
})
```

- [ ] **Step 2: Run the root test and clean install to capture the expected failures**

Run:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm ci
npx vitest run src/baseline.test.ts
```

Expected: `npm ci` fails because `package-lock.json` is out of sync, and the test command is unavailable before Vitest is installed.

- [ ] **Step 3: Repair the root toolchain without a force upgrade**

Set `package.json` to include:

```json
{
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "scan:secrets": "node scripts/scan-secrets.mjs"
  }
}
```

Add compatible `vitest`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` development dependencies. Run `npm install` under Node 22 to regenerate the lock, then `npm audit fix` without `--force`; keep only compatible updates that preserve a green build. Change `vite.config.ts` to `outDir: 'dist'` and update `.gitignore` to ignore `dist/` rather than the entire `docs/` tree.

- [ ] **Step 4: Scaffold Expo SDK 54 and install exact native capabilities through Expo**

Run:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx create-expo-app@latest mobile --template default@sdk-54 --yes
cd mobile
npx expo install expo-router expo-sqlite expo-secure-store expo-network expo-file-system expo-image-picker expo-document-picker expo-sharing expo-print expo-crypto expo-linking expo-constants expo-dev-client react-native-safe-area-context react-native-screens react-native-gesture-handler react-native-reanimated
npm install @supabase/supabase-js react-native-url-polyfill zod zustand
npm install -D jest-expo @testing-library/react-native @types/jest eslint typescript
```

Remove template demo routes/assets that are not FieldCraft dependencies.

- [ ] **Step 5: Write the native foundation test**

Create `mobile/__tests__/foundation.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native'
import RootLayout from '../app/_layout'
import appConfig from '../app.config'

jest.mock('expo-router', () => ({ Stack: () => null }))

it('uses the exact FieldCraft iOS identity', () => {
  const config = appConfig({ config: {} } as never)
  expect(config.name).toBe('FieldCraft')
  expect(config.scheme).toBe('fieldcraft')
  expect(config.ios?.bundleIdentifier).toBe('com.avinashamanchi.fieldcraft')
  expect(config.ios?.buildNumber).toBe('1')
})

it('mounts the native root', () => {
  render(<RootLayout />)
  expect(screen.queryByText(/vite/i)).toBeNull()
})
```

- [ ] **Step 6: Configure the native package and credential-free EAS profiles**

Set mobile scripts to:

```json
{
  "test": "jest --runInBand",
  "typecheck": "tsc --noEmit",
  "lint": "expo lint",
  "expo:doctor": "expo-doctor",
  "export:ios": "expo export --platform ios"
}
```

Set `app.config.ts` to the exact global identifiers, version, iOS 15.1 target, and no camera/microphone/photo purpose strings yet. Set `eas.json` profiles `development`, `preview`, and `production`; no project ID, Apple team, credential, URL, or secret is committed.

- [ ] **Step 7: Run both clean package gates**

Run under exported Node 22:

```bash
npm ci && npm test && npm run typecheck && npm run lint && npm run build
cd mobile
npm ci && npm test && npm run typecheck && npm run lint && npx expo-doctor && npm run export:ios
```

Expected: all commands exit 0 and `docs/superpowers/**` still exists after the root build.

- [ ] **Step 8: Commit the reproducible foundation**

```bash
git add .gitignore .node-version package.json package-lock.json vite.config.ts vitest.config.ts src/baseline.test.ts mobile
git commit -m "feat: scaffold FieldCraft native foundation"
```

---

### Task 2: Versioned Domain Contracts and Integer-Cent Invoice Math

**Files:**
- Create: `contracts/fieldcraft.v1.schema.json`
- Create: `contracts/fixtures/invoice.valid.json`
- Create: `contracts/fixtures/invoice.invalid.json`
- Create: `mobile/src/domain/limits.ts`
- Create: `mobile/src/domain/entities.ts`
- Create: `mobile/src/domain/money.ts`
- Create: `mobile/src/domain/invoice.ts`
- Create: `mobile/src/domain/sync.ts`
- Create: `mobile/__tests__/money.test.ts`
- Create: `mobile/__tests__/invoiceDomain.test.ts`

**Interfaces:**
- Consumes: Zod and Expo Crypto from Task 1.
- Produces:
  - `MoneyCents`, `Client`, `Job`, `Invoice`, `Expense`, `Service`, `InventoryItem`, `UserProfile`.
  - `calculateInvoice(input: InvoiceDraft): CalculatedInvoice`.
  - `createEntityId(): string`.
  - `MutationEnvelope` and `ConflictRecord` used by persistence and sync.

- [ ] **Step 1: Write failing money and invoice tests**

Create tests with exact assertions:

```ts
import { calculateInvoice, InvoiceDraftSchema } from '../src/domain/invoice'

it('calculates integer-cent totals instead of trusting supplied AI totals', () => {
  const result = calculateInvoice({
    clientName: 'Jordan Lee',
    jobTitle: 'Replace valve',
    tradeType: 'Plumbing',
    taxBasisPoints: 825,
    paymentTerms: 'Due on receipt',
    lineItems: [
      { description: 'Labor', type: 'labor', quantity: 1500, unitPriceCents: 10000 },
      { description: 'Valve', type: 'material', quantity: 1000, unitPriceCents: 2599 },
    ],
  })
  expect(result.subtotalCents).toBe(17599)
  expect(result.taxCents).toBe(1452)
  expect(result.totalCents).toBe(19051)
})

it('counts Unicode code points at exact description boundaries', () => {
  expect(InvoiceDraftSchema.safeParse(validDraft('🧰'.repeat(500))).success).toBe(true)
  expect(InvoiceDraftSchema.safeParse(validDraft('🧰'.repeat(501))).success).toBe(false)
})
```

Quantity uses thousandths: `1500` means 1.5 units. Tax uses basis points: `825` means 8.25%.

- [ ] **Step 2: Verify domain tests fail because modules do not exist**

Run `cd mobile && npm test -- money.test.ts invoiceDomain.test.ts`.

Expected: FAIL with module resolution errors.

- [ ] **Step 3: Implement exact domain types and schemas**

Use:

```ts
export type MoneyCents = number
export type JobStatus = 'Scheduled' | 'In Progress' | 'Invoiced' | 'Paid'
export type SyncState = 'current' | 'pending' | 'syncing' | 'failed' | 'conflict'

export type LineItemDraft = {
  id?: string
  description: string
  type: 'labor' | 'material'
  quantity: number
  unitPriceCents: MoneyCents
}

export type InvoiceDraft = {
  clientName: string
  jobTitle: string
  jobAddress?: string
  jobDescription?: string
  tradeType: 'Plumbing' | 'Electrical' | 'HVAC' | 'Carpentry' | 'General' | 'Roofing' | 'Flooring' | 'Painting'
  taxBasisPoints: number
  paymentTerms: 'Due on receipt' | 'Net 14' | 'Net 30'
  lineItems: LineItemDraft[]
  notes?: string
}
```

`calculateInvoice` computes each line with `Math.round(quantity * unitPriceCents / 1000)`, sums integer cents, and computes tax with `Math.round(subtotalCents * taxBasisPoints / 10000)`. Reject non-finite numbers and all global-limit violations.

- [ ] **Step 4: Define sync envelopes and conflict records**

```ts
export type EntityName = 'profile' | 'client' | 'job' | 'invoice' | 'expense' | 'service' | 'inventory'
export type MutationKind = 'create' | 'update' | 'delete' | 'save_invoice_bundle'

export type MutationEnvelope = {
  id: string
  ownerId: string
  entity: EntityName
  entityId: string
  kind: MutationKind
  baseVersion: number | null
  payload: unknown
  createdAt: string
  attempts: number
}

export type ConflictRecord = {
  mutationId: string
  entity: EntityName
  entityId: string
  localPayload: unknown
  cloudPayload: unknown
  cloudVersion: number
}
```

- [ ] **Step 5: Validate JSON fixtures against both the JSON and Zod contracts**

Add a test that loads both fixtures, validates `invoice.valid.json`, rejects `invoice.invalid.json`, rejects unknown keys, 101 line items, non-integer cents, negative values, `NaN`, `Infinity`, and 501-code-point descriptions.

- [ ] **Step 6: Run domain gates and commit**

```bash
cd mobile
npm test -- money.test.ts invoiceDomain.test.ts
npm run typecheck
npm run lint
cd ..
git add contracts mobile/src/domain mobile/__tests__/money.test.ts mobile/__tests__/invoiceDomain.test.ts
git commit -m "feat: define FieldCraft domain contracts"
```

---

### Task 3: Supabase Migrations, RLS, Atomic Invoice Bundle, and Idempotency

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608030001_fieldcraft_core.sql`
- Create: `supabase/migrations/202608030002_fieldcraft_functions.sql`
- Create: `supabase/tests/database/fieldcraft_constraints.test.sql`
- Create: `supabase/tests/database/fieldcraft_rls.test.sql`
- Create: `supabase/tests/database/fieldcraft_idempotency.test.sql`
- Deprecate: `supabase/schema.sql` with a migration pointer; do not execute it in CI.

**Interfaces:**
- Consumes: Task 2 entity names, integer-cent fields, UUID mutation IDs.
- Produces:
  - cloud tables with RLS and `version`.
  - RPC `save_invoice_bundle(p_mutation_id uuid, p_payload jsonb) returns jsonb`.
  - RPC `apply_entity_mutation(p_mutation_id uuid, p_entity text, p_kind text, p_entity_id uuid, p_base_version bigint, p_payload jsonb) returns jsonb`.

- [ ] **Step 1: Write failing pgTAP constraint and RLS tests**

The constraint test asserts negative cents, invalid status, 101 line items, duplicate per-user invoice numbers, and cross-owner foreign keys fail. The RLS test creates `user_a` and `user_b`, sets JWT claims, and asserts each table returns and mutates only the active user's rows.

Use assertions such as:

```sql
select throws_ok(
  $$ insert into public.expenses (user_id, vendor, amount_cents, expense_date)
     values (auth.uid(), 'Vendor', -1, current_date) $$,
  '23514',
  null,
  'negative expense amount is rejected'
);
```

- [ ] **Step 2: Run database tests to verify the migrations are missing**

Run:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

Expected: FAIL because the new tables/functions do not exist. If Docker/Supabase CLI is unavailable, record that tooling blocker but still create and statically lint the pgTAP files; do not call the tests passed.

- [ ] **Step 3: Create the exact cloud schema**

Create tables `profiles`, `clients`, `jobs`, `invoices`, `expenses`, `services`, `inventory_items`, `mutation_receipts`, and `ai_rate_limits`. Every user table has `user_id` or owner `id`, `version bigint not null default 1`, `created_at`, and `updated_at`. Money columns end in `_cents` and are constrained to `0..100000000`. Add exact status/category checks matching Task 2.

Create foreign keys with owned-reference enforcement inside the RPCs, and indexes on `(user_id, updated_at)`, `(user_id, status)`, client/job relationships, and `(user_id, number)` unique for invoices.

- [ ] **Step 4: Add fixed-search-path triggers and RLS**

All trigger/security-definer functions begin with:

```sql
security definer
set search_path = pg_catalog, public
```

Create `bump_version_and_updated_at()` and attach it to mutable tables. Enable RLS and create `select`, `insert`, `update`, and `delete` policies using `auth.uid() = user_id`; profiles use `auth.uid() = id`.

- [ ] **Step 5: Implement idempotent compound and generic mutation RPCs**

`save_invoice_bundle` must:

1. require `auth.uid()`;
2. return an existing `mutation_receipts.response` for the same user/mutation ID;
3. validate the client, job, invoice, line items, money, and relationships;
4. insert/update all three records in one transaction;
5. store a receipt only after all writes succeed;
6. return canonical rows and versions.

`apply_entity_mutation` compares `p_base_version` for updates/deletes and returns `{ "status": "conflict", "cloud": ... }` without overwriting on mismatch.

- [ ] **Step 6: Prove transaction rollback and replay behavior**

Tests must show a malformed invoice leaves zero client/job/invoice rows, replay returns the same IDs without duplicates, user B cannot reuse user A's mutation receipt, and a stale base version returns conflict with both version numbers.

- [ ] **Step 7: Run database/static gates and commit**

```bash
npx supabase db lint
npx supabase test db
git add supabase
git commit -m "feat: add secure FieldCraft cloud schema"
```

Record unavailable local-container tooling as unverified rather than successful.

---

### Task 4: SQLite Cache, Repositories, and Durable Mutation Outbox

**Files:**
- Create: `mobile/src/data/database.ts`
- Create: `mobile/src/data/migrations.ts`
- Create: `mobile/src/data/repository.ts`
- Create: `mobile/src/data/sqliteRepository.ts`
- Create: `mobile/src/data/outbox.ts`
- Create: `mobile/src/data/ownerBoundary.ts`
- Create: `mobile/src/data/DataProvider.tsx`
- Create: `mobile/__mocks__/expo-sqlite.ts`
- Create: `mobile/__tests__/sqliteRepository.test.ts`
- Create: `mobile/__tests__/outbox.test.ts`
- Create: `mobile/__tests__/ownerBoundary.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas and mutation envelopes.
- Produces:
  - `FieldCraftRepository`.
  - `MutationOutbox`.
  - owner-scoped reactive `dataRevision` and `deleteEpoch`.

```ts
export interface FieldCraftRepository {
  initialize(ownerId: string): Promise<void>
  list<T>(entity: EntityName): Promise<T[]>
  get<T>(entity: EntityName, id: string): Promise<T | null>
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
  applyCloudRows(rows: CloudRowEnvelope[]): Promise<void>
  markConflict(conflict: ConflictRecord): Promise<void>
  clearOwner(ownerId: string): Promise<void>
  close(): Promise<void>
}
```

- [ ] **Step 1: Write failing migration, mutation, and owner-boundary tests**

Cover schema version 1, rollback when outbox insertion fails, UUID idempotency uniqueness, FIFO dependency order, corrupt JSON rejection, delete tombstones, stale read invalidation, switching from user A to user B, and delete-all preventing an in-flight read from repopulating rows.

- [ ] **Step 2: Verify focused tests fail because adapters are missing**

Run `cd mobile && npm test -- sqliteRepository.test.ts outbox.test.ts ownerBoundary.test.ts`.

- [ ] **Step 3: Implement transactional schema and migrations**

Create SQLite tables `records`, `outbox`, `conflicts`, `sync_cursors`, and `metadata`. Scope every primary/unique index by `owner_id`. Persist Task 2 payloads only after Zod validation. Migration application uses one transaction and records `PRAGMA user_version = 1` only after success.

- [ ] **Step 4: Implement atomic local writes and outbox**

`transactLocalMutation` validates the payload, upserts/deletes the cached row, and inserts the outbox envelope in one SQLite transaction. A duplicate mutation ID is a no-op only when its canonical payload hash matches; a mismatched duplicate is a corruption error.

- [ ] **Step 5: Implement owner revision and delete epochs**

Expose:

```ts
export type OwnerSnapshot = {
  ownerId: string | null
  dataRevision: number
  deleteEpoch: number
}
```

Every async list/get captures the snapshot and discards its result if owner or delete epoch changed before completion. `clearOwner` increments the epoch before deletion and emits a revision immediately so mounted screens clear sensitive state.

- [ ] **Step 6: Run repository gates and commit**

```bash
cd mobile
npm test -- sqliteRepository.test.ts outbox.test.ts ownerBoundary.test.ts
npm run typecheck
npm run lint
cd ..
git add mobile/src/data mobile/__mocks__/expo-sqlite.ts mobile/__tests__
git commit -m "feat: add durable FieldCraft offline storage"
```

---

### Task 5: Secure Supabase Authentication, Verification Links, and Session Lifecycle

**Files:**
- Create: `mobile/src/auth/secureStoreAuthStorage.ts`
- Create: `mobile/src/auth/supabase.ts`
- Create: `mobile/src/auth/authService.ts`
- Create: `mobile/src/auth/AuthProvider.tsx`
- Create: `mobile/src/auth/deepLinks.ts`
- Create: `mobile/app/(auth)/login.tsx`
- Create: `mobile/app/(auth)/signup.tsx`
- Create: `mobile/app/(auth)/verify-email.tsx`
- Create: `mobile/app/(auth)/reset-password.tsx`
- Create: `mobile/app/(auth)/onboarding.tsx`
- Create: `mobile/__tests__/secureStoreAuthStorage.test.ts`
- Create: `mobile/__tests__/authLifecycle.test.tsx`
- Create: `mobile/__tests__/deepLinks.test.ts`

**Interfaces:**
- Consumes: Task 4 owner boundary and repository clearing.
- Produces: `useAuth(): AuthState`, `AuthService`, and exact deep-link routes.

```ts
export type AuthState =
  | { status: 'initializing' }
  | { status: 'signedOut' }
  | { status: 'verificationRequired'; email: string }
  | { status: 'signedIn'; userId: string; email: string; hydrated: boolean }
  | { status: 'storageError'; message: string }
```

- [ ] **Step 1: Write failing SecureStore and auth lifecycle tests**

Cover values larger than 2 KiB, interrupted chunk writes, missing chunks, remove, storage failure with no plaintext fallback, app foreground/background refresh, signed-out owner clearing, user A→B transition, unverified email, password reset, duplicate callbacks, and stale hydration completion.

- [ ] **Step 2: Verify tests fail before auth modules exist**

Run `cd mobile && npm test -- secureStoreAuthStorage.test.ts authLifecycle.test.tsx deepLinks.test.ts`.

- [ ] **Step 3: Implement atomic chunked SecureStore storage**

Use a versioned manifest:

```ts
type SecureManifest = { version: 1; generation: string; chunks: number }
```

Split values into 1,800-code-unit chunks under generation-specific keys. Write all new chunks, then atomically replace the manifest; delete the prior generation only after the manifest succeeds. On failure, remove incomplete new chunks and throw `SecureAuthStorageError`. Never use AsyncStorage/localStorage as fallback.

- [ ] **Step 4: Configure Supabase and lifecycle handling**

Use `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; reject missing values and the exact documented example values. Configure `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`, `processLock`, and the SecureStore adapter. Start token refresh only while `AppState` is active.

- [ ] **Step 5: Implement exact native link handling**

Support:

- `fieldcraft://auth/callback?code=...`
- `fieldcraft://auth/verify?token_hash=...&type=signup`
- `fieldcraft://auth/reset?token_hash=...&type=recovery`

Reject unknown schemes, hosts, types, duplicate parameters, and missing tokens. Clear sensitive query parameters from navigation state after processing.

- [ ] **Step 6: Build accessible auth/onboarding routes**

Forms validate bounded email/password/profile fields, disable duplicate submissions, retain non-secret input on failure, announce errors, and never display raw Supabase error objects. Onboarding collects only name, business name, trade, rate, tax, and payment terms.

- [ ] **Step 7: Run auth gates and commit**

```bash
cd mobile
npm test -- secureStoreAuthStorage.test.ts authLifecycle.test.tsx deepLinks.test.ts
npm run typecheck
npm run lint
cd ..
git add mobile/src/auth mobile/app/'(auth)' mobile/__tests__
git commit -m "feat: add secure FieldCraft authentication"
```

---

### Task 6: Supabase Gateway, Offline Sync, Realtime, and Conflict Resolution

**Files:**
- Create: `mobile/src/data/remoteGateway.ts`
- Create: `mobile/src/data/supabaseGateway.ts`
- Create: `mobile/src/data/syncCoordinator.ts`
- Create: `mobile/src/data/SyncProvider.tsx`
- Create: `mobile/src/components/SyncStatusBanner.tsx`
- Create: `mobile/app/conflicts/[mutationId].tsx`
- Create: `mobile/__tests__/syncCoordinator.test.ts`
- Create: `mobile/__tests__/realtimeLifecycle.test.ts`
- Create: `mobile/__tests__/conflictResolution.test.tsx`

**Interfaces:**
- Consumes: Task 3 RPCs; Task 4 repository/outbox; Task 5 authenticated user.
- Produces: `SyncCoordinator`, `useSyncStatus()`, and conflict-resolution commands.

```ts
export type SyncStatus =
  | { state: 'offline'; pending: number }
  | { state: 'current'; lastSyncedAt: string }
  | { state: 'syncing'; pending: number }
  | { state: 'failed'; pending: number; retryAt: string }
  | { state: 'conflict'; count: number }
```

- [ ] **Step 1: Write failing sync state-machine tests**

Cover offline queueing, dependency order, duplicate trigger coalescing, exponential retry with jitter bounded to 5 seconds–5 minutes, auth refresh failure, owner change, app background cancellation, Realtime subscription cleanup, stale pull response, idempotent replay, and version conflicts.

- [ ] **Step 2: Run focused tests and confirm missing implementations**

Run `cd mobile && npm test -- syncCoordinator.test.ts realtimeLifecycle.test.ts conflictResolution.test.tsx`.

- [ ] **Step 3: Implement pull/push gateway and coordinator**

`pullSince(ownerId, cursor)` retrieves canonical rows ordered by `(updated_at, id)`. `pushMutation` calls `save_invoice_bundle` or `apply_entity_mutation` using the mutation UUID. Treat timeout/network/5xx as transient, 401 as reauthentication, 409/version result as conflict, 400 as permanent validation failure, and unknown response shapes as invalid server response.

- [ ] **Step 4: Implement lifecycle-safe Realtime subscriptions**

Subscribe only for the signed-in active owner while the app is foregrounded and online. Realtime events trigger a bounded pull; they never apply unvalidated payloads directly. Unsubscribe on background, sign-out, owner change, or provider unmount.

- [ ] **Step 5: Implement conflict UI**

The route displays field-level local/cloud values with sensitive fields masked from analytics/logs. Actions are exactly `Keep cloud` and `Apply my edit`. Applying the edit creates a new mutation using the current cloud version; it never mutates the old conflict in place.

- [ ] **Step 6: Run sync gates and commit**

```bash
cd mobile
npm test -- syncCoordinator.test.ts realtimeLifecycle.test.ts conflictResolution.test.tsx
npm run typecheck
npm run lint
cd ..
git add mobile/src/data mobile/src/components/SyncStatusBanner.tsx mobile/app/conflicts mobile/__tests__
git commit -m "feat: add offline FieldCraft synchronization"
```

---

### Task 7: Native Shell, Design System, Dashboard, and Accessible Navigation

**Files:**
- Create/Modify: `mobile/app/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/app/(tabs)/jobs.tsx`
- Create: `mobile/app/(tabs)/clients.tsx`
- Create: `mobile/app/(tabs)/expenses.tsx`
- Create: `mobile/app/(tabs)/settings.tsx`
- Create: `mobile/src/theme/tokens.ts`
- Create: `mobile/src/components/Screen.tsx`
- Create: `mobile/src/components/PrimaryButton.tsx`
- Create: `mobile/src/components/EmptyState.tsx`
- Create: `mobile/src/components/ErrorState.tsx`
- Create: `mobile/src/components/StatCard.tsx`
- Create: `mobile/src/components/JobRow.tsx`
- Create: `mobile/__tests__/navigation.test.tsx`
- Create: `mobile/__tests__/dashboard.test.tsx`
- Create: `mobile/__tests__/accessibility.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–6 providers/status; Task 2 entity selectors.
- Produces: exact tab test IDs `tab-dashboard`, `tab-jobs`, `tab-clients`, `tab-expenses`, `tab-settings`, plus `log-job`.

- [ ] **Step 1: Write failing native navigation and accessibility tests**

Assert five tabs in exact order, Dashboard voice/manual CTA, sync banner states, no sixth voice tab, 48-point primary action, large-text stacking at `fontScale: 2`, VoiceOver labels/roles, Reduced Motion disabling nonessential transforms, and scrollability on a 320×568 viewport.

- [ ] **Step 2: Verify the shell tests fail against the template**

Run `cd mobile && npm test -- navigation.test.tsx dashboard.test.tsx accessibility.test.tsx`.

- [ ] **Step 3: Implement the exact theme and reusable states**

```ts
export const colors = {
  charcoal: '#1A1A1A',
  panel: '#242424',
  warmWhite: '#F5F0EB',
  orange: '#FF6B2B',
  orangePressed: '#E55A1F',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#9CA3AF',
} as const

export const MIN_TOUCH_TARGET = 48
```

Use safe areas, keyboard-aware scroll containers, system font scaling, and no fixed-height text containers.

- [ ] **Step 4: Implement Dashboard from validated repository data**

Show outstanding cents, jobs this month, paid cents, expense cents, estimated profit, overdue count, recent jobs, sync state, and quick actions. Use integer-cent formatters. Never label estimates as tax/accounting advice.

- [ ] **Step 5: Run shell gates and commit**

```bash
cd mobile
npm test -- navigation.test.tsx dashboard.test.tsx accessibility.test.tsx
npm run typecheck
npm run lint
cd ..
git add mobile/app mobile/src/theme mobile/src/components mobile/__tests__
git commit -m "feat: add FieldCraft native app shell"
```

---

### Task 8: Jobs, Clients, Services, and Inventory CRUD

**Files:**
- Create: `mobile/app/jobs/new.tsx`
- Create: `mobile/app/jobs/[id].tsx`
- Create: `mobile/app/clients/new.tsx`
- Create: `mobile/app/clients/[id].tsx`
- Create: `mobile/app/settings/services.tsx`
- Create: `mobile/app/settings/inventory.tsx`
- Create: `mobile/src/features/jobs/jobForm.ts`
- Create: `mobile/src/features/clients/clientForm.ts`
- Create: `mobile/src/components/VirtualizedEntityList.tsx`
- Create: `mobile/src/components/ConfirmRecordDeleteSheet.tsx`
- Create: `mobile/__tests__/jobCrud.test.tsx`
- Create: `mobile/__tests__/clientCrud.test.tsx`
- Create: `mobile/__tests__/catalogCrud.test.tsx`

**Interfaces:**
- Consumes: Task 4 repository mutations; Task 6 sync state; Task 7 tab routes.
- Produces: owner-scoped CRUD for jobs, clients, services, inventory and semantic IDs used by E2E.

- [ ] **Step 1: Write failing CRUD and list tests**

Cover create/update/delete, duplicate tap suppression, optimistic local durability, pending/cloud badges, retained form input on failure, exact validation bounds, 200-row virtualization, search literals/Unicode, status filters, linked-record deletion warnings, stale reads after owner deletion, and offline creation.

- [ ] **Step 2: Verify tests fail before feature routes exist**

Run `cd mobile && npm test -- jobCrud.test.tsx clientCrud.test.tsx catalogCrud.test.tsx`.

- [ ] **Step 3: Implement bounded forms and mutation creation**

Each submit validates with Task 2 schemas, calls `transactLocalMutation`, awaits local commit, then navigates. Generate UUIDs with `expo-crypto`. Failure retains the draft and announces a classified error.

- [ ] **Step 4: Implement virtualized lists and linked deletion confirmation**

Use `FlatList` with stable IDs and keyboard-safe search. Deletion sheets state linked counts and the exact cloud rule. The control requires an explicit second action and disables while the local transaction runs.

- [ ] **Step 5: Run CRUD gates and commit**

```bash
cd mobile
npm test -- jobCrud.test.tsx clientCrud.test.tsx catalogCrud.test.tsx
npm run typecheck
npm run lint
cd ..
git add mobile/app/jobs mobile/app/clients mobile/app/settings mobile/src/features mobile/src/components mobile/__tests__
git commit -m "feat: add FieldCraft business record workflows"
```

---

### Task 9: Authenticated Supabase AI Proxy and Web Secret Removal

**Files:**
- Create: `supabase/functions/_shared/contracts.ts`
- Create: `supabase/functions/_shared/body.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/provider.ts`
- Create: `supabase/functions/_shared/rateLimit.ts`
- Create: `supabase/functions/fieldcraft-ai/index.ts`
- Create: `supabase/functions/fieldcraft-ai/index.test.ts`
- Create: `mobile/src/ai/contracts.ts`
- Create: `mobile/src/ai/consentStore.ts`
- Create: `mobile/src/ai/aiClient.ts`
- Create: `mobile/__tests__/aiClient.test.ts`
- Create: `mobile/__tests__/aiConsent.test.ts`
- Create: `src/lib/fieldcraftAi.ts`
- Modify: `src/lib/groq.ts` callers, then delete `src/lib/groq.ts`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.env.example`
- Create: `src/lib/fieldcraftAi.test.ts`

**Interfaces:**
- Consumes: Task 3 `ai_rate_limits`; Task 5 Supabase session; Task 2 invoice schema.
- Produces authenticated routes `invoice.parse.v1`, `expense.categorize.v1`, and `message.draft.v1`.

- [ ] **Step 1: Write failing proxy contract/security tests**

Cover OPTIONS/CORS, non-POST, wrong route, missing/invalid JWT, 64 KiB body, wrong consent version, 20,001-code-point transcript, unknown fields, user and network rate limits, provider timeout, 128 KiB provider body, malformed JSON/schema, content-free public errors, and successful versioned output.

Use a unique transcript marker and assert it never appears in captured logger calls or public error responses.

- [ ] **Step 2: Write failing mobile/web client tests**

Assert HTTPS-only function URL, no Groq hostname/key, Authorization uses the Supabase access token, consent required before fetch, deadline covers body reading, response-byte bound, cancellation, stable error mapping, and no provider body in UI errors.

- [ ] **Step 3: Verify proxy/client tests fail**

Run root/mobile/Deno focused suites. Expected: missing modules and current direct Groq path fail the assertions.

- [ ] **Step 4: Implement exact minimized request DTOs**

```ts
export type InvoiceParseRequestV1 = {
  route: 'invoice.parse.v1'
  consentVersion: '2026-08-03'
  transcript: string
  defaults: { tradeType: TradeType; hourlyRateCents: number; taxBasisPoints: number }
}

export type ExpenseCategorizeRequestV1 = {
  route: 'expense.categorize.v1'
  consentVersion: '2026-08-03'
  vendor: string
  amountCents: number
  notes: string
}

export type MessageDraftRequestV1 = {
  route: 'message.draft.v1'
  consentVersion: '2026-08-03'
  tone: 'Casual' | 'Professional' | 'Firm'
  context: string
}
```

Do not include email, phone, token, session, receipt image, raw IP, unrelated records, or client ID in the provider prompt.

- [ ] **Step 5: Implement authenticated independent rate limits**

The function validates the JWT, obtains the user ID, HMAC-digests network address with `AI_RATE_LIMIT_HMAC_SECRET`, and calls a service-role-only atomic database function for independent `(user, route)` and `(networkDigest, route)` windows. Limits are 10 invoice parses, 30 expense categorizations, and 30 drafts per 60 seconds for each scope. Apply the stricter result and return `429` with integer `retryAfterSeconds`.

- [ ] **Step 6: Implement bounded provider access**

Use a 20-second invoice deadline and 10-second categorization/draft deadline. Read provider bodies with a streaming 128 KiB cap before JSON parsing. Use `max_completion_tokens` and reject unknown response fields. Normal logs contain only request ID, route, user digest, network digest, status, latency bucket, and public error code.

- [ ] **Step 7: Remove the browser secret architecture**

Delete `VITE_GROQ_API_KEY` from workflow/env/docs and remove all direct Groq imports. The web client obtains the Supabase session, requires consent, calls the Edge Function, validates results, and retains a manual/local fallback. No built JS file may contain `api.groq.com` or a Groq credential pattern.

- [ ] **Step 8: Run proxy/web/mobile tests and commit**

```bash
npx vitest run src/lib/fieldcraftAi.test.ts
cd mobile && npm test -- aiClient.test.ts aiConsent.test.ts && npm run typecheck && npm run lint
cd ../supabase/functions/fieldcraft-ai && deno test --allow-env index.test.ts
cd ../../..
git add supabase/functions mobile/src/ai mobile/__tests__ src/lib .github/workflows/deploy.yml .env.example
git commit -m "fix: keep FieldCraft AI secrets server-side"
```

If Deno is unavailable, record the Edge runtime suite as unverified and keep pure-contract tests runnable under Node; do not report Deno green.

---

### Task 10: Manual and AI-Assisted Invoice Workflow with Atomic Save

**Files:**
- Create: `mobile/app/invoices/new.tsx`
- Create: `mobile/app/invoices/review.tsx`
- Create: `mobile/app/invoices/[id].tsx`
- Create: `mobile/src/features/invoices/invoiceSession.tsx`
- Create: `mobile/src/features/invoices/InvoiceEditor.tsx`
- Create: `mobile/src/features/invoices/InvoiceSummary.tsx`
- Create: `mobile/src/features/invoices/saveInvoiceBundle.ts`
- Create: `mobile/__tests__/invoiceFlow.test.tsx`
- Create: `mobile/__tests__/invoiceAtomicSave.test.ts`
- Create: `mobile/__tests__/invoiceLifecycle.test.tsx`

**Interfaces:**
- Consumes: Task 2 invoice math/schema; Task 6 outbox; Task 9 AI client.
- Produces a complete typed/manual invoice flow and `saveInvoiceBundle(draft, existingClientId?): Promise<BundleIds>`.

- [ ] **Step 1: Write failing end-to-end component tests**

Cover typed entry without AI/network, transcript preview, consent decline, AI schema rejection, local total recomputation, 100-line boundary, client matching, new client creation, atomic mutation payload, duplicate save taps, navigation cancellation, stale AI result after manual edit, offline pending save, and retained draft after failure.

- [ ] **Step 2: Verify invoice tests fail before routes/session exist**

Run `cd mobile && npm test -- invoiceFlow.test.tsx invoiceAtomicSave.test.ts invoiceLifecycle.test.tsx`.

- [ ] **Step 3: Implement lifecycle-safe invoice session**

State is exactly:

```ts
type InvoiceSessionState =
  | { step: 'entry'; inputMode: 'manual' | 'voice'; transcript: string }
  | { step: 'parsing'; transcript: string; requestId: string }
  | { step: 'review'; draft: InvoiceDraft; source: 'manual' | 'ai' }
  | { step: 'saving'; draft: InvoiceDraft; mutationId: string }
  | { step: 'complete'; ids: BundleIds; syncState: 'pending' | 'current' }
  | { step: 'error'; draft: InvoiceDraft | null; code: InvoiceFlowErrorCode }
```

Abort/invalidate AI work on manual changes, back, new request, sign-out, owner change, and unmount.

- [ ] **Step 4: Implement editor and locally authoritative totals**

All fields are editable. Every quantity/price/tax change runs `calculateInvoice`; no AI subtotal/tax/total is accepted. The save control is disabled until validation passes and while the local transaction is in progress.

- [ ] **Step 5: Save one compound outbox operation**

`saveInvoiceBundle` generates stable client/job/invoice IDs and one mutation UUID before the first attempt. It writes local canonical rows plus one `save_invoice_bundle` envelope in a single SQLite transaction. Retrying reuses the same mutation UUID.

- [ ] **Step 6: Run invoice gates and commit**

```bash
cd mobile
npm test -- invoiceFlow.test.tsx invoiceAtomicSave.test.ts invoiceLifecycle.test.tsx
npm run typecheck
npm run lint
cd ..
git add mobile/app/invoices mobile/src/features/invoices mobile/__tests__
git commit -m "feat: add atomic FieldCraft invoice workflow"
```

---

### Task 11: On-Device Apple Speech with Expo Go Manual Fallback

**Files:**
- Create: `mobile/modules/fieldcraft-speech/package.json`
- Create: `mobile/modules/fieldcraft-speech/expo-module.config.json`
- Create: `mobile/modules/fieldcraft-speech/index.ts`
- Create: `mobile/modules/fieldcraft-speech/ios/FieldCraftSpeech.podspec`
- Create: `mobile/modules/fieldcraft-speech/ios/FieldCraftSpeechModule.swift`
- Create: `mobile/src/native/speech.ts`
- Create: `mobile/src/features/invoices/VoiceTranscriptInput.tsx`
- Modify: `mobile/app.config.ts`
- Create: `mobile/__tests__/speechAdapter.test.ts`
- Create: `mobile/__tests__/voiceTranscriptFlow.test.tsx`
- Create: `mobile/__tests__/speechNativeStatic.test.ts`

**Interfaces:**
- Consumes: Task 10 invoice entry; emits reviewed text only.
- Produces:

```ts
export interface SpeechPort {
  availability(): Promise<'available' | 'manual-only' | 'permission-denied'>
  start(options: { locale: string; maxDurationMs: 120000 }): Promise<void>
  stop(): Promise<{ transcript: string }>
  cancel(): Promise<void>
}
```

- [ ] **Step 1: Write failing adapter, flow, and static native tests**

Cover module absent in Expo Go, permission denied, on-device unavailable, partial/final transcripts, exact 120-second timeout, cancellation, duplicate starts, app background, unmount, empty text, 20,000-code-point bound, and raw-audio filename/API absence.

- [ ] **Step 2: Verify speech tests fail before the module exists**

Run `cd mobile && npm test -- speechAdapter.test.ts voiceTranscriptFlow.test.tsx speechNativeStatic.test.ts`.

- [ ] **Step 3: Implement the Swift Expo module**

Use `SFSpeechRecognizer`, `SFSpeechAudioBufferRecognitionRequest`, and `AVAudioEngine`. Set `requiresOnDeviceRecognition = true` when supported; if on-device recognition is unavailable, return stable `ON_DEVICE_UNAVAILABLE` and do not start network-backed recognition. Stream audio buffers in memory only, install one tap, stop/remove it in every completion/cancel/error/background path, and never write an audio file.

Stable native codes are `PERMISSION_DENIED`, `ON_DEVICE_UNAVAILABLE`, `ALREADY_RECORDING`, `NOT_RECORDING`, `TIMEOUT`, `NO_SPEECH`, and `RECOGNITION_FAILED`.

- [ ] **Step 4: Configure least-privilege iOS purpose strings**

Add exact strings:

- Microphone: `FieldCraft uses the microphone only while you record a job description for an editable invoice draft.`
- Speech recognition: `FieldCraft converts your spoken job description into editable text on this device.`

No background audio mode is enabled.

- [ ] **Step 5: Implement truthful Expo Go fallback UI**

When the native module is absent, show `Voice entry requires the FieldCraft development build. Type the job details below.` Manual text remains fully usable. Never label voice as passed in Expo Go.

- [ ] **Step 6: Run JS/static gates and commit**

```bash
cd mobile
npm test -- speechAdapter.test.ts voiceTranscriptFlow.test.tsx speechNativeStatic.test.ts
npm run typecheck
npm run lint
npm run export:ios
cd ..
git add mobile/modules/fieldcraft-speech mobile/src/native mobile/src/features/invoices mobile/app.config.ts mobile/__tests__
git commit -m "feat: add private on-device job transcription"
```

Swift compilation remains a development-build gate; source/static tests do not prove compilation.

---

### Task 12: On-Device Vision Receipt OCR and Expense Workflow

**Files:**
- Create: `mobile/modules/fieldcraft-vision/package.json`
- Create: `mobile/modules/fieldcraft-vision/expo-module.config.json`
- Create: `mobile/modules/fieldcraft-vision/index.ts`
- Create: `mobile/modules/fieldcraft-vision/ios/FieldCraftVision.podspec`
- Create: `mobile/modules/fieldcraft-vision/ios/FieldCraftVisionModule.swift`
- Create: `mobile/src/native/vision.ts`
- Create: `mobile/src/files/tempArtifactRegistry.ts`
- Create: `mobile/src/files/imageImport.ts`
- Create: `mobile/src/features/expenses/receiptParser.ts`
- Create: `mobile/src/features/expenses/ExpenseEditor.tsx`
- Create: `mobile/app/expenses/new.tsx`
- Create: `mobile/__tests__/visionAdapter.test.ts`
- Create: `mobile/__tests__/receiptImport.test.ts`
- Create: `mobile/__tests__/receiptParser.test.ts`
- Create: `mobile/__tests__/expenseFlow.test.tsx`

**Interfaces:**
- Consumes: Task 8 jobs; Task 9 optional categorization; Task 4 outbox.
- Produces reviewed `ExpenseDraft` and scoped artifact cleanup.

```ts
export type ReceiptOcrResult = {
  text: string
  confidence: number
  observations: { text: string; confidence: number; x: number; y: number }[]
}
```

- [ ] **Step 1: Write failing receipt bounds, parser, lifecycle, and UI tests**

Cover camera/photo cancellation, unsupported type, 12 MiB byte limit, 4096-pixel dimension, non-local URI copy, orientation, module absent, OCR failure, 30,000-code-point cap, deterministic vendor/date/total extraction, low-confidence manual review, AI consent decline, category fallback, offline save, and artifact deletion after every exit path.

- [ ] **Step 2: Verify focused tests fail**

Run `cd mobile && npm test -- visionAdapter.test.ts receiptImport.test.ts receiptParser.test.ts expenseFlow.test.tsx`.

- [ ] **Step 3: Implement scoped imports and artifact ownership**

Copy selected images to `cacheDirectory/fieldcraft-imports/<uuid>.<ext>`, validate actual bytes and decoded dimensions, register the path, and delete it in `finally`. Delete-all scans only `fieldcraft-imports`, `fieldcraft-pdf`, and `fieldcraft-logo-work` owned paths; never recursively clear the whole app cache.

- [ ] **Step 4: Implement Swift Vision recognition**

Use `VNRecognizeTextRequest` with accurate recognition, English language, orientation mapping, and deterministic top-to-bottom plus same-line left-to-right ordering. Read only local file URLs. Stable codes are `FILE_NOT_LOCAL`, `FILE_TOO_LARGE`, `IMAGE_UNREADABLE`, `OCR_UNAVAILABLE`, `OCR_FAILED`, and `TEXT_TOO_LARGE`.

- [ ] **Step 5: Implement deterministic receipt parsing and optional minimization**

Extract candidate vendor/date/total locally and always show editable fields plus confidence. Optional proxy categorization receives only vendor (120 code points), amount cents, and notes (500 code points). It never receives the image or full OCR text.

- [ ] **Step 6: Add least-privilege purpose strings**

- Camera: `FieldCraft uses the camera only when you choose to scan a receipt on this device.`
- Photo library: `FieldCraft lets you choose a receipt or business logo that you explicitly select.`

Do not request photo write access.

- [ ] **Step 7: Run receipt gates and commit**

```bash
cd mobile
npm test -- visionAdapter.test.ts receiptImport.test.ts receiptParser.test.ts expenseFlow.test.tsx
npm run typecheck
npm run lint
npm run export:ios
cd ..
git add mobile/modules/fieldcraft-vision mobile/src/native mobile/src/files mobile/src/features/expenses mobile/app/expenses mobile/app.config.ts mobile/__tests__
git commit -m "feat: add private FieldCraft receipt capture"
```

---

### Task 13: Native PDF Sharing, Safe Logos, and File Lifecycle

**Files:**
- Create: `mobile/src/files/logoImport.ts`
- Create: `mobile/src/files/invoicePdf.ts`
- Create: `mobile/src/files/shareInvoice.ts`
- Create: `mobile/src/components/InvoiceSharePreview.tsx`
- Create: `mobile/app/invoices/[id]/share.tsx`
- Create: `mobile/app/settings/business-logo.tsx`
- Create: `supabase/migrations/202608030003_logo_storage.sql`
- Create: `mobile/__tests__/logoImport.test.ts`
- Create: `mobile/__tests__/invoicePdf.test.ts`
- Create: `mobile/__tests__/shareInvoice.test.tsx`

**Interfaces:**
- Consumes: Task 2 canonical invoice; Task 12 artifact registry; Task 3 storage RLS.
- Produces safe business logos and user-initiated PDF/share behavior.

- [ ] **Step 1: Write failing file, content, and sharing tests**

Cover 2 MiB logo bound, raster-only MIME validation, decode failure, resize to maximum 512×512, SVG/HTML/data URL rejection, owner-scoped storage path, PDF integer-cent totals, all required fields, no hidden contact fields, 10 MiB PDF cap, share unavailable/failure, duplicate taps, and cleanup after success/failure/cancel/unmount.

- [ ] **Step 2: Verify tests fail before services/routes exist**

Run `cd mobile && npm test -- logoImport.test.ts invoicePdf.test.ts shareInvoice.test.tsx`.

- [ ] **Step 3: Implement safe logo storage and RLS**

Decode JPEG/PNG/HEIC selected files, resize/rasterize locally, and upload to `business-logos/<auth.uid()>/logo.jpg`. Storage policies require the first folder segment to equal `auth.uid()`. Store only the resulting object path in the profile, not arbitrary data URLs.

- [ ] **Step 4: Implement bounded native PDF creation**

Generate HTML from escaped text and integer-cent formatters, then create a PDF using `expo-print`. The PDF includes FieldCraft/business identity, invoice number/date, client, job, line items, subtotal, tax, total, terms, and reviewed notes. It contains no AI provenance claim and no assertion that it was sent.

- [ ] **Step 5: Implement explicit share semantics and cleanup**

Write PDFs under `fieldcraft-pdf/<uuid>.pdf`, verify byte size, call `expo-sharing` only after the user presses `Share invoice`, and delete in `finally`. User-visible success copy is `Share sheet opened`; never `Invoice sent`.

- [ ] **Step 6: Run file gates and commit**

```bash
cd mobile
npm test -- logoImport.test.ts invoicePdf.test.ts shareInvoice.test.tsx
npm run typecheck
npm run lint
cd ..
git add mobile/src/files mobile/src/components/InvoiceSharePreview.tsx mobile/app/invoices mobile/app/settings/business-logo.tsx mobile/__tests__ supabase/migrations/202608030003_logo_storage.sql
git commit -m "feat: add safe FieldCraft invoice sharing"
```

---

### Task 14: Settings, Privacy, Data Deletion, and Account Deletion

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`
- Create: `mobile/app/privacy.tsx`
- Create: `mobile/app/settings/sync.tsx`
- Create: `mobile/app/settings/ai.tsx`
- Create: `mobile/app/settings/delete-data.tsx`
- Create: `mobile/app/settings/delete-account.tsx`
- Create: `mobile/src/privacy/deleteLocalData.ts`
- Create: `mobile/src/privacy/deleteAccount.ts`
- Create: `supabase/functions/delete-account/index.ts`
- Create: `supabase/functions/delete-account/index.test.ts`
- Create: `public/privacy.html`
- Create: `public/support.html`
- Create: `mobile/__tests__/settingsPrivacy.test.tsx`
- Create: `mobile/__tests__/deleteLocalData.test.ts`
- Create: `mobile/__tests__/deleteAccount.test.tsx`

**Interfaces:**
- Consumes: Task 4 owner deletion epoch; Tasks 5/9/12/13 sessions, consent, and artifacts.
- Produces coordinated local deletion and authenticated cloud-account deletion.

- [ ] **Step 1: Write failing privacy/settings/deletion tests**

Cover AI consent grant/revoke, sync diagnostics without content, exact `DELETE` phrase for local cache, exact `DELETE MY ACCOUNT` phrase for account deletion, duplicate taps, unmount, Edge Function auth failure, cascade success, partial local cleanup, retry, in-memory clearing, SecureStore clearing, outbox/conflict clearing, temp artifact clearing, and no false success when any required local subsystem fails.

- [ ] **Step 2: Verify tests fail against incomplete settings**

Run `cd mobile && npm test -- settingsPrivacy.test.tsx deleteLocalData.test.ts deleteAccount.test.tsx`.

- [ ] **Step 3: Implement coordinated local deletion**

```ts
export type DeleteSubsystem = 'repository' | 'outbox' | 'conflicts' | 'auth' | 'consent' | 'artifacts' | 'memory'
export type DeleteOutcome = { ok: true } | { ok: false; failed: DeleteSubsystem[] }
```

Increment the owner delete epoch and clear visible state first, then attempt every subsystem with `Promise.allSettled`. Return exact failed subsystems and keep a retry marker until all succeed.

- [ ] **Step 4: Implement authenticated account deletion boundary**

The Edge Function validates the access token, resolves the user, and uses the service role only inside the function to delete that exact auth user. It returns only request ID and stable status. Database rows and Storage objects are removed by cascade/policy-compatible cleanup. No service-role key reaches the client.

- [ ] **Step 5: Publish matching policies**

Both policies disclose Supabase cloud storage, local offline cache, optional reviewed transcript/extracted-field transfer to Groq through FieldCraft's function, no raw audio/image upload, retention, account/local deletion, no tracking/ads/contacts/payments/automatic messages, AI limitations, support URL, and user responsibility for invoice/accounting review.

- [ ] **Step 6: Run privacy gates and commit**

```bash
cd mobile
npm test -- settingsPrivacy.test.tsx deleteLocalData.test.ts deleteAccount.test.tsx
npm run typecheck
npm run lint
cd ../supabase/functions/delete-account
deno test --allow-env index.test.ts
cd ../../..
npx vitest run
git add mobile/app mobile/src/privacy mobile/__tests__ supabase/functions/delete-account public
git commit -m "feat: add FieldCraft privacy controls"
```

---

### Task 15: CI, Secret Scanning, App Store Metadata, and Accessibility Matrix

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Create: `scripts/scan-secrets.mjs`
- Create: `src/secretScan.test.ts`
- Create: `mobile/e2e/fieldcraft-core.yaml`
- Create: `mobile/__tests__/e2eIds.test.ts`
- Create: `mobile/__tests__/accessibilityRelease.test.tsx`
- Create: `docs/app-store/fieldcraft-ios-metadata.md`
- Create: `docs/app-store/fieldcraft-ios-release-checklist.md`
- Create: `docs/app-store/fieldcraft-ios-screenshot-matrix.md`
- Create: `mobile/assets/icon.png`

**Interfaces:**
- Consumes: all prior tasks.
- Produces repeatable CI, semantic E2E flow, credential-free metadata, and truthful release checklist.

- [ ] **Step 1: Write failing scanner/workflow/config tests**

Assert CI uses Node 22 and runs web clean install/test/typecheck/lint/build; mobile clean install/test/typecheck/lint/Expo Doctor/iOS export; backend tests/lint; scanner on tracked files and web/mobile/function bundles. Assert deploy depends on the same gates. Scanner fixtures cover JSON/YAML/shell assignments and must report only file path, rule ID, and count—never candidate values.

- [ ] **Step 2: Implement redacted scanner and harden ignores**

Scan `git ls-files` plus explicit bundle directories for provider/service-role key patterns, private keys, bearer tokens, and suspicious non-public env assignments. Exclude the exact documented public sample values and scanner fixture files by exact path. Add `.env*`, `.dev.vars*`, `.supabase/`, `.wrangler/`, EAS local artifacts, and native credential files to `.gitignore`, with explicit `!.env.example` and `!.dev.vars.example` exceptions.

- [ ] **Step 3: Add semantic Maestro flow**

`fieldcraft-core.yaml` uses no coordinates and covers:

```yaml
appId: com.avinashamanchi.fieldcraft
---
- launchApp
- assertVisible: "Dashboard"
- tapOn: { id: "log-job" }
- tapOn: { id: "manual-job-entry" }
- inputText: "Replace valve for Jordan, two hours labor and one $25 valve"
- tapOn: { id: "review-invoice" }
- assertVisible: "Review invoice"
- tapOn: { id: "save-invoice" }
- assertVisible: "Saved on this device"
- tapOn: { id: "tab-jobs" }
- tapOn: { id: "job-row-0" }
- assertVisible: "Invoice"
```

The tracked core flow assumes the simulator or review device was authenticated by the release operator before Maestro starts; `launchApp` deliberately preserves state. Authentication remains a separate manual release gate using a provider-owned temporary review account whose credentials are never written to the repository, CI variables, shell history, or release evidence. CI runs the semantic-ID/static contract for this flow but never attempts a production login.

- [ ] **Step 4: Prove accessibility release interpretations**

Tests render every primary screen at `fontScale: 2` and a 320×568 viewport; assert scroll/virtualization, all primary controls, 48-point targets, no clipped fixed-height text parents, screen-reader roles/labels, focus restoration after sheets, error announcements, and Reduce Motion behavior.

- [ ] **Step 5: Create exact metadata and privacy drafts**

Metadata uses business-management language, not guaranteed savings/revenue/accounting claims. App Privacy drafts disclose contact/business/user content, diagnostics only if actually collected, Supabase cloud sync, optional Groq processing after consent, and no tracking. Review notes explain manual fallback and development-build-only Speech/Vision testing.

- [ ] **Step 6: Create and validate app icon**

Create a 1024×1024 opaque RGB/RGBA PNG with no alpha and FieldCraft's charcoal/orange identity. Test exact dimensions/mode and ensure splash/icon are configured without credential/project identifiers.

- [ ] **Step 7: Run CI-equivalent gates and commit**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run scan:secrets
cd mobile
npm ci && npm test && npm run typecheck && npm run lint && npx expo-doctor && npm run export:ios
cd ..
git diff --check
git status --short
git add .github .gitignore scripts src/secretScan.test.ts mobile/e2e mobile/__tests__ docs/app-store mobile/assets mobile/app.config.ts
git commit -m "test: prepare FieldCraft iOS release gates"
```

---

### Task 16: Clean-Checkout Verification, Expo Go Checkpoint, and Credentialed Stop

**Files:**
- Modify: `README.md`
- Modify: `mobile/README.md`
- Modify: `docs/app-store/fieldcraft-ios-release-checklist.md` with observed results only
- Create: `.github/workflows/release-readiness.yml`

**Interfaces:**
- Consumes: the complete branch.
- Produces exact-SHA clean-checkout evidence, an Expo Go checkpoint, and explicit development-build/App Store stop conditions.

- [ ] **Step 1: Add a release-readiness workflow without publishing**

The workflow is `workflow_dispatch` only, runs every Task 15 gate, performs a Wrangler/Supabase Edge bundle or dry-run without secrets where supported, uploads test artifacts that contain no user content, and never deploys/submits.

- [ ] **Step 2: Run exact-SHA fresh-clone verification under confirmed Node 22**

After committing all implementation changes, create a local clone with no hardlinks at that exact SHA. Export Node 22 for the entire shell, not only the version probe. Run root/mobile/backend installs, tests, typechecks, lint, builds/exports, Expo Doctor, SQL/Edge tests available locally, YAML parsing, audit commands, `git diff --check`, redacted tracked-tree/bundle scanning, and confirm the clone is clean.

Record exact suite/test counts, audit totals, unsupported tool gates, and warnings in the tracked release checklist. Do not cite an ignored scratch report as release evidence.

- [ ] **Step 3: Start the Expo Go physical-iPhone checkpoint**

Run:

```bash
cd mobile
npx expo start --lan --clear
```

Have the user observe supported authentication/mock paths, manual invoice entry, navigation, cached/offline behavior, lists, settings, privacy, PDF/share APIs supported by Expo Go, Dynamic Type, VoiceOver, and Reduced Motion. Record only observed results. Voice and Vision remain unpassed in Expo Go.

- [ ] **Step 4: Stop at Supabase/Expo/Apple credentials**

Do not request credentials. The user personally signs in to Supabase/Expo/Apple and configures function secrets through provider prompts. Only after the user authorizes and completes those prompts may the operator:

1. apply migrations to the user-owned Supabase project;
2. configure `GROQ_API_KEY` and `AI_RATE_LIMIT_HMAC_SECRET` as Edge Function secrets;
3. deploy functions and verify content-free logs with synthetic markers;
4. configure `EXPO_PUBLIC_SUPABASE_URL`, publishable key, and function URL in EAS environments;
5. configure web public endpoint variables;
6. run one consented synthetic request per route.

- [ ] **Step 5: Build and test a FieldCraft development client**

After Apple/Expo prerequisites:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile development
```

Install on a physical iPhone and run the Speech, Vision, SecureStore, deep-link, PDF, camera/photo, offline/reconnect, 200% Dynamic Type, VoiceOver, Reduce Motion, app-icon, splash, and privacy-purpose matrix. Any compile, permission, data-loss, cleanup, or privacy mismatch blocks production.

- [ ] **Step 6: Recheck current Apple upload requirements and stop before submission if any gate is open**

At the design date Apple requires Xcode 26+ with iOS 26 SDK+. Verify the authoritative Apple requirement again immediately before build. Require Apple membership, App Store Connect record, signed production build, App Privacy, age rating, support/privacy URLs, screenshots, review notes, TestFlight, and development-build matrix.

- [ ] **Step 7: Build/submit only after all prior gates pass**

```bash
cd mobile
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

Submission is not publication. Verify App Review approval and the public listing before stating FieldCraft is published. Android remains out of scope until that verification.

- [ ] **Step 8: Commit truthful verification documentation**

```bash
git add README.md mobile/README.md docs/app-store/fieldcraft-ios-release-checklist.md .github/workflows/release-readiness.yml
git commit -m "docs: record FieldCraft iOS release readiness"
```

---

## Plan Completion Definition

The implementation plan is complete only when Tasks 1–16 have committed deliverables, each task has an independent spec/quality review, the broad final review is clean or has explicit non-load-bearing rulings, exact-SHA Node 22 clean-checkout gates pass, supported Expo Go observations are recorded, and all remaining native/credentialed/App Store gates are explicitly open or verified.

FieldCraft must not be described as App Store published until Apple approves the submitted build and the public listing is independently verified. Android begins only after that point.
