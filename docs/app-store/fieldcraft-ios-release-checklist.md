# FieldCraft iOS release checklist

Last updated: 2026-08-06. `PASS` means directly observed evidence. `BLOCKED` means credentials, provider state, hardware, or App Store Connect are still required. Blank boxes are not complete.

## Local implementation and CI

- [ ] Exact committed SHA recorded after Task 15.
- [ ] Fresh no-hardlink clone is clean before and after verification.
- [ ] Root clean install, tests, typecheck, lint, web build, and redacted secret scan pass.
- [ ] Mobile clean install, Jest, typecheck, lint, Expo Doctor, and iOS export pass.
- [ ] Supabase migration boundary, PGlite, Deno format/lint/tests pass.
- [ ] Workflow YAML parses and release-readiness workflow is manual-only.
- [ ] Root and mobile audit totals recorded without hiding advisories.
- [ ] 1024×1024 opaque RGB icon validated and configured.

## iPhone and accessibility

- [ ] Expo Go checkpoint observed by the user: authentication/mock path, quick local invoice, review/save, navigation, lists, cached/offline behavior, settings, privacy, and supported PDF/share behavior.
- [ ] 200% Dynamic Type observed on a physical iPhone without lost controls or clipped required text.
- [ ] VoiceOver reading order, names, values, alerts, modal behavior, and focus restoration observed.
- [ ] Reduce Motion behavior observed.
- [ ] Small-screen 320×568 test matrix passes.
- [ ] Apple Speech and Vision pass in a signed FieldCraft development client. `BLOCKED: not available in Expo Go.`
- [ ] Microphone, speech, camera, photo picker, SecureStore, deep links, PDF/share, offline/reconnect, icon, splash, and cleanup pass on hardware.

## Backend and privacy

- [ ] User applies ordered migrations to the user-owned Supabase project.
- [ ] User configures `GROQ_API_KEY` and `AI_RATE_LIMIT_HMAC_SECRET` through provider secret prompts.
- [ ] Functions deploy and synthetic consented requests pass with content-free logs.
- [ ] EAS public environment contains the production Supabase URL/publishable key; no service-role/provider secret is present in the app or web bundles.
- [ ] Account deletion removes the authenticated user, owner-scoped logo, synced records, local cache, outbox, conflicts, session, consent, and temporary artifacts.
- [ ] Published privacy/support pages exactly match production collection, retention, processors, and deletion behavior.
- [ ] App Store privacy answers match the final production binary and deployed services.

## Apple/TestFlight/App Review

- [ ] Active Apple Developer membership and agreements.
- [ ] App Store Connect app record and matching bundle ID `com.avinashamanchi.fieldcraft`.
- [ ] Production archive built with Xcode 26+ and iOS 26 SDK+ (requirement recheck observed 2026-08-06; recheck again on build day).
- [ ] Required-reason API/privacy manifest report passes for the archive.
- [ ] Export compliance and current age-rating questionnaire completed.
- [ ] App Privacy, support URL, privacy URL, description, keywords, review notes, and private review account completed.
- [ ] iPhone 6.9-inch and iPad 13-inch screenshot sets captured from the signed build and validated without alpha.
- [ ] TestFlight processing succeeds and physical-device matrix passes on that exact build.
- [ ] App Review submission succeeds.
- [ ] App status is actually `Ready for Distribution`/published in App Store Connect. An upload, processing email, or TestFlight build is not publication.

## Current stop condition

Local release engineering can continue without credentials. Deployment, signed-device native validation, TestFlight, and App Store submission stop until the user personally completes Supabase, Expo, and Apple account prompts. No credential should be pasted into chat, source, shell history, CI logs, or this checklist.
