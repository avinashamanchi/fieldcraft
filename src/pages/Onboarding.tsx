import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Wrench, Mic } from 'lucide-react'
import { useStore } from '../store/useStore'
import Button from '../components/ui/Button'
import type { TradeType } from '../types'

const TRADE_TYPES: TradeType[] = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']

export default function Onboarding() {
  const navigate = useNavigate()
  const { updateUserProfile } = useStore()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '',
    businessName: '',
    tradeType: 'Plumbing' as TradeType,
    hourlyRate: 95,
  })

  const handleFinish = async () => {
    await updateUserProfile({
      ...form,
      onboardingComplete: true,
    })
    navigate('/voice')
  }

  return (
    <div className="min-h-screen bg-charcoal flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center pt-16 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-orange-500 flex items-center justify-center">
            <Wrench size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-warm-white">FieldCraft</h1>
            <p className="text-gray-400 text-sm">Your job brain. In your pocket.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 max-w-sm mx-auto w-full">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-warm-white mb-1">Let's get set up.</h2>
                <p className="text-gray-400 text-sm">Takes about 30 seconds.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Your Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Mike Callahan"
                    className="w-full bg-[#242424] border border-white/10 rounded-2xl px-4 py-3.5 text-warm-white text-base placeholder-gray-500 focus:outline-none focus:border-orange-500"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Business Name</label>
                  <input
                    value={form.businessName}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                    placeholder="Callahan Trade Services"
                    className="w-full bg-[#242424] border border-white/10 rounded-2xl px-4 py-3.5 text-warm-white text-base placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Your Trade</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TRADE_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setForm({ ...form, tradeType: t })}
                        className={`py-3 rounded-2xl text-sm font-semibold transition-colors cursor-pointer ${
                          form.tradeType === t
                            ? 'bg-orange-500 text-white'
                            : 'bg-[#242424] text-gray-400 hover:text-warm-white border border-white/5'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Your Hourly Rate</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
                    <input
                      type="number"
                      value={form.hourlyRate}
                      onChange={(e) => setForm({ ...form, hourlyRate: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#242424] border border-white/10 rounded-2xl pl-9 pr-16 py-3.5 text-warm-white text-base focus:outline-none focus:border-orange-500"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">/hr</span>
                  </div>
                </div>
              </div>

              <Button
                fullWidth
                size="lg"
                onClick={() => setStep(1)}
                disabled={!form.name.trim() || !form.businessName.trim()}
              >
                Continue
              </Button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-warm-white mb-1">Now log your first job.</h2>
                <p className="text-gray-400 text-sm">Just talk. The AI handles the invoice.</p>
              </div>

              <div className="bg-[#242424] border border-white/5 rounded-2xl p-5 space-y-3">
                <p className="text-gray-400 text-sm font-medium">Try saying something like:</p>
                <div className="space-y-2">
                  {[
                    '"Replaced shut-off valve at the Smith house, 1.5 hours, new quarter-turn valve, some fittings."',
                    '"Rewired kitchen outlets for Johnson Commercial, 3 hours, 12/2 Romex, 4 outlets, GFCI."',
                    '"Serviced AC unit for Davis Residence, 2 hours, cleaned coils, recharged with R-410A."',
                  ].map((example, i) => (
                    <div key={i} className="bg-[#2A2A2A] rounded-xl p-3">
                      <p className="text-gray-300 text-xs leading-relaxed italic">{example}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Button fullWidth size="lg" onClick={handleFinish}>
                <Mic size={18} />
                Log My First Job
              </Button>

              <button onClick={handleFinish} className="w-full text-gray-500 text-sm hover:text-gray-400 py-2 cursor-pointer">
                Skip — go to dashboard
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
