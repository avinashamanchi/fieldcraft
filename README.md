# FieldCraft

FieldCraft is an iOS-first and web field-service workspace for jobs, clients, invoices, expenses, services, and inventory. It supports authenticated Supabase sync, an on-device offline cache, editable invoice calculations, PDF sharing, and optional consent-gated AI through server-side Edge Functions.

**Web app:** https://avinashamanchi.github.io/fieldcraft/

FieldCraft is business-management software, not accounting, tax, legal, or financial advice. It does not guarantee revenue, savings, payment, message delivery, or AI accuracy. Review every amount and record before using or sharing it.

## What is implemented

- Five-tab Expo/React Native iOS shell with native stack routes and 48-point controls.
- Local-first SQLite repositories, owner boundaries, outbox, bounded pull/push sync, realtime invalidation, conflict resolution, and atomic invoice bundle saves.
- Full client, job, invoice, expense, service, inventory, business-logo, privacy, consent, local-deletion, and account-deletion flows.
- Deterministic quick local invoice entry that works without network or AI.
- Optional reviewed transcript/expense-field processing through authenticated Supabase functions. Provider and service-role keys remain server-side.
- On-device Apple Speech and Vision Expo modules for signed development/App Store builds; typed manual entry remains available in Expo Go.
- Local PDF generation and user-initiated share sheet with retry-safe temporary-file cleanup.
- App Store metadata, screenshot matrix, privacy drafts, semantic Maestro flow, redacted secret scanner, and CI/release-readiness workflows.

## Repository layout

```text
fieldcraft/
├── src/                         Web application and web tests
├── mobile/                      Expo/React Native iOS application
├── supabase/migrations/         Ordered production database migrations
├── supabase/functions/          Authenticated AI and account-deletion boundaries
├── scripts/                     Migration checks, PGlite verification, secret scanner
├── docs/app-store/              iOS metadata, screenshots, and release checklist
└── .github/workflows/           CI, Pages deployment, manual release readiness
```

The retired `supabase/schema.sql` and disabled setup workflow are not provisioning mechanisms. Apply the ordered migrations with a migration-aware, user-authorized Supabase release process.

## Requirements

- Node 22 (the workflows pin 22.22.0)
- npm with lockfile installs
- Deno 2 for Edge formatting, lint, and tests
- Full Xcode meeting Apple's current upload requirement for native archives
- Supabase, Expo/EAS, and Apple accounts only when the owner is ready for provider deployment and signed builds

## Local web checks

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run scan:secrets
npm run check:supabase-boundary
npm run test:supabase-pglite
```

Run the website with `npm run dev`. Only public Supabase endpoint configuration belongs in the web build. Never expose provider, HMAC, service-role, Expo, or Apple credentials through `VITE_` variables.

## iOS development

See [mobile/README.md](mobile/README.md) for Expo Go, development-client, native-module, test, and configuration boundaries.

## Privacy and backend boundary

- AI is off until versioned user consent is granted.
- The client sends only a reviewed transcript or minimized reviewed expense fields to the authenticated function.
- Raw audio and receipt images are not uploaded to the AI provider.
- The app has no ad SDK, tracking, contact-book access, payment access, location collection, or automatic customer messaging.
- Account deletion resolves the authenticated user server-side and deletes only that owner's account/logo; local deletion reports exact incomplete subsystems and retains retry work.
- Never paste credentials into chat, source, shell history, CI logs, screenshots, or release evidence. The owner enters them only through provider-controlled prompts.

## Release state

Local green checks and an iOS JavaScript export are not an App Store release. A production release still requires user-owned provider configuration, full Xcode, a signed EAS/native build, physical-iPhone Speech/Vision/privacy/accessibility validation, TestFlight processing, App Store Connect metadata, and App Review acceptance.

Use the tracked [release checklist](docs/app-store/fieldcraft-ios-release-checklist.md), [metadata draft](docs/app-store/fieldcraft-ios-metadata.md), and [screenshot matrix](docs/app-store/fieldcraft-ios-screenshot-matrix.md). The manual release-readiness workflow never deploys or submits.
