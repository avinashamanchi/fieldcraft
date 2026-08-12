import { useNavigate } from 'react-router'
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  FileCheck2,
  FileText,
  LockKeyhole,
  Mic,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react'
import LiveInvoiceDemo from '../components/landing/LiveInvoiceDemo'

const LEGAL_BASE = 'https://avinashamanchi.github.io/fieldcraft'

const WORKFLOW = [
  {
    number: '01',
    title: 'Capture it your way',
    copy: 'Describe the finished job by voice when supported, or type the details yourself. The text path always remains available.',
    icon: Mic,
  },
  {
    number: '02',
    title: 'Shape the paperwork',
    copy: 'Organize the client, labor, and materials into an invoice draft. Optional AI actions run only after you choose them.',
    icon: Sparkles,
  },
  {
    number: '03',
    title: 'Review every line',
    copy: 'Correct the details, confirm the totals, and export only when the invoice reflects the work you actually completed.',
    icon: FileCheck2,
  },
]

const WORKSPACE = [
  {
    title: 'Jobs',
    copy: 'Keep job status, notes, and invoice totals connected.',
    icon: BriefcaseBusiness,
  },
  {
    title: 'Clients',
    copy: 'See each client alongside their job and billing history.',
    icon: Users,
  },
  {
    title: 'Invoices',
    copy: 'Build, review, and export clear client-ready PDFs.',
    icon: FileText,
  },
  {
    title: 'Expenses',
    copy: 'Record materials and costs against the right job.',
    icon: ReceiptText,
  },
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="fc-landing-shell">
      <nav className="fc-landing-nav" aria-label="Primary navigation">
        <a className="fc-brand" href="#top" aria-label="FieldCraft home">
          <span><Wrench size={17} aria-hidden="true" /></span>
          <strong>FieldCraft</strong>
          <small>FIELD OPS</small>
        </a>

        <div className="fc-nav-links">
          <a href="#demo">Demo</a>
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href={`${LEGAL_BASE}/support.html`}>Support</a>
        </div>

        <div className="fc-nav-actions">
          <button type="button" className="fc-nav-login" onClick={() => navigate('/login')}>Log in</button>
          <button type="button" className="fc-nav-start" onClick={() => navigate('/signup')}>Start</button>
        </div>
      </nav>

      <main id="top">
        <section className="fc-landing-hero" aria-labelledby="fieldcraft-heading">
          <div className="fc-hero-grid" aria-hidden="true" />
          <div className="fc-hero-copy">
            <p className="fc-kicker"><span /> Field notes → ready-to-review paperwork</p>
            <h1 id="fieldcraft-heading">Finish the job.<br /><em>Then finish the paperwork.</em></h1>
            <p className="fc-hero-lede">
              FieldCraft brings jobs, clients, invoices, and expenses into one focused workspace built for work that happens away from a desk.
            </p>
            <div className="fc-hero-actions">
              <button type="button" className="fc-primary-action" onClick={() => navigate('/signup')}>
                Try FieldCraft <ArrowRight size={17} aria-hidden="true" />
              </button>
              <a className="fc-secondary-action" href="#demo">Watch the walkthrough</a>
            </div>
            <p className="fc-demo-boundary"><ShieldCheck size={14} aria-hidden="true" /> Fixed sample—nothing is recorded, created, or sent.</p>
          </div>

          <div className="fc-hero-demo" id="demo">
            <LiveInvoiceDemo />
          </div>
        </section>

        <section className="fc-trust-rail" aria-label="Product boundaries">
          <div><span>01</span><strong>Local-first workflow</strong><p>Keep working through spotty service.</p></div>
          <div><span>02</span><strong>AI by choice</strong><p>Optional actions are clearly labeled.</p></div>
          <div><span>03</span><strong>Human reviewed</strong><p>You review the result before anything is shared.</p></div>
        </section>

        <section className="fc-workflow-section" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="fc-section-intro">
            <p className="fc-section-label">THE WORKFLOW</p>
            <h2 id="workflow-heading">From memory to invoice,<br />without the desk work.</h2>
            <p>FieldCraft keeps the process short while keeping you in control of the record.</p>
          </div>

          <div className="fc-workflow-grid">
            {WORKFLOW.map(({ number, title, copy, icon: Icon }) => (
              <article key={number}>
                <div className="fc-workflow-card-head"><span>{number}</span><Icon size={20} aria-hidden="true" /></div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fc-workspace-section" aria-labelledby="workspace-heading">
          <div className="fc-workspace-copy">
            <p className="fc-section-label">ONE WORKSPACE</p>
            <h2 id="workspace-heading">The job record stays connected.</h2>
            <p>Move from the work performed to the client record and the money around it without rebuilding the story in separate tools.</p>
            <ul>
              <li><Check size={14} aria-hidden="true" /> Manual entry stays available</li>
              <li><Check size={14} aria-hidden="true" /> Reviewable invoice totals</li>
              <li><Check size={14} aria-hidden="true" /> Exportable PDF invoices</li>
            </ul>
          </div>

          <div className="fc-workspace-grid">
            {WORKSPACE.map(({ title, copy, icon: Icon }) => (
              <article key={title}>
                <Icon size={21} aria-hidden="true" />
                <div><h3>{title}</h3><p>{copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="fc-privacy-section" id="privacy" aria-labelledby="privacy-heading">
          <div className="fc-privacy-mark"><LockKeyhole size={30} aria-hidden="true" /><span>CONTROL<br />MATTERS</span></div>
          <div className="fc-privacy-copy">
            <p className="fc-section-label">PRIVACY BOUNDARY</p>
            <h2 id="privacy-heading">Your business record should not be a black box.</h2>
            <p>
              FieldCraft separates the core workspace from optional AI processing. Manual input remains available, and sensitive actions require your intent—not a background surprise.
            </p>
            <div className="fc-legal-links">
              <a href={`${LEGAL_BASE}/privacy.html`}>Privacy Policy <ArrowRight size={14} aria-hidden="true" /></a>
              <a href={`${LEGAL_BASE}/terms.html`}>Terms of Use <ArrowRight size={14} aria-hidden="true" /></a>
              <a href={`${LEGAL_BASE}/support.html`}>Support <ArrowRight size={14} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className="fc-final-cta" aria-labelledby="cta-heading">
          <div>
            <p className="fc-section-label">READY FOR THE NEXT JOB</p>
            <h2 id="cta-heading">Less reconstructing.<br />More finishing.</h2>
          </div>
          <button type="button" onClick={() => navigate('/signup')}>Create your workspace <ArrowRight size={17} aria-hidden="true" /></button>
        </section>
      </main>

      <footer className="fc-landing-footer">
        <a className="fc-brand" href="#top" aria-label="FieldCraft home">
          <span><Wrench size={15} aria-hidden="true" /></span><strong>FieldCraft</strong>
        </a>
        <p>Purpose-built job records for independent field work.</p>
        <div>
          <a href={`${LEGAL_BASE}/privacy.html`}>Privacy Policy</a>
          <a href={`${LEGAL_BASE}/terms.html`}>Terms of Use</a>
          <a href={`${LEGAL_BASE}/support.html`}>Support</a>
        </div>
      </footer>
    </div>
  )
}
