# FieldCraft Build Log

## Phase 1: Foundation & Design System — 2026-03-31T00:00:00Z
- Set up Vite + React + TypeScript + Tailwind CSS v4 project
- Created custom Tailwind theme: charcoal (#1A1A1A), warm-white (#F5F0EB), orange-500 (#FF6B2B), steel (#2D6A9F)
- Built design system: Button (4 variants), Card, StatusBadge, BottomNav, EmptyState, SkeletonCard, TradeIcon
- Set up Zustand store with localStorage persistence (persist middleware)
- Pre-populated with 3 demo jobs, 3 clients, 4 expenses, 3 invoices, 8 inventory items
- Routing structure: Dashboard, Jobs, JobDetail, Clients, ClientDetail, Expenses, Settings, VoiceInvoice, Onboarding
- Decisions: HashRouter for GitHub Pages compatibility (no server-side routing); @tailwindcss/vite plugin for v4

## Phase 2: Voice-to-Invoice — 2026-03-31T00:15:00Z
- Built VoiceCapture component: push-to-talk interaction, Framer Motion pulse rings, live transcript display
- Web Speech API: continuous recognition, interim results, accumulation across multiple holds
- Graceful fallback to text input if Speech API unavailable or permission denied
- GROQ API (llama-3.3-70b-versatile) with engineered system prompt for JSON extraction
- Zod validation on AI response, retry with stricter prompt on validation failure
- InvoiceReview: fully editable line items, real-time recalculation, add/remove items
- PDF export via jsPDF with professional layout, printable HTML fallback
- Tested with plumbing, electrical, HVAC, carpentry, general contractor descriptions

## Phase 3: Job Tracker Dashboard — 2026-03-31T00:45:00Z
- Dashboard with stat cards (Outstanding, Jobs This Month, Month's Profit) in horizontal scroll
- Hero CTA button (Log a Job) prominent at top — orange, hard to miss
- Job list with trade icons, status badges, relative timestamps, value display
- Overdue invoice banner (30+ days) prominently displayed
- Job detail: full P&L view, profitability bar chart, invoice line items, expense summary
- Status progression: Scheduled → In Progress → Invoiced → Paid with one-tap advancement
- Draft Message feature (AI, 3 tones) in job detail view

## Phase 4: Receipt Photo → Expense Log — 2026-03-31T01:15:00Z
- Camera/upload button opens device file picker with capture="environment"
- Tesseract.js OCR with animated progress bar ("Reading receipt...")
- GROQ AI categorization after OCR (Materials/Fuel/Equipment/Subcontractor/Other)
- Manual review flag when OCR confidence < 70% or amount = 0
- Bottom-sheet modal for UX — feels native on mobile
- Expenses grouped by job in scrollable log with category icons

## Phase 5: Client CRM — 2026-03-31T01:45:00Z
- Searchable client list with avatar initials, total billed, outstanding balance
- Client detail: contact info, job history, financial totals, New Job button
- Draft Message from client profile (AI, 3 tones, copy to clipboard)
- Clients auto-created when jobs are logged via voice

## Phase 6: Profitability Estimator — 2026-03-31T02:15:00Z
- P&L calculation: Invoice Total − Expenses − Labor Cost = Est. Profit
- Color-coded margin bar: green (>30%), yellow (15-30%), red (<15%)
- Animated bar visualization with Framer Motion
- Month's Profit stat card on dashboard

## Phase 7: Polish & Inventory — 2026-03-31T02:30:00Z
- Parts inventory tracker in Settings with +/− quantity controls, low-stock alerts
- Onboarding flow (2 steps): profile setup + guided first job
- Favicon (custom SVG wrench/bolt in orange)
- Loading skeleton for dashboard
- OG meta tags in index.html
- Error states: API failure, voice not supported, OCR failure

## Phase 8: Build & Deploy — 2026-03-31T02:45:00Z
- vite build → output to /docs (GitHub Pages compatible)
- HashRouter used for GitHub Pages (no 404 on refresh)
- Build succeeds, all TypeScript errors resolved
- Known limitations documented in final message
