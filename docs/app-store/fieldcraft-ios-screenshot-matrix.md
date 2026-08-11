# FieldCraft iOS screenshot matrix

Official Apple screenshot specifications rechecked 2026-08-09. App Store Connect accepts 1–10 screenshots per device size, in PNG/JPEG without alpha.

## Required device set for the first iPhone-only build

| Set | Accepted portrait pixels | Status | Required scenes |
|---|---:|---|---|
| iPhone 6.9-inch | 1260×2736, 1290×2796, or 1320×2868 | Not captured | Dashboard; local job entry; invoice review; jobs/offline state; privacy controls |

If iPhone 6.9-inch images are not supplied, Apple currently requires the 6.5-inch set (1284×2778 or 1242×2688). FieldCraft will supply 6.9-inch rather than rely on scaling. The first release sets `supportsTablet` to false because an iPad layout and physical-device matrix have not been validated. iPad support can be enabled in a later tested version.

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

Keep each overlay to one short benefit in plain customer language. At App Store thumbnail size, the headline and real product screen must remain understandable without reading the long description.
