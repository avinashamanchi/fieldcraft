# FieldCraft

Voice-first job management for tradespeople. Speak a job description → AI generates an invoice → saved and synced across all your devices.

**Live app:** https://avinashamanchi.github.io/fieldcraft

---

## What it does

- **Voice invoicing** — describe a job out loud, AI parses it into line items, labor, materials, and totals
- **Job tracking** — Scheduled → In Progress → Invoiced → Paid
- **Client management** — client profiles with full job history
- **Expense tracking** — log expenses with optional receipt photo scan
- **PDF invoices** — generate and download professional invoices
- **Cross-device sync** — Supabase cloud backend; sign in from any device and your data is there
- **Email verification** — secure signup with confirmed-email requirement

---

## Project structure

```
fieldcraft/
├── src/
│   ├── App.tsx                  # Root: auth state machine, route gating
│   ├── main.tsx                 # React entry point
│   ├── types/index.ts           # All TypeScript interfaces and types
│   ├── lib/
│   │   ├── supabase.ts          # Supabase client + auth callback handler (PKCE, token_hash, implicit)
│   │   ├── auth.ts              # signUp / signIn / signOut / resendVerification
│   │   ├── groq.ts              # AI: job parsing, expense categorization, message drafting
│   │   └── pdf.ts               # PDF invoice generation
│   ├── store/
│   │   └── useStore.ts          # Zustand store — all CRUD ops synced to Supabase
│   ├── pages/
│   │   ├── Landing.tsx          # Marketing landing page
│   │   ├── Login.tsx            # Email + password login
│   │   ├── Signup.tsx           # Account creation with password strength meter
│   │   ├── VerifyEmail.tsx      # Post-signup email verification screen
│   │   ├── Onboarding.tsx       # First-time setup (name, trade, rate)
│   │   ├── DemoTour.tsx         # Animated feature tour shown once after onboarding
│   │   ├── Dashboard.tsx        # Home screen: stats, recent jobs, quick actions
│   │   ├── VoiceInvoice.tsx     # Voice capture → AI parse → invoice review → save
│   │   ├── Jobs.tsx             # All jobs list with search + status filter
│   │   ├── JobDetail.tsx        # Individual job: P&L breakdown, invoice, expenses, message draft
│   │   ├── Clients.tsx          # Client list
│   │   ├── ClientDetail.tsx     # Client profile with job history
│   │   ├── Expenses.tsx         # Expense log with receipt scanning
│   │   └── Settings.tsx         # Profile, services catalog, inventory, account
│   └── components/
│       ├── ui/                  # Button, StatusBadge, TradeIcon, BottomNav, etc.
│       ├── voice/               # VoiceCapture (mic recording)
│       └── invoice/             # InvoiceReview (editable line items)
├── supabase/
│   └── schema.sql               # Full DB schema with RLS policies
├── scripts/
│   └── setup-supabase.py        # One-click Supabase provisioning script (runs in CI)
├── .github/workflows/
│   ├── deploy.yml               # Auto-deploy to GitHub Pages on push to main
│   └── setup-backend.yml        # One-click Supabase setup (workflow_dispatch)
├── vite.config.ts               # base: /fieldcraft/, outDir: docs
└── .env                         # Local env vars (gitignored — use placeholders)
```

---

## First-time backend setup (run once)

The app needs a free Supabase backend for auth and data storage. This takes about 3 minutes.

### Step 1 — Supabase account

