import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, Phone, MapPin, Briefcase, MessageSquare } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import TradeIcon from '../components/ui/TradeIcon'
import Button from '../components/ui/Button'
import { draftMessage } from '../lib/groq'
import type { MessageTone } from '../types'

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { clients, jobs } = useStore()

  const client = clients.find((c) => c.id === id)
  const clientJobs = jobs.filter((j) => j.clientId === id)

  const [messageContext, setMessageContext] = useState('')
  const [messageTone, setMessageTone] = useState<MessageTone>('Professional')
  const [draftedMessage, setDraftedMessage] = useState('')
  const [isDrafting, setIsDrafting] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!client) {
    return (
      <div className="min-h-screen bg-charcoal flex items-center justify-center">
        <Button onClick={() => navigate('/clients')}>Back to Clients</Button>
      </div>
    )
  }

  const totalBilled = clientJobs.reduce((s, j) => s + (j.invoiceTotal ?? 0), 0)
  const totalPaid = clientJobs.filter((j) => j.status === 'Paid').reduce((s, j) => s + (j.invoiceTotal ?? 0), 0)
  const outstanding = totalBilled - totalPaid

  const handleDraftMessage = async () => {
    if (!messageContext.trim()) return
    setIsDrafting(true)
    try {
      const context = `Client: ${client.name}. ${messageContext}`
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

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-warm-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold text-warm-white">{client.name}</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 pb-32 space-y-4">
        {/* Profile card */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-steel/20 flex items-center justify-center">
              <span className="text-steel font-bold text-2xl">{client.name[0]}</span>
            </div>
            <div>
              <h2 className="text-warm-white font-bold text-lg">{client.name}</h2>
              <p className="text-gray-500 text-sm">Client since {new Date(client.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</p>
            </div>
          </div>

          {client.phone && (
            <div className="flex items-center gap-2 text-gray-300 text-sm mb-2">
              <Phone size={14} className="text-gray-500" />
              <a href={`tel:${client.phone}`} className="hover:text-orange-400">{client.phone}</a>
            </div>
          )}
          {client.address && (
            <div className="flex items-start gap-2 text-gray-400 text-sm">
              <MapPin size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <span>{client.address}{client.city ? `, ${client.city}` : ''}</span>
            </div>
          )}
        </div>

        {/* Financial summary */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Billed', value: formatCurrency(totalBilled), color: 'text-warm-white' },
            { label: 'Total Paid', value: formatCurrency(totalPaid), color: 'text-green-400' },
            { label: 'Outstanding', value: formatCurrency(outstanding), color: outstanding > 0 ? 'text-orange-400' : 'text-gray-500' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#242424] border border-white/5 rounded-2xl p-3 text-center">
              <p className={`text-base font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* New job button */}
        <Button fullWidth onClick={() => navigate('/voice')}>
          <Briefcase size={15} />
          New Job for {client.name.split(' ')[0]}
        </Button>

        {/* Job history */}
        <div>
          <h3 className="text-sm font-semibold text-warm-white mb-3">Job History ({clientJobs.length})</h3>
          {clientJobs.length === 0 ? (
            <div className="bg-[#242424] border border-white/5 rounded-2xl p-6 text-center">
              <p className="text-gray-500 text-sm">No jobs yet for this client.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {clientJobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  className="bg-[#242424] border border-white/5 rounded-xl p-3 cursor-pointer hover:border-white/15 transition-colors flex items-center gap-3"
                >
                  <TradeIcon tradeType={job.tradeType} size={14} className="w-8 h-8" />
                  <div className="flex-1 min-w-0">
                    <p className="text-warm-white text-xs font-semibold truncate">{job.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={job.status} />
                    </div>
                  </div>
                  {job.invoiceTotal != null && (
                    <span className="text-orange-400 font-bold text-sm flex-shrink-0">${job.invoiceTotal.toFixed(0)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Draft message */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-3">
            <MessageSquare size={14} className="text-gray-400" />
            Draft a Message
          </h3>

          <div className="flex gap-2 mb-3">
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
            placeholder={`What do you want to tell ${client.name.split(' ')[0]}?`}
            className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl p-3 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 resize-none min-h-[80px] mb-3"
          />

          <Button fullWidth onClick={handleDraftMessage} loading={isDrafting} disabled={!messageContext.trim()}>
            Draft Message
          </Button>

          {draftedMessage && (
            <div className="bg-[#2A2A2A] rounded-xl p-3 mt-3">
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{draftedMessage}</p>
              <button onClick={copyToClipboard} className="mt-2 text-orange-400 text-xs font-semibold hover:text-orange-300">
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
