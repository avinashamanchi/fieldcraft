# FieldCraft iOS release checklist

Last updated: 2026-08-10. `PASS` means directly observed evidence for the current scoped candidate. `BLOCKED` means credentials, provider state, hardware, a missing local tool, or App Store Connect are still required. Blank boxes are not complete.

## Local implementation and CI

- [x] The current `origin/main` implementation baseline at `273e94e` was verified in a clean finalization worktree; this evidence refresh does not infer an upload or submission.
- [x] Root tests, typecheck, lint, web build, and redacted secret scan passed under Node 22.
- [x] Mobile Jest, typecheck, lint, Expo Doctor, and iOS export passed under Node 22.
- [x] Supabase migration boundary and 42 PGlite database checks passed; the mobile suite includes a real SQLite grammar test for every migration.
- [x] Deno 2.9.5 format and lint checked all 12 Edge files; 20 Edge tests passed and every discovered function entrypoint passed `deno check`.
- [x] CI, deploy, release-readiness, and Maestro YAML parsed; release readiness is manual-only and has no deploy/submit command.
- [x] Root production dependency audit reported zero vulnerabilities.
- [x] Mobile CI fails closed on any high/critical advisory except the two explicitly reviewed `image-size` parser advisories (GitHub sources `1138808` and `1138809`) through Expo/Metro. The 2026-08-09 report has 12 transitive findings; npm proposes only breaking Expo/React Native downgrades, so the gate records the exception instead of forcing that remediation.
- [x] 1024×1024 opaque RGB icon validated and configured.
- [x] First release is explicitly iPhone-only; the unverified iPad target and 13-inch screenshot obligation were removed from the v1 configuration.
- [x] Authentication is email/password only; no third-party or social login is offered, and the iOS config explicitly declares that Sign in with Apple is not used.
- [x] Production EAS profile uses store distribution, the SDK-selected Xcode image, remote build-number auto-increment, and contains no submission credentials.
- [x] Production builds fail closed without a RevenueCat Apple public SDK key; FieldCraft Pro uses the exact monthly/annual products and StoreKit-localized prices, provides restore/manage controls, and never grants Pro in Expo Go.
- [x] The paywall and in-app legal screen expose separate Privacy Policy, Terms of Use, Support, Apple subscription-management, and official Apple purchase/refund-help controls. Public drafts disclose Apple/RevenueCat purchase processing, Free limits, renewal/cancellation, downgrade behavior, and that account deletion does not cancel an Apple subscription.
- [x] `apple-review-guideline-applicability.md` records every Apple Safety, Performance, Business, Design, and Legal family as implemented, externally gated, or not applicable; absent UGC, Kids, gambling, VPN, MDM, social login, Apple Pay, and downloaded-code features cannot be silently added after review.
- [x] Delete Account checks the recent-authenticator guard before any destructive request, routes to the delete-account step-up screen, and offers authenticator setup when no verified factor exists; the server independently enforces recent AAL2.
- [x] A production-only Expo config plugin strips development Bonjour/local-network discovery declarations, disables arbitrary ATS loads, and removes localhost transport exceptions from the generated release Info.plist.

### Observed clean-clone evidence

| Gate | Observed result |
|---|---|
| Runtime | Node `22.23.2` used for the fresh local gates; workflows retain their pinned Node 22 runner |
| Root tests | 3 files, 23 tests passed |
| Mobile tests | 50 suites, 583 tests passed |
| Database | Migration boundary and 42 PGlite checks passed; Node's real SQLite parser accepted the complete mobile migration chain |
| Edge | Deno 2.9.5 format/lint checked 12 files; 20 tests passed; the dynamic entrypoint set passed `deno check` |
| Expo | Doctor 18/18; the exact checkout exported a 7.3 MB Hermes iOS bundle. A production prebuild with sanitized public test values contained no Bonjour/local-network declarations, arbitrary ATS loads, or localhost transport exception |
| Security | Root production audit: 0; the strict mobile gate accepted only the 12 transitive Expo/Metro findings rooted in the two reviewed advisories and rejects any new high/critical advisory; tracked/export secret scan passed; exact icon: 1024×1024 PNG, RGB, no alpha |
| Workflows | Release-readiness remains manual-only and has no deploy/submit command; YAML parse is part of the final scoped snapshot gate |

