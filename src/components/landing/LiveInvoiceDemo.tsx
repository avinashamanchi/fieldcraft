import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  FileText,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Send,
  Wrench,
} from 'lucide-react'
import {
  DEMO_STAGES,
  initialDemoStage,
  nextDemoStage,
  type DemoStage,
} from './liveDemoMachine'

const STAGE_LABELS: Record<DemoStage, string> = {
  ready: 'Ready',
  listening: 'Capture job',
  invoice: 'Build invoice',
  share: 'Share',
}

const STAGE_STATUS: Record<DemoStage, string> = {
  ready: 'Ready for a job note. This sample does not use the microphone.',
  listening: 'Capturing the fixed sample job description on this page.',
  invoice: 'The sample note is organized into labor and material line items.',
  share: 'The invoice is ready to review and share.',
}

const LINE_ITEMS = [
  ['Labor · 2.5 hours × $95', '$237.50'],
  ['Moen kitchen faucet', '$280.00'],
  ['Shut-off valves · 2', '$45.00'],
]

export default function LiveInvoiceDemo() {
  const reducedMotion = typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [stage, setStage] = useState<DemoStage>(() => initialDemoStage(reducedMotion))
  const [visible, setVisible] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const node = document.querySelector<HTMLElement>('[data-fieldcraft-live-demo]')
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reducedMotion) {
      setStage('share')
      setPlaying(false)
      return
    }
    setPlaying(visible)
  }, [reducedMotion, visible])

  useEffect(() => {
    if (!playing || !visible || reducedMotion) return
    const timer = window.setTimeout(() => setStage((current) => nextDemoStage(current)), 2200)
    return () => window.clearTimeout(timer)
  }, [playing, reducedMotion, stage, visible])

  function selectStage(next: DemoStage) {
    setPlaying(false)
    setStage(next)
  }

  function replay() {
    setStage(initialDemoStage(reducedMotion))
    setPlaying(!reducedMotion && visible)
  }

  return (
    <section
      className="fc-live-demo"
      aria-label="Voice-to-invoice demo"
      data-demo-stage={stage}
      data-fieldcraft-live-demo
    >
      <div className="fc-demo-topline">
        <span><i aria-hidden="true" /> Live product walkthrough</span>
        <span>Fixed sample · no recording</span>
      </div>

      <div className="fc-demo-stages" aria-label="Demo stages">
        {DEMO_STAGES.map((item, index) => (
          <button
            type="button"
            key={item}
            aria-pressed={stage === item}
            onClick={() => selectStage(item)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {STAGE_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="fc-demo-device">
        <div className="fc-device-status"><span>9:41</span><i aria-hidden="true" /><span>5G&nbsp; ▰</span></div>
        <div className="fc-device-title"><span><Wrench size={14} aria-hidden="true" /></span><strong>FieldCraft</strong><small>NEW INVOICE</small></div>

        <div className="fc-demo-screen">
          {stage === 'ready' && (
            <div className="fc-ready-panel">
              <p>Describe the work while it is fresh.</p>
              <div className="fc-mic-orbit"><span><Mic size={28} aria-hidden="true" /></span></div>
              <strong>Ready for a job note</strong>
              <small>This walkthrough uses a fixed example and never turns on your microphone.</small>
            </div>
          )}

          {stage === 'listening' && (
            <div className="fc-listening-panel">
              <div className="fc-wave" aria-hidden="true">{[18, 32, 24, 44, 28, 38, 20, 34, 16].map((height, index) => <i key={index} style={{ height }} />)}</div>
              <p>“Replaced kitchen faucet at Miller residence, 2.5 hours, Moen faucet $280, shut-off valves $45.”</p>
              <span><Mic size={14} aria-hidden="true" /> Capturing sample note</span>
            </div>
          )}

          {stage === 'invoice' && (
            <div className="fc-invoice-panel">
              <div className="fc-invoice-heading"><div><small>INVOICE</small><strong>Miller residence</strong></div><FileText size={22} aria-hidden="true" /></div>
              <div className="fc-line-items">
                {LINE_ITEMS.map(([label, amount]) => <div key={label}><span>{label}</span><strong>{amount}</strong></div>)}
              </div>
              <div className="fc-total"><span>Total</span><strong>$562.50</strong></div>
              <p><CheckCircle2 size={13} aria-hidden="true" /> Review every detail before sharing.</p>
            </div>
          )}

          {stage === 'share' && (
            <div className="fc-share-panel">
              <span className="fc-share-check"><CheckCircle2 size={32} aria-hidden="true" /></span>
              <small>INVOICE READY</small>
              <h3>$562.50</h3>
              <p>Miller residence · 3 line items</p>
              <button type="button" tabIndex={-1}><Send size={14} aria-hidden="true" /> Share invoice</button>
              <em>Demo only—nothing was created or sent.</em>
            </div>
          )}
        </div>
        <span className="fc-home-indicator" aria-hidden="true" />
      </div>

      <div className="fc-demo-footer">
        <p aria-live="polite">{STAGE_STATUS[stage]}</p>
        <div>
          <button type="button" onClick={() => setPlaying((current) => !current)} disabled={reducedMotion}>
            {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {playing ? 'Pause demo' : 'Play demo'}
          </button>
          <button type="button" onClick={replay}><RotateCcw size={13} aria-hidden="true" /> Replay</button>
        </div>
      </div>
    </section>
  )
}
