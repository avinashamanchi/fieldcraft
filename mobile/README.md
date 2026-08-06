# FieldCraft iOS

This directory contains the Expo SDK 54 / React Native iOS application. The bundle identifier is `com.avinashamanchi.fieldcraft`.

## Expo Go checkpoint

Use Node 22, install the locked dependencies, then start the LAN server:

```bash
npm ci
npx expo start --lan --clear
```

Expo Go can verify supported authentication/mock paths, quick local invoice entry, editable review/save, navigation, lists, offline cache behavior, settings/privacy, and supported PDF/share APIs. It cannot load FieldCraft's custom Apple Speech and Vision modules; the UI must show the typed/manual fallback instead of claiming those native features passed.

Do not record a checkpoint as passed until the user observes it on their own iPhone. A QR code, Metro start, or simulator render is not the checkpoint.

## Local gates

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run expo:doctor
npm run export:ios
npm audit --audit-level=high
```

The iOS export proves that Metro can produce the JavaScript/Hermes bundle. It does not compile Swift, validate entitlements, sign an archive, install on hardware, or prove App Store acceptance.

## Configuration

Only the public Supabase URL and publishable key may use `EXPO_PUBLIC_` configuration. The AI provider key, service-role key, and rate-limit HMAC secret must exist only in Supabase Edge Function secrets.

Never place Supabase service-role credentials, AI keys, Expo tokens, Apple credentials, review-account passwords, or signing files in this directory, `.env` files committed to Git, EAS local artifacts, CI logs, or release evidence.

## Signed development client gate

After the owner personally signs in to Expo/Apple and authorizes the provider-owned project, create and install a development build. On a physical iPhone verify:

- Apple Speech permission, recording, cancellation, backgrounding, two-minute limit, transcript editability, and raw-audio cleanup.
- Apple Vision camera/photo selection, local OCR, editable fields, cancellation/error cleanup, and no raw receipt upload.
- SecureStore session behavior, auth deep links, account deletion, PDF/share cleanup, offline/reconnect conflicts, 200% Dynamic Type, VoiceOver, Reduce Motion, icon, and splash.

Any compile, permission, data-loss, cleanup, privacy, or accessibility mismatch blocks production. Expo Go cannot satisfy this gate.

## Production stop

Do not run EAS production build or submission until every prior item in `../docs/app-store/fieldcraft-ios-release-checklist.md` is passed on the exact build. Upload, TestFlight availability, and App Review submission are not publication; confirm the final App Store Connect status separately.
