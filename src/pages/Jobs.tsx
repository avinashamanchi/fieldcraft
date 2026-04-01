import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Briefcase, Search } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import TradeIcon from '../components/ui/TradeIcon'
import EmptyState from '../components/ui/EmptyState'
import type { JobStatus } from '../types'

const FILTERS: (JobStatus | 'All')[] = ['All', 'Scheduled', 'In Progress', 'Invoiced', 'Paid']

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 7) return `${days} days ago`
  return `${Math.floor(days / 7)}w ago`
}

export default function Jobs() {
  const navigate = useNavigate()
  const { jobs } = useStore()
  const [filter, setFilter] = useState<JobStatus | 'All'>('All')
  const [search, setSearch] = useState('')

  const filtered = jobs
    .filter((j) => filter === 'All' || j.status === filter)
    .filter((j) =>
      !search ||
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      j.clientName.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-warm-white">Jobs</h1>
          <button
            onClick={() => navigate('/voice')}
            className="w-10 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs or clients..."
            className="w-full bg-[#242424] border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 overflow-x-auto pb-3 -mx-4 px-4 no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filter === f
                  ? 'bg-orange-500 text-white'
                  : 'bg-[#242424] text-gray-400 hover:text-warm-white hover:bg-[#2A2A2A]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 pb-32 max-w-lg mx-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={28} />}
            title={filter === 'All' ? 'No jobs yet' : `No ${filter.toLowerCase()} jobs`}
            description={filter === 'All' ? 'Log your first job using voice. Takes about 30 seconds.' : `You have no jobs with "${filter}" status right now.`}
            actionLabel={filter === 'All' ? 'Log First Job' : undefined}
            onAction={filter === 'All' ? () => navigate('/voice') : undefined}
          />
        ) : (
          <AnimatePresence>
            <div className="space-y-3">
              {filtered.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  className="bg-[#242424] border border-white/5 rounded-2xl p-4 cursor-pointer hover:border-white/15 active:scale-[0.985] transition-all"
                >
                  <div className="flex items-start gap-3">
                    <TradeIcon tradeType={job.tradeType} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <p className="text-warm-white font-semibold text-sm leading-snug">{job.title}</p>
                        <StatusBadge status={job.status} />
                      </div>
                      <p className="text-gray-500 text-xs mb-2">{job.clientName} · {job.tradeType}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-orange-400 font-bold text-sm">
                          {job.invoiceTotal != null
                            ? `$${job.invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </span>
                        <span className="text-gray-600 text-xs">{relativeTime(job.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
