import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import VoiceCapture from '../components/voice/VoiceCapture'
import InvoiceReview from '../components/invoice/InvoiceReview'
import { parseJobTranscript, type ParsedInvoice } from '../lib/groq'
import { generateInvoicePDF, printInvoice } from '../lib/pdf'
import { useStore } from '../store/useStore'
import Button from '../components/ui/Button'

type Step = 'capture' | 'review' | 'success' | 'error'

export default function VoiceInvoice() {
  const navigate = useNavigate()
  const { addJob, addInvoice, userProfile, clients, addClient } = useStore()
  const [step, setStep] = useState<Step>('capture')
  const [isParsing, setIsParsing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [savedJobId, setSavedJobId] = useState<string | null>(null)

  const handleTranscript = async (transcript: string) => {
    setIsParsing(true)
    try {
      const result = await parseJobTranscript(transcript)
      setParsed(result)
      setStep('review')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Couldn't connect to AI — check your internet and try again.")
      setStep('error')
    } finally {
      setIsParsing(false)
    }
  }

  const handleConfirm = async (data: ParsedInvoice) => {
    setIsSubmitting(true)
    try {
      const jobId = uuid()
      const invoiceId = uuid()
      const now = new Date().toISOString()

      // Find or create client
      let clientId = clients.find((c) => c.name.toLowerCase() === data.clientName.toLowerCase())?.id
      if (!clientId) {
        clientId = uuid()
        await addClient({
          id: clientId,
          name: data.clientName,
          phone: '',
          address: data.jobAddress ?? '',
          city: '',
          state: '',
          zip: '',
          createdAt: now,
        })
      }

      const invoice = {
        id: invoiceId,
        jobId,
        number: `FC-${String(Date.now()).slice(-5)}`,
        lineItems: data.lineItems.map((li, i) => ({ ...li, id: li.id ?? uuid() + i })),
        subtotal: data.subtotal,
        taxRate: data.taxRate,
        taxAmount: data.taxAmount,
        total: data.total,
        paymentStatus: 'Draft' as const,
        paymentTerms: data.paymentTerms,
        notes: data.notes ?? undefined,
        createdAt: now,
      }

      const job = {
        id: jobId,
        clientId,
        clientName: data.clientName,
        title: data.jobTitle,
        tradeType: data.tradeType,
        status: 'Invoiced' as const,
        description: data.jobDescription,
        address: data.jobAddress ?? '',
        laborHours: data.laborHours,
        laborRate: data.laborRate,
        invoiceId,
        invoiceTotal: data.total,
        expenseIds: [],
        notes: data.notes ?? undefined,
        createdAt: now,
        updatedAt: now,
      }

      await addInvoice(invoice)
      await addJob(job)
      setSavedJobId(jobId)
      setStep('success')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleExportPDF = (data: ParsedInvoice) => {
    if (!parsed) return
    const mockInvoice = {
      id: 'preview',
      jobId: 'preview',
      number: `FC-PREVIEW`,
      lineItems: data.lineItems.map((li, i) => ({ ...li, id: li.id ?? `li-${i}` })),
      subtotal: data.subtotal,
      taxRate: data.taxRate,
      taxAmount: data.taxAmount,
      total: data.total,
      paymentStatus: 'Draft' as const,
      paymentTerms: data.paymentTerms,
      notes: data.notes ?? undefined,
      createdAt: new Date().toISOString(),
    }
    const mockJob = {
      id: 'preview',
      clientId: 'preview',
      clientName: data.clientName,
      title: data.jobTitle,
      tradeType: data.tradeType,
      status: 'Invoiced' as const,
      description: data.jobDescription,
      address: data.jobAddress ?? '',
      laborHours: data.laborHours,
      laborRate: data.laborRate,
      expenseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    try {
      generateInvoicePDF(mockInvoice, mockJob, userProfile)
    } catch {
      printInvoice(mockInvoice, mockJob, userProfile)
    }
  }

  return (
    <div className="min-h-screen bg-charcoal">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-warm-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-base font-semibold text-warm-white">New Invoice</h1>
          <p className="text-xs text-gray-500">
            {step === 'capture' && 'Describe the job'}
            {step === 'review' && 'Review & edit'}
            {step === 'success' && 'Invoice saved'}
            {step === 'error' && 'Something went wrong'}
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6 pb-32">
        <AnimatePresence mode="wait">
          {step === 'capture' && (
            <motion.div key="capture" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold text-warm-white mb-1">What did you fix today?</h2>
                <p className="text-gray-400 text-sm">Hold the mic and describe the job. The AI handles the rest.</p>
              </div>
              <VoiceCapture onTranscript={handleTranscript} isProcessing={isParsing} />
            </motion.div>
          )}

          {step === 'review' && parsed && (
            <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <div className="mb-4">
                <h2 className="text-xl font-bold text-warm-white mb-1">Review your invoice</h2>
                <p className="text-gray-400 text-sm">AI parsed your job. Edit anything before saving.</p>
              </div>
              <InvoiceReview
                parsed={parsed}
                onConfirm={handleConfirm}
                onBack={() => setStep('capture')}
                onExportPDF={handleExportPDF}
                isSubmitting={isSubmitting}
              />
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center py-12 gap-4"
            >
              <div className="w-20 h-20 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle size={40} className="text-green-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-warm-white mb-1">Invoice saved.</h2>
                <p className="text-gray-400 text-sm">Job logged and invoice ready to send.</p>
              </div>
              <div className="flex flex-col gap-3 w-full max-w-xs mt-4">
                {savedJobId && (
                  <Button fullWidth onClick={() => navigate(`/jobs/${savedJobId}`)}>
                    View Job & Invoice
                  </Button>
                )}
                <Button variant="ghost" fullWidth onClick={() => navigate('/')}>
                  Back to Dashboard
                </Button>
                <Button variant="ghost" fullWidth onClick={() => { setParsed(null); setStep('capture') }}>
                  Log Another Job
                </Button>
              </div>
            </motion.div>
          )}

          {step === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center py-12 gap-4"
            >
              <div className="w-20 h-20 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertCircle size={40} className="text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-warm-white mb-2">{errorMessage}</h2>
                <p className="text-gray-400 text-sm">Check your connection and try describing the job again with more detail.</p>
              </div>
              <Button onClick={() => setStep('capture')}>Try Again</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
