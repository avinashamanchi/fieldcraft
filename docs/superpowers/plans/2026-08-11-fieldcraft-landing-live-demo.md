# FieldCraft Landing Live Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FieldCraft public entry surface with a concise, navigable, first-viewport voice-to-invoice simulation while preserving all authenticated routes.

**Architecture:** Keep demo state local to a new landing component and model stage transitions in a pure module. Recompose `Landing.tsx` around semantic anchors and the existing route callbacks; use existing React, Framer Motion, Tailwind utilities, and scoped CSS without touching authenticated stores.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Framer Motion, Tailwind CSS, React Router

## Global Constraints

- Demo stages are exactly `ready`, `listening`, `invoice`, and `share`.
- The demo makes no network, microphone, Supabase, or persistent-storage calls.
- Reduced motion renders the completed `share` stage without autoplay.
- Public claims must describe present behavior; omit unverified testimonials, counts, integrations, and unavailable tiers.
- Preserve `/login`, `/signup`, privacy, terms, support, and every authenticated route.

---

### Task 1: Deterministic demo controller

**Files:**
- Create: `src/components/landing/liveDemoMachine.ts`
- Create: `src/components/landing/liveDemoMachine.test.ts`

**Interfaces:**
- Produces: `DemoStage`, `DEMO_STAGES`, `nextDemoStage(stage)`, and `initialDemoStage(reducedMotion)`.

- [ ] **Step 1: Write the failing pure-state tests**

```ts
expect(DEMO_STAGES).toEqual(['ready', 'listening', 'invoice', 'share'])
expect(nextDemoStage('share')).toBe('ready')
expect(initialDemoStage(true)).toBe('share')
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `npm test -- src/components/landing/liveDemoMachine.test.ts`
Expected: FAIL because `liveDemoMachine.ts` does not exist.

- [ ] **Step 3: Implement the immutable stage helpers**

```ts
export const DEMO_STAGES = ['ready', 'listening', 'invoice', 'share'] as const
export type DemoStage = (typeof DEMO_STAGES)[number]
export const nextDemoStage = (stage: DemoStage): DemoStage =>
  DEMO_STAGES[(DEMO_STAGES.indexOf(stage) + 1) % DEMO_STAGES.length]
export const initialDemoStage = (reducedMotion: boolean): DemoStage => reducedMotion ? 'share' : 'ready'
```

- [ ] **Step 4: Run the focused test and commit the green state module**

Run: `npm test -- src/components/landing/liveDemoMachine.test.ts`
Expected: PASS.

### Task 2: First-viewport live invoice component

**Files:**
- Create: `src/components/landing/LiveInvoiceDemo.tsx`
- Create: `src/components/landing/LiveInvoiceDemo.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: the Task 1 stage helpers.
- Produces: `<LiveInvoiceDemo />` with Pause/Play, Replay, and four stage buttons.

- [ ] **Step 1: Write failing behavior tests**

```tsx
render(<LiveInvoiceDemo />)
expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /pause demo/i })).toBeInTheDocument()
expect(global.fetch).not.toHaveBeenCalled()
```

Add fake-timer checks proving Pause blocks advancement, Replay selects `ready`, stage controls select directly, unmount clears timers, and reduced motion starts at `share`.

- [ ] **Step 2: Run the focused component test and verify RED**

Run: `npm test -- src/components/landing/LiveInvoiceDemo.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Build the isolated component**

Use an `IntersectionObserver` visibility flag, one timeout for stage advancement, `matchMedia('(prefers-reduced-motion: reduce)')`, and semantic status text. Render fixed sample content: Miller residence, labor, faucet, valves, total, and ready-to-share state.

- [ ] **Step 4: Add scoped visual treatment and pass the component tests**

Run: `npm test -- src/components/landing/LiveInvoiceDemo.test.tsx`
Expected: PASS with no open timers and no network calls.

### Task 3: Recompose the public landing entry

**Files:**
- Modify: `src/pages/Landing.tsx`
- Create: `src/pages/Landing.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `<LiveInvoiceDemo />`, `useNavigate()`.
- Preserves: login and signup navigation.

- [ ] **Step 1: Write failing landing-contract tests**

Assert navigation landmarks and links for Demo, How it works, Privacy, Support, Log in, and Try FieldCraft; assert unsupported Business/QuickBooks/API copy and testimonial names are absent.

- [ ] **Step 2: Run the focused landing test and verify RED**

Run: `npm test -- src/pages/Landing.test.tsx`
Expected: FAIL against the old long-form landing page.

- [ ] **Step 3: Implement the approved six-section composition**

Use IDs `demo`, `how-it-works`, and `privacy`; position the live demo in the hero; add a compact accessible mobile menu; retain direct policy URLs and router actions.

- [ ] **Step 4: Run landing tests, then the complete web verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all commands PASS.

### Task 4: Responsive and release verification

**Files:**
- Modify only if a verified defect is found: `src/pages/Landing.tsx`, `src/components/landing/LiveInvoiceDemo.tsx`, `src/index.css`

- [ ] **Step 1: Capture desktop, tablet, 390-pixel, and 320-pixel screenshots**

Run the Vite preview and use a browser at widths 1440, 834, 390, and 320. Confirm no horizontal overflow and that the demo follows the CTA on mobile.

- [ ] **Step 2: Verify keyboard, reduced-motion, and static fallback behavior**

Tab through navigation and controls, emulate reduced motion, and disable animation initialization. Expected: visible focus, completed static invoice, working route actions.

- [ ] **Step 3: Run repository security/release gates and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run scan:secrets`
Expected: PASS without changing authenticated application behavior.
