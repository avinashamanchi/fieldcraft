# FieldCraft — Your job brain. In your pocket.

Voice-first AI job management for self-employed tradespeople. Speak a job description, get a professional invoice in seconds. Built for plumbers, electricians, HVAC techs, carpenters, and contractors.

## Quick Start (Local Dev)

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Build

```bash
npm run build
# Output to /docs (GitHub Pages compatible)
```

## Features

- **Voice-to-Invoice** — Hold the mic, describe the job. AI builds a line-item invoice.
- **Job Tracker** — Card-based view with status filtering, P&L per job.
- **Receipt OCR** — Snap a receipt, AI logs and categorizes the expense.
- **Client CRM** — Auto-created from voice jobs. Full financial history per client.
- **Profitability Estimator** — Live P&L with color-coded margin indicator.
- **AI Draft Message** — Tell the AI what you want to say, get a professional message.
- **Invoice PDF Export** — Clean jsPDF-generated invoice with your business info.
- **Parts Inventory** — Track stock levels with low-stock alerts.

## Tech Stack

React + TypeScript + Vite + Tailwind CSS v4 + Framer Motion + Zustand + GROQ AI (llama-3.3-70b-versatile) + Web Speech API + Tesseract.js + jsPDF

## Swapping the GROQ API Key

Edit `src/lib/groq.ts`:

```ts
const GROQ_API_KEY = 'your-key-here'
```

Get a free key at console.groq.com. For production, proxy AI calls through a backend to avoid exposing the key client-side.

## GitHub Pages Deployment

```bash
npm run build
git add .
git commit -m "Deploy"
git push origin main
# Enable Pages: Settings → Pages → /docs branch
```

## Known Limitations

- GROQ API key is client-side (acceptable for MVP/demo, use backend proxy in production)
- Data stored in localStorage only (no cloud sync)
- Web Speech API: Chrome/Edge best, Safari iOS limited, Firefox unsupported (falls back to text input)
- OCR accuracy 80-95% on clear receipts; low-confidence triggers manual review
- No payment processing (invoice approval is UI-only)

## V2 Priorities

Supabase backend + Stripe payment links + push notifications for overdue invoices + receipt photo storage + Quickbooks export
