import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import { Wrench, Mic, FileText, Users, BarChart3, Camera, Star, ChevronDown, CheckCircle, Zap, Shield, Smartphone, ArrowRight } from 'lucide-react'
import DemoAnimation from '../components/landing/DemoAnimation'

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  )
}

const FEATURES = [
  {
    icon: Mic,
    title: 'Voice-First Invoicing',
    description: 'Describe the job out loud on your drive home. FieldCraft turns plain English into a line-itemized professional invoice.',
    color: '#FF6B2B',
  },
  {
    icon: FileText,
    title: 'Instant PDF Export',
    description: 'One tap generates a professional PDF invoice with your business name, license, and tax calculations done automatically.',
    color: '#3A85C5',
  },
  {
    icon: Camera,
    title: 'Receipt OCR',
    description: 'Snap a photo of any receipt. AI reads it, categorizes it, and links it to the right job — no manual entry.',
    color: '#22C55E',
  },
  {
    icon: BarChart3,
    title: 'P&L Per Job',
    description: 'See your profit margin on every single job. Know which work makes you money and which is costing you.',
    color: '#A855F7',
  },
  {
    icon: Users,
    title: 'Client Management',
    description: "Every client's full history, total billed, and outstanding balance at a glance. Chase overdue invoices in seconds.",
    color: '#F59E0B',
  },
  {
    icon: Shield,
    title: 'Your Data, Your Device',
    description: 'All job data stays on your phone. No server-side storage. Nothing leaves your device without your say.',
    color: '#06B6D4',
  },
]

const TESTIMONIALS = [
  {
    name: 'Mike S.',
    role: 'Master Electrician',
    location: 'Chicago, IL',
    initials: 'MS',
    color: '#FF6B2B',
    quote: 'I used to spend 2 hours every night on paperwork. FieldCraft cut that to under 10 minutes. I just talk on the drive home and it\'s done.',
  },
  {
    name: 'Carlos R.',
    role: 'Licensed Plumber',
    location: 'Phoenix, AZ',
    initials: 'CR',
    color: '#3A85C5',
    quote: 'My invoices used to go out 3–4 days after a job. Now they go out same day. My payment cycle shortened by a full week.',
  },
  {
    name: 'T. Jackson',
    role: 'HVAC Contractor',
    location: 'Nashville, TN',
    initials: 'TJ',
    color: '#22C55E',
    quote: 'Finally an app that understands trade work. It knows what a refrigerant charge is, what an A-coil is. It just gets it.',
  },
]

const PRICING = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    description: 'For tradespeople just getting started',
    features: ['5 jobs per month', '3 clients', 'PDF invoice export', 'Basic expense tracking'],
    cta: 'Get Started Free',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For working tradespeople in the field',
    features: ['Unlimited jobs', 'Unlimited clients', 'Voice invoice (AI)', 'Receipt OCR scanning', 'P&L dashboard', 'Inventory tracking', 'AI message drafting'],
    cta: 'Start Pro Free Trial',
    highlight: true,
  },
  {
    name: 'Business',
    price: '$49',
    period: '/month',
    description: 'For contractors with crews to manage',
    features: ['Everything in Pro', 'Multi-user accounts', 'QuickBooks export', 'Priority support', 'Custom invoice branding', 'API access'],
    cta: 'Contact Sales',
    highlight: false,
  },
]

