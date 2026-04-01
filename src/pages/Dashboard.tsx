import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mic, DollarSign, Briefcase, TrendingUp, ChevronRight, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import TradeIcon from '../components/ui/TradeIcon'
import SkeletonCard from '../components/ui/SkeletonCard'
import Button from '../components/ui/Button'

function formatCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  return `${Math.floor(days / 7)} weeks ago`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { jobs, invoices, expenses, hydrated } = useStore()

  // Stats
  const outstanding = invoices
    .filter((i) => i.paymentStatus !== 'Paid')
    .reduce((s, i) => s + i.total, 0)

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const jobsThisMonth = jobs.filter((j) => new Date(j.createdAt) >= startOfMonth).length

  const paidThisMonth = invoices
    .filter((i) => i.paidAt && new Date(i.paidAt) >= startOfMonth)
    .reduce((s, i) => s + i.total, 0)

  const expenseThisMonth = expenses
    .filter((e) => new Date(e.date) >= startOfMonth)
    .reduce((s, e) => s + e.amount, 0)

  const profitThisMonth = paidThisMonth - expenseThisMonth

  const recentJobs = [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5)

  // Overdue invoices (Invoiced, Sent > 30 days)
  const overdueCount = invoices.filter((i) => {
    if (i.paymentStatus === 'Paid') return false
    const age = (Date.now() - new Date(i.createdAt).getTime()) / 86400000
    return age > 30
  }).length

  if (!hydrated) {
    return (
      <div className="px-4 pt-6 pb-32 space-y-4">
        <div className="h-8 w-40 bg-white/10 rounded animate-pulse" />
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[1, 2, 3].map((i) => <div key={i} className="min-w-[140px] h-24 bg-white/10 rounded-2xl animate-pulse flex-shrink-0" />)}
        </div>
        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-32 max-w-lg mx-auto">
      {/* Greeting */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-warm-white">Dashboard</h1>
          <p className="text-sm text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        {overdueCount > 0 && (
          <div className="flex items-center gap-1.5 bg-red-500/15 border border-red-500/25 text-red-400 text-xs font-semibold px-3 py-1.5 rounded-full">
            <AlertTriangle size={12} />
            {overdueCount} overdue
          </div>
        )}
      </div>

      {/* Hero CTA */}
      <motion.button
        onClick={() => navigate('/voice')}
        className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-2xl p-5 flex items-center gap-4 mb-6 shadow-lg shadow-orange-500/20 cursor-pointer"
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.1 }}
      >
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Mic size={24} />
        </div>
        <div className="text-left">
          <div className="font-bold text-lg leading-tight">Log a Job</div>
          <div className="text-white/80 text-sm">Speak it, invoice it. Done.</div>
        </div>
        <ChevronRight size={20} className="ml-auto text-white/60" />
      </motion.button>

      {/* Stat cards */}
      <div className="flex gap-3 overflow-x-auto pb-2 mb-6 snap-x -mx-4 px-4">
        {[
          {
            label: 'Outstanding',
            value: formatCurrency(outstanding),
            icon: <DollarSign size={16} />,
            color: outstanding > 0 ? 'text-orange-400' : 'text-green-400',
            bg: 'bg-orange-500/10',
          },
          {
            label: 'Jobs This Month',
            value: String(jobsThisMonth),
            icon: <Briefcase size={16} />,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
          },
          {
            label: "Month's Profit",
            value: formatCurrency(Math.max(0, profitThisMonth)),
            icon: <TrendingUp size={16} />,
            color: profitThisMonth >= 0 ? 'text-green-400' : 'text-red-400',
            bg: 'bg-green-500/10',
          },
        ].map((stat) => (
          <div key={stat.label} className="min-w-[140px] snap-start flex-shrink-0 bg-[#242424] border border-white/5 rounded-2xl p-4">
            <div className={`w-8 h-8 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <div className={`text-2xl font-bold ${stat.color} mb-0.5`}>{stat.value}</div>
            <div className="text-xs text-gray-500 font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Recent jobs */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-warm-white">Recent Jobs</h2>
        <button onClick={() => navigate('/jobs')} className="text-orange-400 text-sm font-medium hover:text-orange-300">
          See all
        </button>
      </div>

      {recentJobs.length === 0 ? (
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-8 text-center">
          <Briefcase size={28} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-4">No jobs yet. Log your first one.</p>
          <Button onClick={() => navigate('/voice')}>
            <Mic size={15} />
            Log First Job
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {recentJobs.map((job) => (
            <motion.div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="bg-[#242424] border border-white/5 rounded-2xl p-4 cursor-pointer hover:border-white/15 transition-colors"
              whileTap={{ scale: 0.985 }}
            >
              <div className="flex items-start gap-3">
                <TradeIcon tradeType={job.tradeType} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-warm-white font-semibold text-sm leading-tight truncate">{job.title}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-gray-500 text-xs mb-2">{job.clientName}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-orange-400 font-bold text-sm">
                      {job.invoiceTotal ? `$${job.invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </span>
                    <span className="text-gray-600 text-xs">{relativeTime(job.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
