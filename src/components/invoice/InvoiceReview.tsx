import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, FileText, Printer } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import Button from '../ui/Button'
import type { ParsedInvoice } from '../../lib/groq'
import type { LineItem, TradeType } from '../../types'

interface InvoiceReviewProps {
  parsed: ParsedInvoice
  onConfirm: (updated: ParsedInvoice) => void
  onBack: () => void
  onExportPDF: (updated: ParsedInvoice) => void
  isSubmitting: boolean
}

export default function InvoiceReview({ parsed, onConfirm, onBack, onExportPDF, isSubmitting }: InvoiceReviewProps) {
  const [data, setData] = useState<ParsedInvoice>(parsed)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  const recalculate = (items: LineItem[]) => {
    const subtotal = items.reduce((s, i) => s + i.total, 0)
    const taxAmount = subtotal * data.taxRate
    return { subtotal, taxAmount, total: subtotal + taxAmount }
  }

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const items = [...data.lineItems]
    const item = { ...items[idx], [field]: value }
    if (field === 'quantity' || field === 'unitPrice') {
      item.total = Number(item.quantity) * Number(item.unitPrice)
    }
    items[idx] = item
    const { subtotal, taxAmount, total } = recalculate(items)
    setData((d) => ({ ...d, lineItems: items, subtotal, taxAmount, total }))
  }

  const removeLineItem = (idx: number) => {
    const items = data.lineItems.filter((_, i) => i !== idx)
    const { subtotal, taxAmount, total } = recalculate(items)
    setData((d) => ({ ...d, lineItems: items, subtotal, taxAmount, total }))
  }

  const addLineItem = () => {
    const newItem: LineItem = { id: uuid(), description: '', quantity: 1, unitPrice: 0, total: 0, type: 'material' }
    setData((d) => ({ ...d, lineItems: [...d.lineItems, newItem] }))
  }

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1 font-medium">CLIENT NAME</label>
          <input
            value={data.clientName}
            onChange={(e) => setData((d) => ({ ...d, clientName: e.target.value }))}
            className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1 font-medium">TRADE</label>
          <select
            value={data.tradeType}
            onChange={(e) => setData((d) => ({ ...d, tradeType: e.target.value as TradeType }))}
            className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
          >
            {['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1 font-medium">JOB TITLE</label>
        <input
          value={data.jobTitle}
          onChange={(e) => setData((d) => ({ ...d, jobTitle: e.target.value }))}
          className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
        />
      </div>

      {data.jobAddress && (
        <div>
          <label className="block text-xs text-gray-400 mb-1 font-medium">JOB ADDRESS</label>
          <input
            value={data.jobAddress ?? ''}
            onChange={(e) => setData((d) => ({ ...d, jobAddress: e.target.value }))}
            className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
      )}

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-400 font-medium">LINE ITEMS</label>
          <button onClick={addLineItem} className="text-orange-400 hover:text-orange-300 flex items-center gap-1 text-xs font-medium">
            <Plus size={13} /> Add item
          </button>
        </div>

        <div className="space-y-2">
          {data.lineItems.map((item, idx) => (
            <motion.div
              key={item.id ?? idx}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#2A2A2A] border border-white/10 rounded-xl p-3 space-y-2"
            >
              <div className="flex gap-2">
                <select
                  value={item.type}
                  onChange={(e) => updateLineItem(idx, 'type', e.target.value)}
                  className="bg-[#333] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                >
                  <option value="labor">Labor</option>
                  <option value="material">Material</option>
                </select>
                <input
                  value={item.description}
                  onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                  placeholder="Description"
                  className="flex-1 bg-transparent text-warm-white text-sm focus:outline-none placeholder-gray-500"
                />
                <button onClick={() => removeLineItem(idx)} className="text-gray-600 hover:text-red-400 flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">QTY</label>
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#333] border border-white/10 rounded-lg px-2 py-1.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">UNIT PRICE</label>
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => updateLineItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#333] border border-white/10 rounded-lg px-2 py-1.5 text-warm-white text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">TOTAL</label>
                  <div className="bg-[#333] border border-white/10 rounded-lg px-2 py-1.5 text-orange-400 text-sm font-semibold">
                    ${item.total.toFixed(2)}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="bg-[#2A2A2A] border border-white/10 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm text-gray-400">
          <span>Subtotal</span>
          <span>{formatCurrency(data.subtotal)}</span>
        </div>
        {data.taxRate > 0 && (
          <div className="flex justify-between text-sm text-gray-400">
            <span>Tax ({(data.taxRate * 100).toFixed(1)}%)</span>
            <span>{formatCurrency(data.taxAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-warm-white border-t border-white/10 pt-2 mt-2">
          <span>Total</span>
          <span className="text-orange-400">{formatCurrency(data.total)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button variant="ghost" onClick={onBack} className="flex-shrink-0">Back</Button>
        <Button variant="ghost" onClick={() => onExportPDF(data)} className="flex-shrink-0">
          <Printer size={16} />
        </Button>
        <Button fullWidth onClick={() => onConfirm(data)} loading={isSubmitting}>
          <FileText size={16} />
          Save Job & Invoice
        </Button>
      </div>
    </div>
  )
}