Go to [supabase.com](https://supabase.com) → sign up (GitHub OAuth, one click).

### Step 2 — Supabase Personal Access Token

Supabase dashboard → avatar → **Account** → **Access Tokens** → **Generate new token** → copy it.

### Step 3 — Run the setup workflow

[GitHub Actions → Setup Supabase Backend](https://github.com/avinashamanchi/fieldcraft/actions/workflows/setup-backend.yml) → **Run workflow** → paste your Supabase token → **Run workflow**.

The workflow does everything automatically:
- Creates a Supabase project named "fieldcraft"
- Runs the full database schema with Row Level Security
- Configures auth redirect URLs to point to `https://avinashamanchi.github.io/fieldcraft/`
- Saves `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub secrets
- Triggers a site redeploy (~2 min)

After it completes, the app is fully live and accounts can be created.

---

## GitHub Secrets

| Secret | Set by | Description |
|--------|--------|-------------|
| `GH_PAT` | You (manually) | Classic GitHub PAT with `repo` scope — lets the setup workflow write other secrets |
| `VITE_SUPABASE_URL` | Setup workflow | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Setup workflow | Supabase anon public key |
| `VITE_GROQ_API_KEY` | You (manually) | Groq API key for all AI features |

### Setting `GH_PAT`

1. GitHub → Settings → Developer settings → **Personal access tokens (classic)**
2. Generate new token → select `repo` scope → copy
3. Repo → Settings → Secrets and variables → Actions → **New repository secret** → name: `GH_PAT`

### Setting `VITE_GROQ_API_KEY`

1. Get a free key at [console.groq.com](https://console.groq.com)
2. Repo → Settings → Secrets and variables → Actions → **New repository secret** → name: `VITE_GROQ_API_KEY`
3. Re-run the deploy workflow after adding it

---

## Running locally

```bash
# 1. Install dependencies
npm install

# 2. Create .env with your real values
#    (copy from Supabase dashboard and Groq console)
cat > .env << 'EOF'
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_GROQ_API_KEY=your-groq-key-here
EOF

# 3. Start dev server
npm run dev
# Opens at http://localhost:5173/fieldcraft/
```

---

## Deploying

### Automatic (normal workflow)

Any push to `main` triggers `deploy.yml` → builds → deploys to GitHub Pages. Nothing extra needed.

### Manual deploy

```bash
npm run build          # outputs to docs/ (served by GitHub Pages)
git add docs/
git commit -m "Build"
git push origin main   # triggers auto-deploy anyway
```

---

## Re-running the Supabase setup

If you need to reprovision (deleted the project, switched Supabase accounts, etc.):

1. [GitHub Actions → Setup Supabase Backend](https://github.com/avinashamanchi/fieldcraft/actions/workflows/setup-backend.yml)
2. **Run workflow** → paste a valid Supabase Personal Access Token → **Run workflow**

The script is idempotent — if "fieldcraft" project already exists it reuses it.

---

## Fixing email verification links going to localhost

This happens when the Supabase project's Site URL hasn't been set yet (setup workflow hasn't run, or ran before the fix).

**Option A — run the setup workflow** (above). It sets Site URL automatically.

**Option B — fix manually** in Supabase dashboard → your project → **Authentication** → **URL Configuration**:
- **Site URL:** `https://avinashamanchi.github.io/fieldcraft/`
- **Additional Redirect URLs:** `https://avinashamanchi.github.io/fieldcraft/*`

---

## Database schema

All tables have Row Level Security (RLS). Users can only access their own rows (`auth.uid() = user_id`).

| Table | Description |
|-------|-------------|
| `profiles` | User profile: name, business name, trade type, hourly rate, logo |
| `jobs` | Jobs with status, labor hours, invoice link, expense IDs |
| `invoices` | Invoice with line items (JSONB), subtotal, tax, total, payment status |
| `clients` | Client contacts |
| `expenses` | Expenses with optional job link and receipt image data |
| `services` | Reusable service templates shown during invoice creation |

To modify the schema: edit `supabase/schema.sql` and re-run the setup workflow, or run the SQL directly in the Supabase SQL editor (dashboard → SQL editor).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS v4 |
| Routing | React Router v7 (HashRouter — required for GitHub Pages) |
| State | Zustand (in-memory, loaded fresh from Supabase on login) |
| Backend/Auth | Supabase (PostgreSQL + GoTrue auth + Row Level Security) |
| AI | Groq API — llama-3.3-70b-versatile for parsing, Whisper for voice |
| PDF | html2canvas + jsPDF |
| Animations | Framer Motion |
| Deploy | GitHub Pages via GitHub Actions |

---

## Auth flow

```
App loads
  │
  ├─ Supabase not configured → SetupRequired screen (shows 3-step guide)
  │
  ├─ No session → Landing / Login / Signup pages
  │
  ├─ Session but email not verified → VerifyEmail screen
  │
  ├─ Verified but data not loaded → Loading spinner
  │
  ├─ Loaded but onboarding incomplete → Onboarding flow
  │
  ├─ Onboarded but hasn't seen demo → DemoTour (shown once)
  │
  └─ Fully authenticated → Full app (Dashboard, Jobs, Clients, Expenses, Settings, Voice)
```

Email verification callback is handled in `src/lib/supabase.ts → handleAuthCallback()`. It supports all three Supabase auth flows: PKCE (`?code=`), token_hash (`?token_hash=`), and implicit (`#access_token=`).

---

## Common commands

```bash
npm run dev          # local dev server
npm run build        # production build → docs/
npm run lint         # ESLint
npm run preview      # preview the built docs/ locally
```
