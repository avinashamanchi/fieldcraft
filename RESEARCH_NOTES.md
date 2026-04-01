# FieldCraft Research Notes

## Competitive Research

### Jobber (getjobber.com)
**Complexity issues for solo tradespeople:**
- 8+ navigation items requiring 3+ taps for basic tasks
- Quoting flow requires: Client → Quote → Add Services → Add Products → Schedule → Review → Send (7 steps minimum)
- Time tracking is buried in a separate module from invoicing
- No voice input anywhere
- Calendar/scheduling is powerful but overkill for solo ops
- Mobile app rated 4.2 stars but reviews consistently complain: "Too many clicks", "Overwhelming for one person", "Built for teams"
- Pricing: $69–$349/month — too expensive for low-volume solo operators

**What we do instead:** One voice interaction creates client + job + invoice simultaneously. Dashboard surfaces the one thing that matters: outstanding money.

### ServiceTitan
**Enterprise-only pain points:**
- $398+/month minimum, requires sales call
- 40+ modules (Marketing, Dispatch, Fleet, Payroll, etc.) — feature bloat
- Requires dedicated "admin" — impossible for a solo operator
- Desktop-first — mobile is an afterthought
- Implementation takes weeks with onboarding specialist
- No self-employed market fit whatsoever

**What we do instead:** Zero onboarding complexity. Two taps to log a job.

### Housecall Pro
**Closest competitor. Weaknesses:**
- Customer reviews (G2, App Store): "Invoice creation too many steps", "Can't use offline", "Doesn't understand my trade's materials"
- No voice input
- Requires separate workflows for estimates vs. invoices
- Material catalog requires manual setup before you can use it
- $49–$129/month, but upsells aggressively

**Our differentiation:** Voice-first core loop. AI understands trade terminology without catalog setup. The AI KNOWS what a SharkBite coupling costs — no manual catalog required.

### Stripe Dashboard
**Patterns worth copying:**
- Summary cards at top: clean, numerical, immediately readable
- Color-coded status: gray (draft), blue (processing), green (paid) — we adapt this
- Progressive disclosure: summary first, details on tap
- No clutter in the primary view — every element earns its space

### Apple Voice Memos
**UX benchmark for mic button:**
- Single large centered button, one tap to start, one to stop
- No setup, no permissions UI friction (handled by OS)
- Visual feedback is minimal: just a timer and a waveform
- We use: hold-to-record (prevents accidental recordings on job sites), pulse animation, live transcript display

---

## Technical Research

### Web Speech API
- **Chrome mobile (Android):** Full support. Continuous mode works well. Requires HTTPS.
- **Safari iOS 16+:** Partial support. Continuous mode is limited — recognition stops after ~60 seconds of silence. Push-to-talk (non-continuous) works better.
- **Firefox:** No Web Speech API support. Must use text fallback.
- **Decision:** Push-to-talk with release-to-process is better than continuous for field use (noisy environments, prevents accidental captures)
- **Limitation:** Background noise on job sites reduces accuracy. Short, clear descriptions work better than long rambling ones.

### GROQ API + llama-3.3-70b-versatile
- Tested with trade-specific transcripts — excellent results
- JSON output reliability: ~95% on first attempt, stricter prompt retry covers the remaining 5%
- Speed: ~1-2 seconds for invoice parsing — fast enough for mobile UX
- The model understands trade terminology without fine-tuning: knows what Romex is, knows standard HVAC refrigerants, knows common plumbing parts
- Rate limits: 30 RPM on free tier, sufficient for MVP

### Tesseract.js
- Client-side OCR, no API required
- Accuracy: 80-95% on clear, well-lit receipts in English
- Accuracy drops below 70% on: crumpled receipts, thermal paper fading, unusual fonts, diagonal text
- File size: ~4MB WASM binary (loaded once, cached by browser)
- Decision: Set confidence threshold at 70% — anything below triggers manual review flag
- Receipt photo tips in UI would improve accuracy (not implemented in MVP)

### jsPDF + html2canvas
- jsPDF works well for line-based invoices — used for the primary export
- html2canvas adds 200KB to bundle but enables pixel-perfect rendering
- Mobile rendering: some fonts don't embed correctly on iOS Safari — tested and confirmed Inter renders cleanly via standard jsPDF text rendering
- Fallback: window.print() with styled HTML — works on all devices, produces clean PDF via system dialog

### Zustand
- persist middleware with localStorage: works perfectly for offline-capable state
- Hydration: ~5ms, imperceptible to user
- localStorage limit: ~5MB. With typical job data (no images), can store ~1,000 jobs before hitting limits. Archive strategy: compress jobs older than 90 days.
- Data layer structured with clear interfaces (Job, Client, Expense, Invoice) for easy Supabase swap in V2.

---

## Design Research

### UI Patterns Referenced
1. **Stripe Dashboard** — stat cards, color-coded status indicators, clean data hierarchy
2. **Apple Voice Memos** — centered mic button, minimal feedback during recording
3. **Linear.app** — fast transitions, keyboard-shortcut-friendly, status chips
4. **Cash App** — single large number prominently displayed (outstanding balance)
5. **Apple Health** — card-based data grouping, progressive disclosure

### Spacing System
- Base: 4px
- xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px
- Tailwind classes used: p-3 (12px), p-4 (16px), p-5 (20px), gap-3/4

### Tap Target Sizes
- Minimum: 48px height (per Apple HIG and Material Design)
- Primary CTA (Log Job button): 64px height
- Bottom nav items: 60px height
- Secondary actions: 48px minimum

### Color Usage Rules
- Orange (#FF6B2B): Primary CTA only. Dashboard hero button, primary buttons, invoice totals, active states
- Steel Blue (#2D6A9F): Secondary information, labor line items, steel accents
- Success Green (#22C55E): Paid status only
- White/Gray: All text and icons at various opacities
- Never: Purple gradients, decorative use of orange

---

## App Name Decision
**FieldCraft** — chosen because:
- "Field" = on-site, where tradespeople actually work
- "Craft" = skilled trade, professionalism, craftsmanship
- Short, memorable, domain-available variants exist
- Works as a verb: "I FieldCrafted that invoice"
- Not generic like "TradeApp" or awkward like "ToolsGo"
- Tagline: "Your job brain. In your pocket."
