import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, Users, Phone, Plus } from 'lucide-react'
import { useStore, selectClientTotals } from '../store/useStore'
import EmptyState from '../components/ui/EmptyState'

export default function Clients() {
  const navigate = useNavigate()
  const { clients, jobs } = useStore()
  const [search, setSearch] = useState('')

  const filtered = clients.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  )

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-warm-white">Clients</h1>
          <button
            onClick={() => navigate('/voice')}
            className="w-10 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <Plus size={20} />
          </button>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full bg-[#242424] border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <div className="px-4 pt-4 pb-32 max-w-lg mx-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            title="No clients yet"
            description="Clients are created automatically when you log a job. Start by logging your first job."
            actionLabel="Log a Job"
            onAction={() => navigate('/voice')}
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((client, i) => {
              const clientJobs = jobs.filter((j) => j.clientId === client.id)
              const totalBilled = clientJobs.reduce((s, j) => s + (j.invoiceTotal ?? 0), 0)
              const totalPaid = clientJobs
                .filter((j) => j.status === 'Paid')
                .reduce((s, j) => s + (j.invoiceTotal ?? 0), 0)
              const outstanding = totalBilled - totalPaid

              return (
                <motion.div
                  key={client.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  className="bg-[#242424] border border-white/5 rounded-2xl p-4 cursor-pointer hover:border-white/15 active:scale-[0.985] transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-steel/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-steel font-bold text-base">{client.name[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-warm-white font-semibold text-sm mb-0.5">{client.name}</p>
                      <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-2">
                        <Phone size={11} />
                        {client.phone || 'No phone'}
                      </div>
                      <div className="flex gap-4 text-xs">
                        <div>
                          <span className="text-gray-500">Billed </span>
                          <span className="text-warm-white font-semibold">${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                        </div>
                        {outstanding > 0 && (
                          <div>
                            <span className="text-gray-500">Outstanding </span>
                            <span className="text-orange-400 font-semibold">${outstanding.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">{clientJobs.length} job{clientJobs.length !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
