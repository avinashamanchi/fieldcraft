import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, FileText, Share2, CheckCircle2, Loader2 } from 'lucide-react'

type Stage = 'idle' | 'typing' | 'processing' | 'invoice' | 'success'

const TRANSCRIPT = "Replaced kitchen faucet at Miller residence, 2.5 hrs, Moen faucet $280, shut-off valves $45"

const LINE_ITEMS = [
  { label: 'Labor (2.5 hrs × $95)', amount: '$237.50', type: 'labor' },
  { label: 'Moen Kitchen Faucet', amount: '$280.00', type: 'material' },
  { label: 'Shut-off Valves (2×)', amount: '$45.00', type: 'material' },
]

function useLoop() {
  const [tick, setTick] = useState(0)
  const restart = () => setTick((t) => t + 1)
  return { tick, restart }
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto" style={{ width: 280, height: 560 }}>
      {/* Glow behind phone */}
      <div
        className="absolute inset-0 rounded-[2.5rem] blur-2xl opacity-25"
        style={{ background: 'radial-gradient(ellipse at center, #FF6B2B 0%, transparent 70%)', transform: 'scale(1.15)' }}
      />
      {/* Phone shell */}
      <div
        className="relative w-full h-full rounded-[2.5rem] overflow-hidden border border-white/15 shadow-2xl"
        style={{ background: 'linear-gradient(160deg, #1e1e1e 0%, #111 100%)' }}
      >
        {/* Side buttons (decorative) */}
        <div className="absolute left-0 top-20 w-1 h-8 rounded-r bg-white/10" />
        <div className="absolute left-0 top-32 w-1 h-8 rounded-r bg-white/10" />
        <div className="absolute right-0 top-24 w-1 h-12 rounded-l bg-white/10" />

        {/* Status bar */}
        <div className="flex items-center justify-between px-6 pt-3 pb-1">
          <span className="text-white text-xs font-semibold">9:41</span>
          <div className="w-14 h-4 bg-black rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-white/20 rounded-full" />
          </div>
          <div className="flex items-center gap-1">
            <div className="flex gap-0.5 items-end h-3">
              {[3, 5, 7, 9].map((h, i) => (
                <div key={i} className="w-0.5 bg-white/60 rounded-sm" style={{ height: h }} />
              ))}
            </div>
            <div className="w-4 h-2.5 border border-white/40 rounded-sm ml-1">
              <div className="w-3/4 h-full bg-white/60 rounded-sm m-px" />
            </div>
          </div>
        </div>

        {/* App header */}
        <div className="flex items-center px-5 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#FF6B2B] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
            </div>
            <span className="text-white text-sm font-bold">FieldCraft</span>
          </div>
        </div>

        {/* Demo content area */}
        <div className="flex-1 relative overflow-hidden" style={{ height: 460 }}>
          {children}
        </div>

        {/* Home indicator */}
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/20 rounded-full" />
      </div>
    </div>
  )
}

function IdleView() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <p className="text-white/40 text-xs tracking-widest uppercase">New Invoice</p>
      <div className="relative flex items-center justify-center">
        <motion.div
          className="absolute w-24 h-24 rounded-full bg-[#FF6B2B]/10"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-16 h-16 rounded-full bg-[#FF6B2B]/20"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
        />
        <div className="w-14 h-14 rounded-full bg-[#FF6B2B] flex items-center justify-center shadow-lg shadow-[#FF6B2B]/30">
          <Mic size={22} className="text-white" />
        </div>
      </div>
      <p className="text-white/50 text-xs text-center">Tap mic or type to describe your job...</p>
      <div className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
        <span className="text-white/20 text-xs">Describe what you did...</span>
        <motion.span
          className="inline-block w-0.5 h-3 bg-[#FF6B2B] ml-0.5 align-middle"
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      </div>
    </motion.div>
  )
}

function TypingView({ typed }: { typed: string }) {
  const textRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight
  }, [typed])

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-4 pt-4 gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <p className="text-white/40 text-xs tracking-widest uppercase text-center">New Invoice</p>
      <div
        ref={textRef}
        className="flex-1 bg-white/5 border border-[#FF6B2B]/40 rounded-2xl px-4 py-3 overflow-hidden"
        style={{ maxHeight: 200 }}
      >
        <p className="text-white/90 text-xs leading-relaxed">
          {typed}
          <motion.span
            className="inline-block w-0.5 h-3 bg-[#FF6B2B] ml-0.5 align-middle"
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
        </p>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
          <Mic size={14} className="text-[#FF6B2B]" />
          <span className="text-white/30 text-xs">Speaking...</span>
          <div className="ml-auto flex gap-0.5 items-end h-4">
            {[3, 5, 7, 4, 6].map((h, i) => (
              <motion.div
                key={i}
                className="w-0.5 bg-[#FF6B2B] rounded-sm"
                animate={{ height: [h, h + 4, h] }}
                transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#FF6B2B] flex items-center justify-center">
          <FileText size={14} className="text-white" />
        </div>
      </div>
    </motion.div>
  )
}

function ProcessingView() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center gap-5"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="w-16 h-16 rounded-2xl bg-[#FF6B2B]/10 border border-[#FF6B2B]/20 flex items-center justify-center"
        animate={{ boxShadow: ['0 0 0 0 rgba(255,107,43,0)', '0 0 0 12px rgba(255,107,43,0.1)', '0 0 0 0 rgba(255,107,43,0)'] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <Loader2 size={28} className="text-[#FF6B2B] animate-spin" />
      </motion.div>
      <div className="text-center">
        <p className="text-white/80 text-sm font-semibold">Generating invoice...</p>
        <p className="text-white/30 text-xs mt-1">AI is parsing your job</p>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#FF6B2B]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.25 }}
          />
        ))}
      </div>
    </motion.div>
  )
}

