# FieldCraft iOS screenshot matrix

Official Apple screenshot specifications rechecked 2026-08-06. App Store Connect accepts 1–10 screenshots per device size, in PNG/JPEG without alpha.

## Required device sets for the current universal build

| Set | Accepted portrait pixels | Status | Required scenes |
|---|---:|---|---|
| iPhone 6.9-inch | 1260×2736, 1290×2796, or 1320×2868 | Not captured | Dashboard; local job entry; invoice review; jobs/offline state; privacy controls |
| iPad 13-inch | 2064×2752 or 2048×2732 | Not captured | Dashboard; local job entry; invoice review; jobs/offline state; privacy controls |

If iPhone 6.9-inch images are not supplied, Apple currently requires the 6.5-inch set (1284×2778 or 1242×2688). FieldCraft will supply 6.9-inch rather than rely on scaling. Because `supportsTablet` is true, the 13-inch iPad set is required.

## Capture rules

- Capture only the signed production-equivalent build with synthetic business records and no real customer data.
- Keep the same orientation and accepted pixel size across each localized device set.
- Do not show Expo Go chrome, development menus, status errors, provider credentials, tokens, email addresses, or private notifications.
- Do not imply guaranteed revenue, automatic delivery, accounting accuracy, or AI certainty in overlays.
- Show offline/pending labels truthfully; do not label pending records as cloud-synced.
- Use the final opaque icon and production app name.
- Check text at normal and large Dynamic Type before capture; store screenshots themselves use the normal release presentation.

## Scene copy draft

1. `Your field work, organized` — Dashboard with synthetic metrics and visible sync state.
2. `Draft locally. Review every detail.` — Quick local note and editable invoice fields.
3. `Invoices that stay under your control` — Review screen with local calculations and terms.
4. `Keep working offline` — Jobs list with explicit pending/current states.
5. `Privacy choices in the app` — AI consent, sync diagnostics, deletion, and policy links.

Every final image remains blocked until it is captured from the signed build and visually reviewed at exact pixel dimensions.
