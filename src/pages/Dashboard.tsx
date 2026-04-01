import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mic, DollarSign, Briefcase, TrendingUp, ChevronRight, AlertTriangle, Receipt, Users, Plus } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import TradeIcon from '../components/ui/TradeIcon'
import SkeletonCard from '../components/ui/SkeletonCard'
import Button from '../components/ui/Button'

function formatCurrency(n: number) {
  if (n >= 10000) return `$${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 14) return '1 wk ago'
  return `${Math.floor(days / 7)}w ago`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { jobs, invoices, expenses, userProfile, hydrated } = useStore()

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

  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6)

  const overdueCount = invoices.filter((i) => {
    if (i.paymentStatus === 'Paid') return false
    return (Date.now() - new Date(i.createdAt).getTime()) / 86400000 > 30
  }).length

  if (!hydrated) {
    return (
      <div className="px-4 sm:px-6 pt-6 pb-32 space-y-4">
        <div className="h-8 w-48 bg-white/10 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-white/10 rounded-2xl animate-pulse" />)}
        </div>
        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const firstName = userProfile.name.split(' ')[0] || 'there'
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="px-4 sm:px-6 pt-5 pb-32">

      {/* ── Greeting header ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-warm-white leading-tight">
            {greeting}, {firstName}.
          </h1>
          <p className="text-gray-500 text-sm">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {overdueCount > 0 && (
          <div className="flex items-center gap-1.5 bg-red-500/15 border border-red-500/25 text-red-400 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 mt-1">
            <AlertTriangle size={11} />
            {overdueCount} overdue
          </div>
        )}
      </div>

      {/* ── Hero CTA ── */}
      <motion.button
        onClick={() => navigate('/voice')}
        className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 active:from-orange-700 active:to-orange-800 text-white rounded-2xl p-5 flex items-center gap-4 mb-4 shadow-xl shadow-orange-500/20 cursor-pointer"
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.1 }}
      >
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Mic size={24} />
        </div>
        <div className="text-left flex-1">
          <div className="font-black text-lg leading-tight">Log a Job</div>
          <div className="text-white/75 text-sm">Speak it. Invoice it. Done.</div>
        </div>
        <ChevronRight size={22} className="text-white/50" />
      </motion.button>

      {/* ── Stats grid (3 equal columns, full width) ── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {
            label: 'Outstanding',
            value: formatCurrency(outstanding),
            icon: DollarSign,
            colorClass: outstanding > 0 ? 'text-orange-400' : 'text-green-400',
            bgClass: outstanding > 0 ? 'bg-orange-500/10' : 'bg-green-500/10',
          },
          {
            label: 'Jobs / Month',
            value: String(jobsThisMonth),
            icon: Briefcase,
            colorClass: 'text-blue-400',
            bgClass: 'bg-blue-500/10',
          },
          {
            label: 'Profit / Month',
            value: formatCurrency(Math.max(0, profitThisMonth)),
            icon: TrendingUp,
            colorClass: profitThisMonth >= 0 ? 'text-green-400' : 'text-red-400',
            bgClass: profitThisMonth >= 0 ? 'bg-green-500/10' : 'bg-red-500/10',
          },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-3 sm:p-4">
              <div className={`w-7 h-7 rounded-xl ${stat.bgClass} ${stat.colorClass} flex items-center justify-center mb-2`}>
                <Icon size={14} />
              </div>
              <div className={`text-xl sm:text-2xl font-black ${stat.colorClass} leading-tight`}>{stat.value}</div>
              <div className="text-[10px] sm:text-xs text-gray-500 font-medium mt-0.5 leading-tight">{stat.label}</div>
            </div>
          )
        })}
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { label: 'Add Expense', icon: Receipt, path: '/expenses' },
          { label: 'View Clients', icon: Users, path: '/clients' },
          { label: 'New Client', icon: Plus, path: '/clients' },
        ].map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className="bg-[#1E1E1E] border border-white/5 hover:border-white/10 rounded-xl px-2 py-3 flex flex-col items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Icon size={16} className="text-gray-400" />
              <span className="text-[10px] text-gray-500 font-medium text-center leading-tight">{action.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Recent Jobs ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-warm-white">Recent Jobs</h2>
        <button onClick={() => navigate('/jobs')} className="text-orange-400 text-sm font-medium hover:text-orange-300 transition-colors cursor-pointer">
          See all →
        </button>
      </div>

      {recentJobs.length === 0 ? (
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-10 text-center">
          <Briefcase size={28} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-2">No jobs yet.</p>
          <p className="text-gray-600 text-xs mb-5">Log your first job by tapping the big orange button above.</p>
          <Button onClick={() => navigate('/voice')} size="sm">
            <Mic size={14} />
            Log First Job
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {recentJobs.map((job) => (
            <motion.div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="bg-[#1E1E1E] border border-white/5 hover:border-white/10 rounded-2xl px-4 py-3.5 cursor-pointer transition-colors"
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex items-center gap-3">
                <TradeIcon tradeType={job.tradeType} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-warm-white font-semibold text-sm leading-tight truncate">{job.title}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-gray-500 text-xs truncate">{job.clientName}</p>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-orange-400 font-bold text-sm">
                        {job.invoiceTotal ? `$${job.invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                      </span>
                      <span className="text-gray-700 text-[10px]">{relativeTime(job.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={15} className="text-gray-700 flex-shrink-0" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
