# FieldCraft iOS screenshot matrix

Official Apple screenshot specifications rechecked 2026-08-11. App Store Connect requires at least one screenshot and accepts up to ten for the required iPhone display set, in PNG/JPEG without alpha.

## Required device set for the first iPhone-only build

| Set | Accepted portrait pixels | Status | Required scenes |
|---|---:|---|---|
| iPhone 6.9-inch | 1260×2736, 1290×2796, or 1320×2868 | Not captured | Dashboard; estimate-to-job; invoice/payment history; reminders/payment link; offline recovery; privacy/export controls |

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
2. `Estimate. Schedule. Get the job done.` — A synthetic estimate and its explicit conversion path.
3. `Know what is paid—and what is not` — Invoice total, partial payment, refund/dispute provenance, and balance.
4. `Share a secure way to pay` — Provider-hosted payment-link controls with honest pending confirmation; never promise Apple Pay.
5. `Reminders you control` — Consent state, due occurrence, and disable control using fictional customer data.
6. `Keep working offline` — Paged jobs plus explicit queued/current/conflict states.
7. `Export or delete on your terms` — Export, privacy links, sync diagnostics, local deletion, and account deletion.

Every final image remains blocked until it is captured from the signed build and visually reviewed at exact pixel dimensions.

Keep each overlay to one short benefit in plain customer language. At App Store thumbnail size, the headline and real product screen must remain understandable without reading the long description.
