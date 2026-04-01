import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, FileText, DollarSign, Wrench, Clock, MapPin, Printer, CheckCircle, MessageSquare, Package } from 'lucide-react'
import { useStore, selectExpensesByJob, selectInvoiceByJob } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import TradeIcon from '../components/ui/TradeIcon'
import Button from '../components/ui/Button'
import { generateInvoicePDF, printInvoice } from '../lib/pdf'
import { draftMessage } from '../lib/groq'
import type { JobStatus, MessageTone } from '../types'

const STATUS_NEXT: Record<JobStatus, JobStatus | null> = {
  Scheduled: 'In Progress',
  'In Progress': 'Invoiced',
  Invoiced: 'Paid',
  Paid: null,
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { jobs, expenses, invoices, userProfile, updateJob, updateInvoice } = useStore()

  const job = jobs.find((j) => j.id === id)
  const jobExpenses = expenses.filter((e) => e.jobId === id)
  const invoice = invoices.find((i) => i.jobId === id)

  const [showDraftMessage, setShowDraftMessage] = useState(false)
  const [messageContext, setMessageContext] = useState('')
  const [messageTone, setMessageTone] = useState<MessageTone>('Professional')
  const [draftedMessage, setDraftedMessage] = useState('')
  const [isDrafting, setIsDrafting] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!job) {
    return (
      <div className="min-h-screen bg-charcoal flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Job not found.</p>
        <Button onClick={() => navigate('/jobs')}>Back to Jobs</Button>
      </div>
    )
  }

  const totalExpenses = jobExpenses.reduce((s, e) => s + e.amount, 0)
  const laborCost = job.laborHours * job.laborRate
  const invoiceTotal = job.invoiceTotal ?? 0
  const estimatedProfit = invoiceTotal - totalExpenses - laborCost
  const profitMargin = invoiceTotal > 0 ? (estimatedProfit / invoiceTotal) * 100 : 0

  const marginColor =
    profitMargin >= 30 ? 'text-green-400' : profitMargin >= 15 ? 'text-yellow-400' : 'text-red-400'
  const marginBg =
    profitMargin >= 30 ? 'bg-green-500/15' : profitMargin >= 15 ? 'bg-yellow-500/15' : 'bg-red-500/15'

  const nextStatus = STATUS_NEXT[job.status]

  const markNextStatus = () => {
    if (!nextStatus) return
    updateJob(job.id, { status: nextStatus, ...(nextStatus === 'Paid' ? { completedAt: new Date().toISOString() } : {}) })
    if (nextStatus === 'Paid' && invoice) {
      updateInvoice(invoice.id, { paymentStatus: 'Paid', paidAt: new Date().toISOString() })
    }
  }

  const handleExport = () => {
    if (!invoice) return
    try {
      generateInvoicePDF(invoice, job, userProfile)
    } catch {
      printInvoice(invoice, job, userProfile)
    }
  }

  const handleDraftMessage = async () => {
    if (!messageContext.trim()) return
    setIsDrafting(true)
    try {
      const context = `Client: ${job.clientName}. Job: ${job.title}. Status: ${job.status}. Message to communicate: ${messageContext}`
      const msg = await draftMessage(context, messageTone)
      setDraftedMessage(msg)
    } catch {
      setDraftedMessage("Couldn't connect to AI — check your internet and try again.")
    } finally {
      setIsDrafting(false)
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(draftedMessage)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const daysOutstanding = invoice
    ? Math.floor((Date.now() - new Date(invoice.createdAt).getTime()) / 86400000)
    : 0

  return (
    <div className="min-h-screen bg-charcoal">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-warm-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-warm-white truncate">{job.title}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            {invoice && daysOutstanding > 30 && job.status !== 'Paid' && (
              <span className="text-xs text-red-400 font-medium">{daysOutstanding}d outstanding</span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 pb-32 space-y-4">
        {/* Job overview */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <div className="flex items-start gap-3 mb-4">
            <TradeIcon tradeType={job.tradeType} size={18} />
            <div className="flex-1">
              <h2 className="text-warm-white font-bold text-base leading-tight mb-0.5">{job.title}</h2>
              <p className="text-gray-400 text-sm">{job.clientName}</p>
            </div>
            {invoiceTotal > 0 && (
              <span className="text-xl font-bold text-orange-400">{formatCurrency(invoiceTotal)}</span>
            )}
          </div>

          {job.address && (
            <div className="flex items-start gap-2 mb-2">
              <MapPin size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <p className="text-gray-400 text-xs">{job.address}</p>
            </div>
          )}

          <div className="flex gap-4 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock size={12} className="text-gray-500" />
              {job.laborHours}h labor @ ${job.laborRate}/hr
            </div>
          </div>

          {job.description && (
            <p className="text-gray-400 text-sm leading-relaxed border-t border-white/5 pt-3">{job.description}</p>
          )}
        </div>

        {/* P&L card */}
        {invoiceTotal > 0 && (
          <div className={`${marginBg} border border-white/5 rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-warm-white">Job Profitability</h3>
              <span className={`text-lg font-bold ${marginColor}`}>{profitMargin.toFixed(0)}% margin</span>
            </div>

            {/* Bar visualization */}
            <div className="h-2 bg-[#1A1A1A] rounded-full mb-4 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, Math.max(0, profitMargin))}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className={`h-full rounded-full ${profitMargin >= 30 ? 'bg-green-500' : profitMargin >= 15 ? 'bg-yellow-400' : 'bg-red-500'}`}
              />
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-300">
                <span>Invoice total</span>
                <span className="font-semibold text-warm-white">{formatCurrency(invoiceTotal)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Labor ({job.laborHours}h × ${job.laborRate})</span>
                <span>−{formatCurrency(laborCost)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Expenses ({jobExpenses.length} items)</span>
                <span>−{formatCurrency(totalExpenses)}</span>
              </div>
              <div className={`flex justify-between font-bold border-t border-white/10 pt-2 ${marginColor}`}>
                <span>Est. Profit</span>
                <span>{formatCurrency(estimatedProfit)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Invoice details */}
        {invoice && (
          <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-warm-white flex items-center gap-2">
                <FileText size={14} className="text-gray-400" />
                Invoice #{invoice.number}
              </h3>
              <StatusBadge status={invoice.paymentStatus} />
            </div>

            <div className="space-y-1.5 mb-4">
              {invoice.lineItems.slice(0, 4).map((li) => (
                <div key={li.id} className="flex justify-between text-xs">
                  <span className="text-gray-400 truncate flex-1 mr-2">{li.description}</span>
                  <span className="text-gray-300 font-medium flex-shrink-0">{formatCurrency(li.total)}</span>
                </div>
              ))}
              {invoice.lineItems.length > 4 && (
                <p className="text-xs text-gray-500">+{invoice.lineItems.length - 4} more items</p>
              )}
            </div>

            <div className="flex justify-between font-bold text-sm border-t border-white/10 pt-2">
              <span className="text-gray-400">Total</span>
              <span className="text-orange-400">{formatCurrency(invoice.total)}</span>
            </div>

            {invoice.paymentStatus !== 'Paid' && daysOutstanding > 0 && (
              <p className={`text-xs mt-2 ${daysOutstanding > 30 ? 'text-red-400' : 'text-gray-500'}`}>
                {daysOutstanding} days since invoiced
              </p>
            )}

            <div className="flex gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={handleExport} className="flex-shrink-0">
                <Printer size={14} />
                Export PDF
              </Button>
              {invoice.paymentStatus !== 'Paid' && (
                <Button
                  size="sm"
                  onClick={() => updateInvoice(invoice.id, { paymentStatus: 'Paid', paidAt: new Date().toISOString() })}
                >
                  <CheckCircle size={14} />
                  Mark Paid
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Expenses */}
        {jobExpenses.length > 0 && (
          <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-3">
              <Package size={14} className="text-gray-400" />
              Expenses ({jobExpenses.length})
            </h3>
            <div className="space-y-2">
              {jobExpenses.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-gray-300 text-xs font-medium">{exp.vendor}</p>
                    <p className="text-gray-500 text-xs">{exp.category}</p>
                  </div>
                  <span className="text-warm-white font-semibold">{formatCurrency(exp.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold border-t border-white/10 pt-2">
                <span className="text-gray-400">Total expenses</span>
                <span className="text-warm-white">{formatCurrency(totalExpenses)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Draft message */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <button
            onClick={() => setShowDraftMessage(!showDraftMessage)}
            className="flex items-center gap-2 text-sm font-semibold text-warm-white w-full cursor-pointer"
          >
            <MessageSquare size={14} className="text-gray-400" />
            Draft a Message
            <span className="ml-auto text-gray-500 text-xs">{showDraftMessage ? 'Hide' : 'Show'}</span>
          </button>

          {showDraftMessage && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                {(['Casual', 'Professional', 'Firm'] as MessageTone[]).map((tone) => (
                  <button
                    key={tone}
                    onClick={() => setMessageTone(tone)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      messageTone === tone ? 'bg-orange-500 text-white' : 'bg-[#2A2A2A] text-gray-400 hover:text-warm-white'
                    }`}
                  >
                    {tone}
                  </button>
                ))}
              </div>

              <textarea
                value={messageContext}
                onChange={(e) => setMessageContext(e.target.value)}
                placeholder={`e.g. "Tell him the job's running a day late because we're waiting on parts"`}
                className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl p-3 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 resize-none min-h-[80px]"
              />

              <Button fullWidth onClick={handleDraftMessage} loading={isDrafting} disabled={!messageContext.trim()}>
                Draft Message
              </Button>

              {draftedMessage && (
                <div className="bg-[#2A2A2A] rounded-xl p-3">
                  <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{draftedMessage}</p>
                  <button
                    onClick={copyToClipboard}
                    className="mt-2 text-orange-400 text-xs font-semibold hover:text-orange-300"
                  >
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {nextStatus && (
          <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
            <h3 className="text-xs text-gray-500 font-medium mb-3 uppercase tracking-wider">Update Status</h3>
            <Button fullWidth onClick={markNextStatus}>
              <Wrench size={15} />
              Mark as {nextStatus}
            </Button>
          </div>
        )}

        {job.notes && (
          <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
            <h3 className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wider">Notes</h3>
            <p className="text-gray-300 text-sm leading-relaxed">{job.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
