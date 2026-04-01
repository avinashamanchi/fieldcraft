import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Briefcase, CheckCircle, Package, LogOut } from 'lucide-react'
import { useStore } from '../store/useStore'
import { logout, getAccount } from '../lib/auth'
import Button from '../components/ui/Button'
import type { TradeType } from '../types'

const TRADE_TYPES: TradeType[] = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']

export default function Settings() {
  const { userProfile, updateUserProfile, inventory, addInventoryItem, updateInventoryItem, deleteInventoryItem } = useStore()
  const [form, setForm] = useState({ ...userProfile })
  const [saved, setSaved] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', quantity: 0, unit: 'ea', minStock: 1 })
  const [showAddItem, setShowAddItem] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const account = getAccount()

  const handleSave = () => {
    updateUserProfile({ ...form, onboardingComplete: true })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddItem = () => {
    if (!newItem.name.trim()) return
    addInventoryItem({
      id: `inv-${Date.now()}`,
      name: newItem.name,
      quantity: newItem.quantity,
      unit: newItem.unit,
      minStock: newItem.minStock,
    })
    setNewItem({ name: '', quantity: 0, unit: 'ea', minStock: 1 })
    setShowAddItem(false)
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 py-4">
        <h1 className="text-xl font-bold text-warm-white">Settings</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 pb-32 space-y-4">
        {/* Business info */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-4">
            <User size={14} className="text-gray-400" /> Your Profile
          </h2>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">YOUR NAME</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">BUSINESS NAME</label>
                <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1 font-medium">TRADE TYPE</label>
              <select value={form.tradeType} onChange={(e) => setForm({ ...form, tradeType: e.target.value as TradeType })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500">
                {TRADE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">HOURLY RATE</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: parseFloat(e.target.value) || 0 })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl pl-7 pr-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">TAX RATE (%)</label>
                <input type="number" step="0.1" value={(form.taxRate * 100).toFixed(1)} onChange={(e) => setForm({ ...form, taxRate: parseFloat(e.target.value) / 100 || 0 })} className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1 font-medium">PHONE</label>
              <input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(555) 000-0000" className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1 font-medium">BUSINESS ADDRESS</label>
              <input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City, State" className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1 font-medium">LICENSE NUMBER</label>
              <input value={form.licenseNumber ?? ''} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} placeholder="e.g. C-36 #892341" className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl px-3 py-2.5 text-warm-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
            </div>
          </div>

          <Button fullWidth onClick={handleSave} className="mt-4">
            {saved ? <><CheckCircle size={15} /> Saved!</> : 'Save Profile'}
          </Button>
        </div>

        {/* Inventory */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2">
              <Package size={14} className="text-gray-400" /> Parts Inventory
            </h2>
            <button onClick={() => setShowAddItem(!showAddItem)} className="text-orange-400 text-xs font-semibold hover:text-orange-300 cursor-pointer">+ Add Item</button>
          </div>

          {showAddItem && (
            <div className="bg-[#2A2A2A] rounded-xl p-3 mb-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Part name" className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none" />
                <input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} placeholder="Unit (ea, ft, lbs)" className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Qty on hand</label>
                  <input type="number" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 0 })} className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Min stock alert</label>
                  <input type="number" value={newItem.minStock} onChange={(e) => setNewItem({ ...newItem, minStock: parseInt(e.target.value) || 1 })} className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none" />
                </div>
              </div>
              <Button size="sm" onClick={handleAddItem} fullWidth>Add to Inventory</Button>
            </div>
          )}

          <div className="space-y-2">
            {inventory.map((item) => {
              const isLow = item.quantity <= item.minStock
              return (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-warm-white text-sm font-medium truncate">{item.name}</p>
                      {isLow && <span className="text-xs text-red-400 font-semibold bg-red-500/15 px-1.5 py-0.5 rounded-md">Low</span>}
                    </div>
                    <p className="text-gray-500 text-xs">{item.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateInventoryItem(item.id, { quantity: Math.max(0, item.quantity - 1) })} className="w-7 h-7 rounded-lg bg-[#2A2A2A] border border-white/10 flex items-center justify-center text-gray-400 hover:text-warm-white cursor-pointer">−</button>
                    <span className={`w-8 text-center text-sm font-bold ${isLow ? 'text-red-400' : 'text-warm-white'}`}>{item.quantity}</span>
                    <button onClick={() => updateInventoryItem(item.id, { quantity: item.quantity + 1 })} className="w-7 h-7 rounded-lg bg-[#2A2A2A] border border-white/10 flex items-center justify-center text-gray-400 hover:text-warm-white cursor-pointer">+</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Account */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-3">
            <User size={14} className="text-gray-400" /> Account
          </h2>
          {account && (
            <p className="text-gray-400 text-xs mb-3">Signed in as <span className="text-warm-white">{account.email}</span></p>
          )}
          {!showLogoutConfirm ? (
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer"
            >
              <LogOut size={15} /> Sign Out
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-gray-400 text-xs">Are you sure you want to sign out?</p>
              <div className="flex gap-2">
                <button
                  onClick={logout}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/25 transition-colors cursor-pointer"
                >
                  Yes, Sign Out
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* About */}
        <div className="bg-[#242424] border border-white/5 rounded-2xl p-4 text-center">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center mx-auto mb-2">
            <Briefcase size={18} className="text-orange-400" />
          </div>
          <p className="text-warm-white font-semibold">FieldCraft</p>
          <p className="text-gray-500 text-xs mt-1">Your job brain. In your pocket.</p>
          <p className="text-gray-600 text-xs mt-3">v1.0.0 · Built for the field</p>
          <p className="text-gray-600 text-xs">GROQ AI · Web Speech API · Tesseract OCR</p>
        </div>
      </div>
    </div>
  )
}