Observed warnings/limitations: Vite reported a web chunk above 500 kB after minification; Node labels its built-in SQLite API experimental; the mobile audit risk is recorded above. CocoaPods 1.17.0 is installed, but the selected developer directory is Command Line Tools and no usable full Xcode archive proof exists, so a Swift/Pods compile and signed archive were not run.

## iPhone and accessibility

- [x] Expo Go launch and dashboard were observed by the user after the real SQLite migration parser defect was corrected on 2026-08-07.
- [ ] Quick local invoice, review/save, navigation, lists, cached/offline behavior, settings, privacy, and supported PDF/share behavior on a physical iPhone.
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
- [x] Anonymous checks on 2026-08-10 returned HTTPS 200 for Privacy, Terms, and Support, and every response was byte-for-byte identical to its tracked `public/` release file.
- [ ] Reconcile those published pages once more against the final deployed Supabase functions, provider retention settings, deletion behavior, and product limits immediately before submission.
- [ ] App Store privacy answers match the final production binary and deployed services.
- [ ] RevenueCat App Store app, `FieldCraft Pro` subscription group, exact products, `pro` entitlement, `default` offering, webhook secret, and restore-transfer behavior are configured and directly verified.
- [ ] Reviewer account stays active for the entire review window, uses synthetic data, reaches all account-based features, and has exact onboarding/MFA/recovery instructions in App Review Information.

## Apple/TestFlight/App Review

- [ ] Active Apple Developer membership and agreements.
- [ ] Paid Apps agreement, tax, and banking setup completed for subscriptions.
- [ ] If enrolling as an organization, its D-U-N-S record is validated. D-U-N-S is not an individual-enrollment requirement.
- [ ] App Store Connect app record and matching bundle ID `com.avinashamanchi.fieldcraft`.
- [ ] Production archive built with Xcode 26+ and iOS 26 SDK+ (requirement recheck observed 2026-08-06; recheck again on build day).
- [ ] Required-reason API/privacy manifest report passes for the archive.
- [ ] Export compliance and Apple's updated age-rating questionnaire completed for the exact submitted version.
- [ ] App Privacy including Purchase History, support URL, privacy URL, Terms of Use, description, keywords, review notes, and private review account completed.
- [ ] Accessibility Nutrition Label answers are based on the signed-device VoiceOver, Voice Control, Larger Text, contrast, and Reduce Motion results above; no unverified support is claimed.
- [ ] Product page name, icon, subtitle, description, promotional text, keywords, and 1–10 screenshots are complete, accurate, localized where offered, and contain no placeholder or private data.
- [ ] Required device capabilities and every generated Info.plist usage description match the exact archive and are exercised on a current iOS 26 device.
- [ ] Mac with Apple silicon and Apple Vision Pro availability are explicitly disabled for v1 unless the exact signed iPhone build is separately tested and supported there.
- [ ] Primary language, SKU, seller/copyright, categories, content rights, storefront availability, and Digital Services Act status completed by the account holder.
- [ ] Monthly and annual subscription localizations, durations, price points, availability, review details, and review screenshots completed.
- [ ] Optional offer codes, win-back offers, promoted IAP, Family Sharing, and alternative digital payments remain disabled unless their separate configuration and signed tests are complete.
- [ ] Review Notes explicitly distinguish Apple-IAP digital Pro capacity from customer invoice/payment records for real-world trade services.
- [ ] iPhone 6.9-inch screenshot set captured from the signed build and validated without alpha.
- [ ] TestFlight processing succeeds and physical-device matrix passes on that exact build.
- [ ] App Review submission succeeds.
- [ ] App status is actually `Ready for Distribution`/published in App Store Connect. An upload, processing email, or TestFlight build is not publication.

## Current stop condition

All repository-controlled no-deploy gates listed above are complete. EAS reported `Not logged in` on 2026-08-10, Supabase CLI has no authorized project session, and this Mac has Command Line Tools rather than full Xcode (CocoaPods 1.17.0 alone is insufficient). Provider deployment, signed-device native validation, sandbox purchases, TestFlight, and App Store submission stop at authorized Supabase, RevenueCat, Expo, Apple, and hardware prompts. No credential should be pasted into chat, source, shell history, CI logs, or this checklist.