const FAQS = [
  {
    q: 'Does FieldCraft work offline?',
    a: 'Your job data is saved locally on your device so you can always view and edit. Voice-to-invoice needs a connection for AI processing — once processed, the invoice is stored offline.',
  },
  {
    q: 'Do I need to download an app?',
    a: 'No. FieldCraft runs entirely in your mobile browser. Visit the site and tap "Add to Home Screen" for a native app experience — no App Store needed.',
  },
  {
    q: 'Is my business data secure?',
    a: 'All job data stays on your device — we don\'t store it on our servers. Your AI requests are encrypted in transit. You control your data completely.',
  },
  {
    q: 'What trades does it support?',
    a: 'Plumbing, electrical, HVAC, carpentry, roofing, flooring, painting, and general contracting. The AI understands trade-specific terminology for all of these.',
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The Starter plan is free forever with no card required. Upgrade to Pro whenever you\'re ready for unlimited jobs and AI features.',
  },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Describe the job',
    description: 'Say what you did, who for, how long it took, and what parts you used. No form filling, no tapping through menus.',
    icon: Mic,
  },
  {
    step: '02',
    title: 'AI parses it instantly',
    description: 'FieldCraft\'s AI extracts the client name, trade type, labor hours, materials list, and calculates pricing automatically.',
    icon: Zap,
  },
  {
    step: '03',
    title: 'Send a professional invoice',
    description: 'Review, edit if needed, then export PDF or share direct. Clients get a clean, professional invoice fast — and pay faster.',
    icon: FileText,
  },
]

function AccordionItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer"
      >
        <span className="text-warm-white font-medium text-sm pr-4">{q}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={18} className="text-gray-500 flex-shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <p className="text-gray-400 text-sm leading-relaxed pb-5">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="bg-charcoal min-h-screen overflow-x-hidden">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-charcoal/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center">
              <Wrench size={15} className="text-white" />
            </div>
            <span className="text-warm-white font-bold text-lg">FieldCraft</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="text-gray-400 hover:text-warm-white text-sm font-medium transition-colors px-3 py-2 cursor-pointer"
            >
              Log In
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-16 pb-24 px-4 sm:px-6 overflow-hidden">
        {/* Background radial */}
        <div
          className="absolute top-0 right-0 w-2/3 h-full pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 80% 40%, rgba(255,107,43,0.08) 0%, transparent 60%)',
          }}
        />

        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div className="max-w-xl">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-3.5 py-1.5 mb-6"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                <span className="text-orange-400 text-xs font-semibold">Now in public beta — free to use</span>
              </motion.div>

              <motion.h1
                className="text-4xl sm:text-5xl lg:text-6xl font-black text-warm-white leading-none tracking-tight mb-5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.08 }}
              >
                Invoice in{' '}
                <span
                  className="relative inline-block"
                  style={{
                    background: 'linear-gradient(135deg, #FF6B2B 0%, #FF8450 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  30 seconds.
                </span>
                <br />
                Just describe the job.
              </motion.h1>

              <motion.p
                className="text-gray-400 text-lg leading-relaxed mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.16 }}
              >
                FieldCraft turns your job descriptions into professional invoices. Voice-first, AI-powered, built for plumbers, electricians, HVAC techs, and contractors in the field.
              </motion.p>

              <motion.div
                className="flex flex-col sm:flex-row gap-3 mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.22 }}
              >
                <button
                  onClick={() => navigate('/signup')}
                  className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-base px-7 py-4 rounded-2xl transition-all shadow-lg shadow-orange-500/20 cursor-pointer"
                >
                  Get Started Free
                  <ArrowRight size={18} />
                </button>
                <a
                  href="#how-it-works"
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-warm-white font-semibold text-base px-7 py-4 rounded-2xl border border-white/10 transition-colors"
                >
                  See How It Works
                </a>
              </motion.div>

              <motion.div
                className="flex flex-wrap gap-x-5 gap-y-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                {['Free to start', 'No credit card', 'Works on any phone'].map((item) => (
                  <div key={item} className="flex items-center gap-1.5">
                    <CheckCircle size={13} className="text-green-400" />
                    <span className="text-gray-500 text-xs">{item}</span>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Right: Demo animation */}
            <motion.div
              className="flex justify-center lg:justify-end"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <DemoAnimation />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="border-y border-white/5 py-6 px-4 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-10 text-center">
            <div>
              <p className="text-warm-white font-bold text-xl">2,400+</p>
              <p className="text-gray-500 text-xs">tradespeople</p>
            </div>
            <div className="hidden sm:block w-px h-8 bg-white/10" />
            <div>
              <p className="text-warm-white font-bold text-xl">$4.2M+</p>
              <p className="text-gray-500 text-xs">invoiced via FieldCraft</p>
            </div>
            <div className="hidden sm:block w-px h-8 bg-white/10" />
            <div>
              <p className="text-warm-white font-bold text-xl">30 sec</p>
              <p className="text-gray-500 text-xs">avg. invoice time</p>
            </div>
            <div className="hidden sm:block w-px h-8 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <div className="flex">
                {Array(5).fill(0).map((_, i) => (
                  <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                ))}
              </div>
              <span className="text-gray-500 text-xs">4.9/5 rating</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <p className="text-orange-400 text-xs font-bold tracking-widest uppercase mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-black text-warm-white mb-4">Three steps. That's it.</h2>
            <p className="text-gray-400 max-w-xl mx-auto">No onboarding training. No complex setup. Just describe the job and you're done.</p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon
              return (
                <FadeIn key={i} delay={i * 0.1}>
                  <div className="relative bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 hover:border-orange-500/20 transition-colors">
                    <div className="absolute -top-3 left-6">
                      <span className="bg-orange-500 text-white text-xs font-black px-2.5 py-1 rounded-lg">{step.step}</span>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center mb-4 mt-3">
                      <Icon size={18} className="text-orange-400" />
                    </div>
                    <h3 className="text-warm-white font-bold text-base mb-2">{step.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{step.description}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-24 px-4 sm:px-6 bg-white/[0.01]">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <p className="text-orange-400 text-xs font-bold tracking-widest uppercase mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-black text-warm-white mb-4">Everything a tradesperson needs.</h2>
            <p className="text-gray-400 max-w-xl mx-auto">Not a generic freelancer tool. Built specifically for tradespeople who work with their hands.</p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feat, i) => {
              const Icon = feat.icon
              return (
                <FadeIn key={i} delay={i * 0.07}>
                  <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors group">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                      style={{ backgroundColor: `${feat.color}15` }}
                    >
                      <Icon size={18} style={{ color: feat.color }} />
                    </div>
                    <h3 className="text-warm-white font-bold text-sm mb-2">{feat.title}</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">{feat.description}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>

          {/* Mobile highlight */}
          <FadeIn delay={0.2}>
            <div className="mt-8 bg-gradient-to-r from-orange-500/10 to-transparent border border-orange-500/15 rounded-2xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                <Smartphone size={22} className="text-orange-400" />
              </div>
              <div>
                <p className="text-warm-white font-bold text-sm">Works on your existing phone. No download required.</p>
                <p className="text-gray-400 text-xs mt-0.5">Open in Chrome or Safari, add to home screen. It works like a native app without the App Store.</p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <p className="text-orange-400 text-xs font-bold tracking-widest uppercase mb-3">From the Field</p>
            <h2 className="text-3xl sm:text-4xl font-black text-warm-white mb-4">Tradespeople love it.</h2>
            <p className="text-gray-400">Real results from real tradespeople using FieldCraft every day.</p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={i} delay={i * 0.1}>
                <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 flex flex-col gap-4">
                  <div className="flex">
                    {Array(5).fill(0).map((_, j) => (
                      <Star key={j} size={13} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed flex-1">"{t.quote}"</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: t.color }}
                    >
                      {t.initials}
                    </div>
                    <div>
                      <p className="text-warm-white text-sm font-semibold">{t.name}</p>
                      <p className="text-gray-500 text-xs">{t.role} · {t.location}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-24 px-4 sm:px-6 bg-white/[0.01]">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <p className="text-orange-400 text-xs font-bold tracking-widest uppercase mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-black text-warm-white mb-4">Simple, honest pricing.</h2>
            <p className="text-gray-400">No hidden fees. No upsell traps. Start free, upgrade when you're ready.</p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-4">
            {PRICING.map((plan, i) => (
              <FadeIn key={i} delay={i * 0.1}>
                <div
                  className={`relative rounded-2xl p-6 flex flex-col border ${
                    plan.highlight
                      ? 'bg-orange-500 border-orange-400 shadow-xl shadow-orange-500/20'
                      : 'bg-[#1E1E1E] border-white/5'
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-white text-orange-500 text-xs font-black px-3 py-1 rounded-full shadow">Most Popular</span>
                    </div>
                  )}

                  <div className="mb-6">
                    <p className={`text-xs font-bold tracking-wider uppercase mb-1 ${plan.highlight ? 'text-orange-100' : 'text-gray-500'}`}>
                      {plan.name}
                    </p>
                    <div className="flex items-end gap-1 mb-2">
                      <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : 'text-warm-white'}`}>{plan.price}</span>
                      <span className={`text-sm mb-1 ${plan.highlight ? 'text-orange-100' : 'text-gray-400'}`}>{plan.period}</span>
                    </div>
                    <p className={`text-xs ${plan.highlight ? 'text-orange-100' : 'text-gray-400'}`}>{plan.description}</p>
                  </div>

                  <ul className="space-y-2.5 flex-1 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle size={14} className={`flex-shrink-0 mt-0.5 ${plan.highlight ? 'text-white' : 'text-green-400'}`} />
                        <span className={`text-xs ${plan.highlight ? 'text-white' : 'text-gray-300'}`}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => navigate('/signup')}
                    className={`w-full py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                      plan.highlight
                        ? 'bg-white text-orange-500 hover:bg-orange-50 shadow'
                        : 'bg-white/5 text-warm-white hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <FadeIn className="text-center mb-12">
            <p className="text-orange-400 text-xs font-bold tracking-widest uppercase mb-3">FAQ</p>
            <h2 className="text-3xl sm:text-4xl font-black text-warm-white">Common questions.</h2>
          </FadeIn>

          <FadeIn>
            <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl px-6">
              {FAQS.map((faq, i) => (
                <AccordionItem key={i} q={faq.q} a={faq.a} />
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div
              className="relative rounded-3xl overflow-hidden p-10 sm:p-16 text-center border border-orange-500/20"
              style={{ background: 'linear-gradient(135deg, rgba(255,107,43,0.12) 0%, rgba(255,107,43,0.04) 100%)' }}
            >
              <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{ background: 'radial-gradient(ellipse at center top, rgba(255,107,43,0.2) 0%, transparent 60%)' }}
              />
              <div className="relative">
                <h2 className="text-3xl sm:text-4xl font-black text-warm-white mb-4">
                  Stop leaving money on the table.
                </h2>
                <p className="text-gray-400 mb-8 max-w-lg mx-auto">
                  Every day without a proper invoicing system is a day you're getting paid late. FieldCraft fixes that in 30 seconds.
                </p>
                <button
                  onClick={() => navigate('/signup')}
                  className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg px-8 py-4 rounded-2xl transition-all shadow-xl shadow-orange-500/25 cursor-pointer"
                >
                  Get Started Free — No Card Needed
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-12 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
                  <Wrench size={13} className="text-white" />
                </div>
                <span className="text-warm-white font-bold">FieldCraft</span>
              </div>
              <p className="text-gray-600 text-xs">Your job brain. In your pocket.</p>
              <p className="text-gray-700 text-xs mt-1">Built for the field. Made in America.</p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {['Features', 'Pricing', 'FAQ'].map((link) => (
                <a
                  key={link}
                  href={`#${link.toLowerCase()}`}
                  className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
                >
                  {link}
                </a>
              ))}
              <button
                onClick={() => navigate('/login')}
                className="text-gray-500 hover:text-gray-300 text-sm transition-colors cursor-pointer"
              >
                Log In
              </button>
              <button
                onClick={() => navigate('/signup')}
                className="text-orange-400 hover:text-orange-300 text-sm font-semibold transition-colors cursor-pointer"
              >
                Sign Up
              </button>
            </div>
          </div>

          <div className="border-t border-white/5 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-gray-700 text-xs">© {new Date().getFullYear()} FieldCraft. All rights reserved.</p>
            <div className="flex gap-4">
              {['Privacy Policy', 'Terms of Service'].map((link) => (
                <a key={link} href="#" className="text-gray-700 hover:text-gray-500 text-xs transition-colors">{link}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