function InvoiceView({ itemsVisible }: { itemsVisible: number }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-3 pt-3 pb-2 gap-2"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, type: 'spring', stiffness: 200, damping: 20 }}
    >
      {/* Invoice card */}
      <div className="flex-1 bg-white rounded-2xl overflow-hidden flex flex-col shadow-xl" style={{ minHeight: 0 }}>
        {/* Invoice header */}
        <div className="px-4 py-3 bg-[#1A1A1A]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[#FF6B2B] text-xs font-bold tracking-widest uppercase">FieldCraft</p>
              <p className="text-white text-sm font-bold mt-0.5">Miller Residence</p>
              <p className="text-white/50 text-xs">Plumbing</p>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-xs">INVOICE</p>
              <p className="text-white text-sm font-bold">#1048</p>
              <p className="text-white/40 text-xs">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="flex-1 px-4 py-3 space-y-2">
          {LINE_ITEMS.map((item, i) => (
            <AnimatePresence key={i}>
              {itemsVisible > i && (
                <motion.div
                  className="flex items-center justify-between"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, type: 'spring', stiffness: 300 }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.type === 'labor' ? 'bg-blue-400' : 'bg-orange-400'}`} />
                    <span className="text-gray-700 text-xs truncate">{item.label}</span>
                  </div>
                  <span className="text-gray-900 text-xs font-semibold ml-2 flex-shrink-0">{item.amount}</span>
                </motion.div>
              )}
            </AnimatePresence>
          ))}

          {itemsVisible >= LINE_ITEMS.length && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <div className="border-t border-gray-100 mt-2 pt-2 space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Subtotal</span><span>$562.50</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Tax (8%)</span><span>$45.00</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                  <span className="text-gray-900 text-sm font-bold">TOTAL</span>
                  <span className="text-[#FF6B2B] text-base font-black">$607.50</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {itemsVisible >= LINE_ITEMS.length && (
        <motion.div
          className="flex gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <button className="flex-1 py-2.5 rounded-xl bg-[#FF6B2B] text-white text-xs font-bold flex items-center justify-center gap-1.5">
            <FileText size={12} /> Export PDF
          </button>
          <button className="flex-1 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold flex items-center justify-center gap-1.5">
            <Share2 size={12} /> Send
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}

function SuccessView() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        className="w-20 h-20 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
      >
        <CheckCircle2 size={36} className="text-green-400" />
      </motion.div>
      <div className="text-center">
        <p className="text-white font-bold text-sm">Invoice Ready!</p>
        <p className="text-white/40 text-xs mt-1">PDF exported · Ready to send</p>
      </div>
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="text-white/60 text-xs">$607.50 invoiced to Miller</span>
      </div>
    </motion.div>
  )
}

export default function DemoAnimation() {
  const [stage, setStage] = useState<Stage>('idle')
  const [typed, setTyped] = useState('')
  const [itemsVisible, setItemsVisible] = useState(0)
  const { tick, restart } = useLoop()

  useEffect(() => {
    let cancelled = false

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(() => { if (!cancelled) resolve() }, ms)
        return id
      })

    async function run() {
      setStage('idle')
      setTyped('')
      setItemsVisible(0)
      await wait(1800)
      if (cancelled) return

      setStage('typing')
      for (let i = 1; i <= TRANSCRIPT.length; i++) {
        if (cancelled) return
        await wait(32)
        setTyped(TRANSCRIPT.slice(0, i))
      }
      await wait(700)
      if (cancelled) return

      setStage('processing')
      await wait(1800)
      if (cancelled) return

      setStage('invoice')
      for (let i = 1; i <= LINE_ITEMS.length; i++) {
        await wait(450)
        if (cancelled) return
        setItemsVisible(i)
      }
      await wait(2800)
      if (cancelled) return

      setStage('success')
      await wait(1600)
      if (cancelled) return

      restart()
    }

    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return (
    <PhoneFrame>
      <AnimatePresence mode="wait">
        {(stage === 'idle') && <IdleView key="idle" />}
        {(stage === 'typing') && <TypingView key="typing" typed={typed} />}
        {stage === 'processing' && <ProcessingView key="processing" />}
        {stage === 'invoice' && <InvoiceView key="invoice" itemsVisible={itemsVisible} />}
        {stage === 'success' && <SuccessView key="success" />}
      </AnimatePresence>
    </PhoneFrame>
  )
}
