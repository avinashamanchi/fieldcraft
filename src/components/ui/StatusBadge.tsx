import type { JobStatus, InvoicePaymentStatus } from '../../types'

type Status = JobStatus | InvoicePaymentStatus

const statusConfig: Record<string, { label: string; classes: string }> = {
  Scheduled: { label: 'Scheduled', classes: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  'In Progress': { label: 'In Progress', classes: 'bg-orange-500/20 text-orange-300 border border-orange-500/30' },
  Invoiced: { label: 'Invoiced', classes: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  Paid: { label: 'Paid', classes: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  Draft: { label: 'Draft', classes: 'bg-gray-500/20 text-gray-400 border border-gray-500/30' },
  Sent: { label: 'Sent', classes: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  Viewed: { label: 'Viewed', classes: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  'Partially Paid': { label: 'Partial', classes: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  'Paid in Full': { label: 'Paid', classes: 'bg-green-500/20 text-green-400 border border-green-500/30' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status] ?? { label: status, classes: 'bg-gray-500/20 text-gray-400 border border-gray-500/30' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide ${config.classes}`}>
      {config.label}
    </span>
  )
}
