import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Mic, Users, Receipt, Settings,
  DollarSign, TrendingUp, Briefcase, ChevronRight,
  Camera, CheckCircle2, Loader2, FileText, Star, Package, Plus,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import DemoAnimation from '../components/landing/DemoAnimation'

// ─── Shared mini phone frame ───────────────────────────────────────────────
function MiniPhone({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto" style={{ width: 240, height: 460 }}>
      <div
        className="absolute inset-0 rounded-[2rem] blur-xl opacity-20"
        style={{ background: 'radial-gradient(ellipse at center, #FF6B2B 0%, transparent 70%)', transform: 'scale(1.1)' }}
      />
      <div
        className="relative w-full h-full rounded-[2rem] overflow-hidden border border-white/15 shadow-2xl flex flex-col"
        style={{ background: 'linear-gradient(160deg, #1e1e1e 0%, #111 100%)' }}
      >
        <div className="absolute left-0 top-16 w-0.5 h-6 rounded-r bg-white/10" />
        <div className="absolute right-0 top-20 w-0.5 h-8 rounded-l bg-white/10" />
        <div className="flex items-center justify-between px-5 pt-2.5 pb-1 flex-shrink-0">
          <span className="text-white text-[10px] font-semibold">9:41</span>
          <div className="w-10 h-3 bg-black rounded-full" />
          <div className="flex items-center gap-0.5">
            {[2, 4, 6, 8].map((h, i) => (
              <div key={i} className="w-0.5 bg-white/50 rounded-sm" style={{ height: h }} />
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-1.5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md bg-[#FF6B2B] flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
            </div>
            <span className="text-white text-[11px] font-bold">FieldCraft</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
        <div className="h-4 flex items-center justify-center flex-shrink-0">
          <div className="w-16 h-0.5 bg-white/15 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard animation ──────────────────────────────────────────────────
function DashboardAnim() {
  const [phase, setPhase] = useState(0)
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise<void>((r) => { const id = setTimeout(() => { if (!cancelled) r() }, ms); return id })

    async function run() {
      setPhase(0); setCount(0)
      await wait(600)
      if (cancelled) return
      setPhase(1)
      // Count up
      for (let i = 0; i <= 40; i++) {
        await wait(30)
        if (cancelled) return
        setCount(i)
      }
      await wait(400); if (cancelled) return; setPhase(2)
      await wait(500); if (cancelled) return; setPhase(3)
      await wait(500); if (cancelled) return; setPhase(4)
      await wait(2500); if (cancelled) return
      setTick((t) => t + 1)
    }
    run()
    return () => { cancelled = true }
  }, [tick])

  const stats = [
    { label: 'Outstanding', value: `$${(count * 32).toLocaleString()}`, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { label: 'Jobs / Mo.', value: String(Math.min(count, 7)), color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: "Profit", value: `$${(count * 21).toLocaleString()}`, color: 'text-green-400', bg: 'bg-green-500/10' },
  ]

  const jobs = [
    { name: 'Full Detail — Smith', amount: '$150', status: 'Paid', color: 'text-green-400' },
    { name: 'Paint Correction — Lee', amount: '$280', status: 'Sent', color: 'text-orange-400' },
  ]

  return (
    <div className="p-3 space-y-2.5 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white text-xs font-bold">Dashboard</p>
          <p className="text-white/30 text-[9px]">Tuesday, April 1</p>
        </div>
        <motion.div
          className="text-[9px] bg-orange-500 text-white px-2 py-0.5 rounded-full font-bold"
          animate={{ scale: phase >= 1 ? [1, 1.05, 1] : 1 }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >Log Job</motion.div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-1.5">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            className="bg-white/5 border border-white/5 rounded-lg p-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: phase >= i + 1 ? 1 : 0, y: phase >= i + 1 ? 0 : 8 }}
            transition={{ duration: 0.3 }}
          >
            <p className={`text-sm font-black ${s.color}`}>{s.value}</p>
            <p className="text-white/30 text-[8px] mt-0.5">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Recent jobs */}
      <div className="flex-1 space-y-1.5">
        <p className="text-white/40 text-[9px] font-semibold uppercase tracking-wider">Recent Jobs</p>
        {jobs.map((j, i) => (
          <motion.div
            key={j.name}
            className="bg-white/5 border border-white/5 rounded-lg p-2 flex items-center justify-between"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: phase >= 4 ? 1 : 0, x: phase >= 4 ? 0 : -10 }}
            transition={{ duration: 0.3, delay: i * 0.15 }}
          >
            <div>
              <p className="text-white text-[10px] font-medium">{j.name}</p>
              <p className={`text-[9px] ${j.color}`}>{j.status}</p>
            </div>
            <p className="text-white text-[10px] font-bold">{j.amount}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── Clients animation ────────────────────────────────────────────────────
function ClientsAnim() {
  const [visible, setVisible] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise<void>((r) => { const id = setTimeout(() => { if (!cancelled) r() }, ms); return id })

    async function run() {
      setVisible(0)
      await wait(500)
      for (let i = 1; i <= 3; i++) {
        await wait(500)
        if (cancelled) return
        setVisible(i)
      }
      await wait(2500)
      if (cancelled) return
      setTick((t) => t + 1)
    }
    run()
    return () => { cancelled = true }
  }, [tick])

  const clients = [
    { name: 'Miller Residence', jobs: 3, outstanding: '$607', billed: '$1,247', color: '#FF6B2B', initials: 'MR' },
    { name: 'Johnson Auto', jobs: 5, outstanding: '$0', billed: '$2,840', color: '#3A85C5', initials: 'JA' },
    { name: 'Davis Property', jobs: 2, outstanding: '$350', billed: '$980', color: '#22C55E', initials: 'DP' },
  ]

  return (
    <div className="p-3 h-full flex flex-col space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-white text-xs font-bold">Clients</p>
        <div className="bg-white/5 rounded-lg px-2 py-1 flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-white/20" />
          <p className="text-white/30 text-[9px]">Search...</p>
        </div>
      </div>
      {clients.map((c, i) => (
        <motion.div
          key={c.name}
          className="bg-white/5 border border-white/5 rounded-xl p-2.5 flex items-center gap-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: visible > i ? 1 : 0, x: visible > i ? 0 : 20 }}
          transition={{ duration: 0.35, type: 'spring', stiffness: 200 }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[9px] font-black flex-shrink-0" style={{ backgroundColor: c.color }}>
            {c.initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[10px] font-semibold truncate">{c.name}</p>
            <p className="text-white/30 text-[8px]">{c.jobs} jobs · ${c.billed} billed</p>
          </div>
          <div className="text-right">
            <p className={`text-[10px] font-bold ${c.outstanding === '$0' ? 'text-green-400' : 'text-orange-400'}`}>{c.outstanding}</p>
            <p className="text-white/25 text-[8px]">owed</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Expenses animation ───────────────────────────────────────────────────
function ExpensesAnim() {
  const [phase, setPhase] = useState(0)
  const [scanPct, setScanPct] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise<void>((r) => { const id = setTimeout(() => { if (!cancelled) r() }, ms); return id })

    async function run() {
      setPhase(0); setScanPct(0)
      await wait(600); if (cancelled) return; setPhase(1)
      await wait(800); if (cancelled) return; setPhase(2)
      // Scan progress
      for (let i = 0; i <= 100; i += 4) {
        await wait(25)
        if (cancelled) return
        setScanPct(i)
      }
      await wait(400); if (cancelled) return; setPhase(3)
      await wait(400); if (cancelled) return; setPhase(4)
      await wait(400); if (cancelled) return; setPhase(5)
      await wait(2000); if (cancelled) return
      setTick((t) => t + 1)
    }
    run()
    return () => { cancelled = true }
  }, [tick])

  return (
    <div className="p-3 h-full flex flex-col space-y-2.5">
      <p className="text-white text-xs font-bold">Expenses</p>

      {/* Camera capture area */}
      <motion.div
        className="relative rounded-xl overflow-hidden border-2 border-dashed flex items-center justify-center"
        style={{ height: 90, borderColor: phase === 0 ? 'rgba(255,255,255,0.15)' : '#FF6B2B' }}
        animate={{ borderColor: phase >= 2 ? '#FF6B2B' : 'rgba(255,255,255,0.1)' }}
      >
        {phase < 2 ? (
          <div className="flex flex-col items-center gap-1">
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
              <Camera size={20} className="text-white/30" />
            </motion.div>
            <p className="text-white/25 text-[9px]">Snap receipt photo</p>
          </div>
        ) : phase < 3 ? (
          <div className="w-full px-4">
            <p className="text-white/60 text-[9px] mb-1.5 text-center">Scanning receipt...</p>
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <motion.div className="h-full bg-[#FF6B2B] rounded-full" style={{ width: `${scanPct}%` }} />
            </div>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <CheckCircle2 size={22} className="text-green-400" />
          </motion.div>
        )}
      </motion.div>

      {/* Parsed fields */}
      {[
        { label: 'VENDOR', value: 'AutoZone #1284', phase: 3 },
        { label: 'AMOUNT', value: '$84.27', phase: 4 },
        { label: 'CATEGORY', value: '🔧 Materials', phase: 5 },
      ].map((field) => (
        <motion.div
          key={field.label}
          className="bg-white/5 border border-white/5 rounded-lg px-3 py-2 flex justify-between items-center"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: phase >= field.phase ? 1 : 0, y: phase >= field.phase ? 0 : 6 }}
          transition={{ duration: 0.3 }}
        >
          <span className="text-white/30 text-[9px] font-semibold">{field.label}</span>
          <span className={`text-[10px] font-semibold ${field.label === 'AMOUNT' ? 'text-orange-400' : 'text-white'}`}>{field.value}</span>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Services animation ───────────────────────────────────────────────────
function ServicesAnim() {
  const [visible, setVisible] = useState(0)
  const [pulseCta, setPulseCta] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise<void>((r) => { const id = setTimeout(() => { if (!cancelled) r() }, ms); return id })

    async function run() {
      setVisible(0); setPulseCta(false)
      await wait(400)
      for (let i = 1; i <= 3; i++) {
        await wait(600)
        if (cancelled) return
        setVisible(i)
      }
      await wait(400); if (cancelled) return; setPulseCta(true)
      await wait(2500); if (cancelled) return
      setTick((t) => t + 1)
    }
    run()
    return () => { cancelled = true }
  }, [tick])

  const services = [
    { name: 'Full Interior Detail', hours: '2.5h', price: '$150', desc: 'Vacuum, steam, dash wipe, windows', color: '#FF6B2B' },
    { name: 'Paint Correction', hours: '4h', price: '$280', desc: 'Compound, polish, seal', color: '#3A85C5' },
    { name: 'Ceramic Coating', hours: '3h', price: '$350', desc: 'Prep, coat, cure, inspect', color: '#A855F7' },
  ]

  return (
    <div className="p-3 h-full flex flex-col space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-white text-xs font-bold">My Services</p>
        <motion.button
          className="bg-orange-500/20 border border-orange-500/30 text-orange-400 text-[9px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-0.5"
          animate={pulseCta ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Plus size={9} /> Add
        </motion.button>
      </div>
      {services.map((s, i) => (
        <motion.div
          key={s.name}
          className="bg-white/5 border border-white/5 rounded-xl p-2.5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: visible > i ? 1 : 0, y: visible > i ? 0 : 10 }}
          transition={{ duration: 0.35, type: 'spring', stiffness: 220 }}
        >
          <div className="flex items-start justify-between gap-1 mb-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <p className="text-white text-[10px] font-semibold truncate">{s.name}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-white/30 text-[9px]">{s.hours}</span>
              <span className="text-orange-400 text-[10px] font-bold">{s.price}</span>
            </div>
          </div>
          <p className="text-white/30 text-[8px] ml-3">{s.desc}</p>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Tour slides config ───────────────────────────────────────────────────
type Slide = {
  id: string
  tabName: string
  Icon: typeof LayoutDashboard
  title: string
  description: string
  Animation: React.ComponentType
}

const SLIDES: Slide[] = [
  {
    id: 'dashboard',
    tabName: 'Dashboard',
    Icon: LayoutDashboard,
    title: 'See everything at a glance.',
    description: 'Your outstanding balance, job count, and monthly profit — all live. No spreadsheets, no guessing.',
    Animation: DashboardAnim,
  },
  {
    id: 'voice',
    tabName: 'Voice Invoice',
    Icon: Mic,
    title: 'Invoice any job in 30 seconds.',
    description: 'Describe the job out loud. AI parses client, hours, parts, and pricing into a professional invoice automatically.',
    Animation: DemoAnimation,
  },
  {
    id: 'clients',
    tabName: 'Clients',
    Icon: Users,
    title: 'Every client, fully organized.',
    description: "Total billed, outstanding balance, job history — all per client. One tap to draft a message or start a new invoice.",
    Animation: ClientsAnim,
  },
  {
    id: 'expenses',
    tabName: 'Expenses',
    Icon: Receipt,
    title: 'Snap receipts. Done.',
    description: 'Take a photo of any receipt. AI reads it, categorizes it, and links it to the right job. No manual entry.',
    Animation: ExpensesAnim,
  },
  {
    id: 'services',
    tabName: 'Services',
    Icon: Settings,
    title: 'Your service catalog.',
    description: 'Define your services once — with description, price, and estimated time. Add them to any invoice in one tap.',
    Animation: ServicesAnim,
  },
]

// ─── Main DemoTour component ──────────────────────────────────────────────
export default function DemoTour() {
  const { updateUserProfile } = useStore()
  const [slideIdx, setSlideIdx] = useState(0)
  const [exiting, setExiting] = useState(false)

  const finish = () => {
    setExiting(true)
    setTimeout(() => {
      updateUserProfile({ hasSeenDemo: true })
    }, 500)
  }

  const next = () => {
    if (slideIdx < SLIDES.length - 1) {
      setSlideIdx((i) => i + 1)
    } else {
      finish()
    }
  }

  const slide = SLIDES[slideIdx]
  const SlideAnim = slide.Animation
  const SlideIcon = slide.Icon

  return (
    <motion.div
      className="min-h-screen bg-charcoal flex flex-col"
      animate={exiting ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <span className="text-warm-white font-bold text-sm">FieldCraft Tour</span>
        </div>
        <button
          onClick={finish}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors cursor-pointer"
        >
          Skip
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 py-3">
        {SLIDES.map((_, i) => (
          <motion.div
            key={i}
            className="rounded-full bg-white/20 cursor-pointer"
            animate={{
              width: i === slideIdx ? 24 : 6,
              backgroundColor: i === slideIdx ? '#FF6B2B' : i < slideIdx ? 'rgba(255,107,43,0.4)' : 'rgba(255,255,255,0.15)',
            }}
            style={{ height: 6 }}
            transition={{ duration: 0.25 }}
            onClick={() => setSlideIdx(i)}
          />
        ))}
      </div>

      {/* Tab label */}
      <div className="flex items-center justify-center gap-2 py-1">
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1">
          <SlideIcon size={12} className="text-orange-400" />
          <span className="text-orange-400 text-xs font-semibold">{slide.tabName}</span>
        </div>
      </div>

      {/* Phone animation */}
      <div className="flex-1 flex items-center justify-center py-4 px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -40, scale: 0.97 }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 250, damping: 22 }}
          >
            {slide.id === 'voice' ? (
              // Voice slide uses the full landing animation (already has its own PhoneFrame)
              <div style={{ transform: 'scale(0.86)', transformOrigin: 'center' }}>
                <SlideAnim />
              </div>
            ) : (
              <MiniPhone>
                <SlideAnim />
              </MiniPhone>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Text + CTA */}
      <div className="px-6 pb-8 max-w-sm mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id + '-text'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="text-center mb-6"
          >
            <h2 className="text-xl font-black text-warm-white mb-2">{slide.title}</h2>
            <p className="text-gray-400 text-sm leading-relaxed">{slide.description}</p>
          </motion.div>
        </AnimatePresence>

        <button
          onClick={next}
          className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-base py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 cursor-pointer"
        >
          {slideIdx < SLIDES.length - 1 ? (
            <>Next <ChevronRight size={18} /></>
          ) : (
            <>Get Started — Open FieldCraft</>
          )}
        </button>

        {slideIdx < SLIDES.length - 1 && (
          <p className="text-center text-gray-600 text-xs mt-3">
            {SLIDES.length - slideIdx - 1} more {SLIDES.length - slideIdx - 1 === 1 ? 'slide' : 'slides'}
          </p>
        )}
      </div>
    </motion.div>
  )
}
