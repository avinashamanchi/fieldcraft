import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Upload, Receipt, AlertTriangle, CheckCircle, X, Package, Fuel, Wrench, Users, MoreHorizontal } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store/useStore'
import { processReceiptImage } from '../lib/ocr'
import { categorizeExpense } from '../lib/groq'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import type { ExpenseCategory } from '../types'

const categoryIcons: Record<ExpenseCategory, React.ReactNode> = {
  Materials: <Package size={14} />,
  Fuel: <Fuel size={14} />,
  Equipment: <Wrench size={14} />,
  Subcontractor: <Users size={14} />,
  Other: <MoreHorizontal size={14} />,
}

const categoryColors: Record<ExpenseCategory, string> = {
  Materials: 'text-blue-400 bg-blue-500/15',
  Fuel: 'text-orange-400 bg-orange-500/15',
  Equipment: 'text-purple-400 bg-purple-500/15',
  Subcontractor: 'text-green-400 bg-green-500/15',
  Other: 'text-gray-400 bg-gray-500/15',
}

interface DraftExpense {
  vendor: string
  date: string
  amount: number
  category: ExpenseCategory
  notes: string
  jobId: string
  needsReview: boolean
}

export default function Expenses() {
  const { expenses, jobs, addExpense } = useStore()
  const [showCapture, setShowCapture] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isCategorizing, setIsCategorizing] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [draft, setDraft] = useState<DraftExpense | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeJobs = jobs.filter((j) => j.status !== 'Paid')

  const handleFileSelect = async (file: File) => {
    setIsScanning(true)
    setScanProgress(0)

    const progressInterval = setInterval(() => {
      setScanProgress((p) => Math.min(p + 10, 85))
    }, 300)

    try {
      const result = await processReceiptImage(file)
      setScanProgress(100)
      clearInterval(progressInterval)

      setIsCategorizing(true)
      let category: ExpenseCategory = 'Other'
      try {
        const cat = await categorizeExpense(result.vendor, result.amount, result.rawText.slice(0, 200))
        category = cat.category
      } catch {
        // fallback to Other
      }

      setDraft({
        vendor: result.vendor,
        date: result.date,
        amount: result.amount,
        category,
        notes: '',
        jobId: activeJobs[0]?.id ?? '',
        needsReview: result.needsManualReview,
      })
    } catch {
      clearInterval(progressInterval)
      setDraft({
        vendor: '',
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        category: 'Materials',
        notes: '',
        jobId: activeJobs[0]?.id ?? '',
        needsReview: true,
      })
    } finally {
      setIsScanning(false)
      setIsCategorizing(false)
    }
  }

  const saveExpense = async () => {
    if (!draft) return
    setIsSaving(true)
    try {
      const job = jobs.find((j) => j.id === draft.jobId)
      addExpense({
        id: uuid(),
        jobId: draft.jobId || undefined,
        clientId: job?.clientId,
        vendor: draft.vendor,
        category: draft.category,
        amount: draft.amount,
        date: draft.date,
        notes: draft.notes || undefined,
        createdAt: new Date().toISOString(),
      })
      setSaved(true)
      setTimeout(() => {
        setShowCapture(false)
        setDraft(null)
        setSaved(false)
      }, 1500)
    } finally {
      setIsSaving(false)
    }
  }

  // Group expenses by job
  const expensesByJob: Record<string, typeof expenses> = {}
  const unlinked: typeof expenses = []
  for (const exp of expenses) {
    if (exp.jobId) {
      expensesByJob[exp.jobId] = expensesByJob[exp.jobId] ?? []
      expensesByJob[exp.jobId].push(exp)
    } else {
      unlinked.push(exp)
    }
  }

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-warm-white">Expenses</h1>
            <p className="text-xs text-gray-500">${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })} total logged</p>
          </div>
          <button
            onClick={() => setShowCapture(true)}
            className="w-10 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <Camera size={18} />
          </button>
        </div>
      </div>

      {/* Capture modal */}
      <AnimatePresence>
        {showCapture && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-end"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-[#1E1E1E] rounded-t-3xl w-full max-w-lg mx-auto p-5 pb-10 space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold text-warm-white">Log Expense</h2>
                <button onClick={() => { setShowCapture(false); setDraft(null) }} className="p-1.5 text-gray-400 hover:text-warm-white">
                  <X size={20} />
                </button>
              </div>

              {!isScanning && !isCategorizing && !draft && (
                <div className="space-y-3">
                  <input type="file" ref={fileInputRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]) }} />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full bg-[#2A2A2A] border-2 border-dashed border-white/20 hover:border-orange-500/50 rounded-2xl p-8 flex flex-col items-center gap-3 transition-colors cursor-pointer">
                    <Camera size={28} className="text-orange-400" />
                    <div className="text-center">
                      <p className="text-warm-white font-semibold">Snap a Receipt</p>
                      <p className="text-gray-500 text-sm mt-0.5">Take a photo or upload from your camera roll</p>
                    </div>
                  </button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                    <div className="relative flex justify-center"><span className="bg-[#1E1E1E] px-3 text-xs text-gray-500">or enter manually</span></div>
                  </div>

                  <Button variant="ghost" fullWidth onClick={() => setDraft({ vendor: '', date: new Date().toISOString().split('T')[0], amount: 0, category: 'Materials', notes: '', jobId: activeJobs[0]?.id ?? '', needsReview: false })}>
                    <Upload size={16} /> Enter Manually
                  </Button>
                </div>
              )}

              {(isScanning || isCategorizing) && (
                <div className="py-8 flex flex-col items-center gap-4">
                  <div className="w-full bg-[#2A2A2A] rounded-full h-2">
                    <motion.div className="h-2 bg-orange-500 rounded-full" animate={{ width: `${scanProgress}%` }} />
                  </div>
                  <p className="text-gray-400 text-sm">
                    {isCategorizing ? 'AI categorizing expense...' : 'Reading receipt...'}
                  </p>
                </div>
              )}

              {draft && !saved && (
                <div className="space-y-3">
                  {draft.needsReview && (
                    <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                      <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-300">Low confidence — please review and correct the fields below.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1 font-medium">VENDOR</label>
                      <input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1 font-medium">AMOUNT</label>
                      <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1 font-medium">DATE</label>
                      <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1 font-medium">CATEGORY</label>
                      <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ExpenseCategory })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500">
                        {(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other'] as ExpenseCategory[]).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  {activeJobs.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1 font-medium">LINK TO JOB</label>
                      <select value={draft.jobId} onChange={(e) => setDraft({ ...draft, jobId: e.target.value })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500">
                        <option value="">No job</option>
                        {activeJobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                      </select>
                    </div>
                  )}

                  <Button fullWidth onClick={saveExpense} loading={isSaving}>Save Expense</Button>
                </div>
              )}

              {saved && (
                <div className="py-8 flex flex-col items-center gap-3">
                  <CheckCircle size={40} className="text-green-400" />
                  <p className="text-warm-white font-semibold">Expense saved.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 pt-4 pb-32 max-w-lg mx-auto">
        {expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt size={28} />}
            title="No expenses logged"
            description="Snap a receipt photo to log an expense. It takes 10 seconds."
            actionLabel="Log Expense"
            onAction={() => setShowCapture(true)}
          />
        ) : (
          <div className="space-y-4">
            {Object.entries(expensesByJob).map(([jobId, jobExpenses]) => {
              const job = jobs.find((j) => j.id === jobId)
              if (!job) return null
              const total = jobExpenses.reduce((s, e) => s + e.amount, 0)
              return (
                <div key={jobId}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">{job.title}</p>
                    <span className="text-xs text-gray-500">${total.toFixed(2)}</span>
                  </div>
                  <div className="space-y-2">
                    {jobExpenses.map((exp) => (
                      <div key={exp.id} className="bg-[#242424] border border-white/5 rounded-xl p-3 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${categoryColors[exp.category]}`}>
                          {categoryIcons[exp.category]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-warm-white text-sm font-medium truncate">{exp.vendor}</p>
                          <p className="text-gray-500 text-xs">{exp.category} · {new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                        </div>
                        <span className="text-warm-white font-bold text-sm">${exp.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {unlinked.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Unlinked</p>
                <div className="space-y-2">
                  {unlinked.map((exp) => (
                    <div key={exp.id} className="bg-[#242424] border border-white/5 rounded-xl p-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${categoryColors[exp.category]}`}>
                        {categoryIcons[exp.category]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-warm-white text-sm font-medium truncate">{exp.vendor}</p>
                        <p className="text-gray-500 text-xs">{exp.category} · {new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                      </div>
                      <span className="text-warm-white font-bold text-sm">${exp.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
