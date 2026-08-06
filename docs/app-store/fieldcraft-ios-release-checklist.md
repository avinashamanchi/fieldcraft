# FieldCraft iOS release checklist

Last updated: 2026-08-06. `PASS` means directly observed evidence. `BLOCKED` means credentials, provider state, hardware, or App Store Connect are still required. Blank boxes are not complete.

## Local implementation and CI

- [x] Verified implementation SHA: `2b51a4eff9814f91612159788e478ce3cd0da35c`.
- [x] Fresh no-hardlink clone was clean before and after verification, including native prebuild.
- [x] Root clean install, tests, typecheck, lint, web build, and redacted secret scan passed.
- [x] Mobile clean install, Jest, typecheck, lint, Expo Doctor, and iOS export passed.
- [x] Supabase migration boundary, PGlite, Deno format/lint/tests/check passed.
- [x] CI, deploy, release-readiness, and Maestro YAML parsed; release readiness is manual-only and has no deploy/submit command.
- [x] Root and mobile audits reported zero vulnerabilities at the verified SHA.
- [x] 1024×1024 opaque RGB icon validated and configured.

### Observed clean-clone evidence

| Gate | Observed result |
|---|---|
| Runtime | Node `v22.23.2`; workflows pin Node `22.22.0` |
| Root tests | 3 files, 19 tests passed |
| Mobile tests | 43 suites, 364 tests passed |
| Database | 27 PGlite checks passed |
| Edge | 9 files formatted/linted; 11 tests passed; both production entry points passed `deno check` |
| Expo | Doctor 18/18; iOS bundle exported from 1,699 modules; native iOS project prebuild passed without tracked changes |
| Security | Root and mobile npm audit: 0; tracked/bundle secret scan passed; exact icon: 1024×1024 PNG, RGB, no alpha |
| Workflows | Four YAML files parsed successfully; final clone had no tracked diff |

Observed non-fatal warnings: Vite reported a web chunk above 500 kB after minification; npm reported deprecated transitive test/build packages and install-script approval notices. These did not create audit findings. Full Xcode and CocoaPods are not installed on this Mac, so a Swift/Pods compile and signed archive were not run.

## iPhone and accessibility

- [ ] Expo Go checkpoint observed by the user: authentication/mock path, quick local invoice, review/save, navigation, lists, cached/offline behavior, settings, privacy, and supported PDF/share behavior.
- [ ] 200% Dynamic Type observed on a physical iPhone without lost controls or clipped required text.
- [ ] VoiceOver reading order, names, values, alerts, modal behavior, and focus restoration observed.
- [ ] Reduce Motion behavior observed.
- [x] Automated small-screen 320×568 and 200% font-scale release tests pass.
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
