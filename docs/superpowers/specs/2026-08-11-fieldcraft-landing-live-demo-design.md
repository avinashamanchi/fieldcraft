# FieldCraft landing and live-demo design

**Date:** 2026-08-11
**Status:** Approved for implementation

## Product frame

- **Subject:** A field-work operating tool that turns a tradesperson's job notes into an invoice.
- **Audience:** Independent tradespeople and small contractors evaluating FieldCraft on a phone between jobs.
- **Single page job:** Show the voice-to-invoice workflow immediately, explain the privacy boundary, and make entering FieldCraft obvious.

## Scope

This redesign covers the unauthenticated landing and entry experience. It does not restyle authenticated screens, alter application behavior, add provider calls, or claim that unconfigured App Store products and integrations are available.

## Visual system

| Token | Value | Use |
| --- | --- | --- |
| Asphalt | `#111311` | Primary background and device shell |
| Work-order paper | `#F4F0E8` | High-contrast copy and invoice surface |
| Safety orange | `#FF672E` | Primary action and active demo state |
| Steel | `#80909A` | Secondary copy and dividers |
| Survey yellow | `#F2C94C` | Cautions and measured accents |

- **Display:** Barlow Condensed, with a compact system fallback.
- **Body:** Manrope, with a system sans-serif fallback.
- **Utility:** IBM Plex Mono, with a system monospace fallback.
- **Layout:** A disciplined split hero: work-order copy on the left and a phone-sized live workflow on the right. On narrow screens the demo follows the primary action.
- **Signature:** A spoken work note visibly resolves into categorized invoice rows and a ready-to-share total.

## Page structure

1. Sticky navigation: FieldCraft wordmark, Demo, How it works, Privacy, Support, Log in, and Try FieldCraft.
2. First viewport: direct headline, one-sentence value statement, primary action, and the complete live simulation.
3. Compact trust strip: local-first behavior, explicit AI consent, and offline manual entry.
4. Three-step voice-to-invoice explanation.
5. Focused capability grid limited to features present in the product.
6. Privacy and product-limits section with links to the public policies.
7. Final entry action and complete legal/support footer.

Unverified testimonials, user counts, unsupported integrations, and unavailable pricing promises must not appear.

## Live-demo behavior

The demo is deterministic and local. It never records audio, invokes AI, submits a form, or writes application data.

The state machine is:

`ready -> listening simulation -> structured invoice -> ready to share`

- Autoplay begins after the demo becomes visible.
- A visible control toggles pause and play; Replay returns to `ready`.
- Stage buttons allow direct inspection without waiting.
- The demo pauses outside the viewport and cleans up all timers on unmount.
- Reduced-motion users see the completed invoice immediately with animation disabled.
- Failure to initialize motion leaves a complete static invoice preview.
- Status text announces stage changes politely without reading decorative animation.

## Navigation and responsive behavior

- Anchor targets account for the sticky header.
- Keyboard focus is visible and follows DOM order.
- The compact mobile menu exposes the same destinations and reports expanded state.
- The phone simulation fits a 320 CSS-pixel viewport without horizontal scrolling.
- The main action remains visible before the first long scroll.

## Implementation boundary

The existing React/Vite application retains its routes. The landing page owns a focused demo component and small reusable navigation primitives. Demo state stays inside the landing surface and must not reuse authenticated stores or Supabase clients.

## Verification

Automated checks cover:

- stage order, pause, replay, direct stage selection, and timer cleanup;
- reduced-motion and off-screen behavior;
- no network, microphone, or persistent-storage access by the demo;
- working navigation landmarks, anchors, labels, and mobile-menu state;
- absence of unverified testimonials and unsupported availability claims;
- existing landing routes and authenticated entry routes remaining intact.

Visual checks cover desktop, tablet, 390-pixel iPhone, and 320-pixel narrow layouts, plus keyboard focus and a reduced-motion capture.

## Acceptance criteria

- The live voice-to-invoice story is visible in the first viewport.
- A new visitor can reach the demo, privacy, support, login, or signup without searching.
- The entry experience remains truthful when optional services are unavailable.
- Existing tests, type checking, lint, production build, and Pages deployment gates pass.
