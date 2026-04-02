import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { User, Briefcase, CheckCircle, Package, LogOut, ImagePlus, X, Pencil, Trash2, Clock, DollarSign, List } from 'lucide-react'
import { useStore } from '../store/useStore'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import type { TradeType, Service } from '../types'
import { v4 as uuid } from 'uuid'

const TRADE_TYPES: TradeType[] = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']

const BLANK_SERVICE: Omit<Service, 'id'> = { name: '', description: '', estimatedHours: 1, defaultPrice: 0, category: '' }

export default function Settings() {
  const { userProfile, updateUserProfile, inventory, addInventoryItem, updateInventoryItem, deleteInventoryItem, services, addService, updateService, deleteService } = useStore()
  const [form, setForm] = useState({ ...userProfile })
  const [saved, setSaved] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', quantity: 0, unit: 'ea', minStock: 1 })
  const [showAddItem, setShowAddItem] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [serviceForm, setServiceForm] = useState<Omit<Service, 'id'>>(BLANK_SERVICE)
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null)
  const [showServiceForm, setShowServiceForm] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [userEmail, setUserEmail] = useState<string>('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email)
    })
  }, [])

  // Keep form in sync when userProfile loads from Supabase
  useEffect(() => {
    setForm({ ...userProfile })
  }, [userProfile.name, userProfile.businessName, userProfile.tradeType, userProfile.hourlyRate, userProfile.taxRate])

  const handleSave = () => {
    updateUserProfile({ ...form, onboardingComplete: true })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddItem = () => {
    if (!newItem.name.trim()) return
    addInventoryItem({ id: `inv-${Date.now()}`, name: newItem.name, quantity: newItem.quantity, unit: newItem.unit, minStock: newItem.minStock })
    setNewItem({ name: '', quantity: 0, unit: 'ea', minStock: 1 })
    setShowAddItem(false)
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      updateUserProfile({ logoDataUrl: dataUrl })
      setForm((f) => ({ ...f, logoDataUrl: dataUrl }))
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    updateUserProfile({ logoDataUrl: undefined })
    setForm((f) => ({ ...f, logoDataUrl: undefined }))
    if (logoInputRef.current) logoInputRef.current.value = ''
  }

  const openAddService = () => {
    setServiceForm(BLANK_SERVICE)
    setEditingServiceId(null)
    setShowServiceForm(true)
  }

  const openEditService = (svc: Service) => {
    setServiceForm({ name: svc.name, description: svc.description, estimatedHours: svc.estimatedHours, defaultPrice: svc.defaultPrice, category: svc.category ?? '' })
    setEditingServiceId(svc.id)
    setShowServiceForm(true)
  }

  const handleSaveService = () => {
    if (!serviceForm.name.trim()) return
    if (editingServiceId) {
      updateService(editingServiceId, serviceForm)
    } else {
      addService({ id: uuid(), ...serviceForm })
    }
    setShowServiceForm(false)
    setServiceForm(BLANK_SERVICE)
    setEditingServiceId(null)
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <div className="sticky top-0 z-10 bg-charcoal/90 backdrop-blur border-b border-white/5 px-4 py-4">
        <h1 className="text-xl font-bold text-warm-white">Settings</h1>
      </div>

      <div className="px-4 pt-4 pb-32 space-y-4">

        {/* ── Logo upload ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-4">
            <ImagePlus size={14} className="text-gray-400" /> Business Logo
          </h2>
          <div className="flex items-center gap-4">
            {userProfile.logoDataUrl ? (
              <div className="relative">
                <img
                  src={userProfile.logoDataUrl}
                  alt="Business logo"
                  className="w-20 h-20 rounded-xl object-contain bg-white/5 border border-white/10 p-2"
                />
                <button
                  onClick={handleRemoveLogo}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center cursor-pointer"
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-xl bg-white/5 border-2 border-dashed border-white/15 flex items-center justify-center">
                <ImagePlus size={22} className="text-gray-600" />
              </div>
            )}
            <div className="flex-1">
              <p className="text-warm-white text-sm font-medium mb-1">
                {userProfile.logoDataUrl ? 'Logo uploaded' : 'Upload your logo'}
              </p>
              <p className="text-gray-500 text-xs mb-3">Appears on all your PDF invoices. PNG, JPG, or SVG.</p>
              <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" id="logo-upload" />
              <label
                htmlFor="logo-upload"
                className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-warm-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors cursor-pointer"
              >
                <ImagePlus size={12} />
                {userProfile.logoDataUrl ? 'Change Logo' : 'Choose File'}
              </label>
            </div>
          </div>
        </div>

        {/* ── Business profile ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4">
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

        {/* ── Services ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2">
              <List size={14} className="text-gray-400" /> My Services
            </h2>
            <button onClick={openAddService} className="text-orange-400 text-xs font-semibold hover:text-orange-300 cursor-pointer">+ Add Service</button>
          </div>

          {/* Service form */}
          {showServiceForm && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#2A2A2A] border border-orange-500/20 rounded-xl p-4 mb-4 space-y-3"
            >
              <p className="text-orange-400 text-xs font-bold uppercase tracking-wider">{editingServiceId ? 'Edit Service' : 'New Service'}</p>

              <div>
                <label className="block text-xs text-gray-400 mb-1">SERVICE NAME</label>
                <input value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="e.g. Full Interior Detail" className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">WHAT'S INCLUDED</label>
                <textarea value={serviceForm.description} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })} placeholder="e.g. Vacuum, steam clean upholstery, wipe dashboard, clean windows, deodorize interior" rows={2} className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none focus:border-orange-500 resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    <Clock size={10} className="inline mr-1" />EST. HOURS
                  </label>
                  <input type="number" step="0.5" min="0" value={serviceForm.estimatedHours} onChange={(e) => setServiceForm({ ...serviceForm, estimatedHours: parseFloat(e.target.value) || 0 })} className="w-full bg-[#333] border border-white/10 rounded-lg px-3 py-2 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    <DollarSign size={10} className="inline" />DEFAULT PRICE
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input type="number" value={serviceForm.defaultPrice} onChange={(e) => setServiceForm({ ...serviceForm, defaultPrice: parseFloat(e.target.value) || 0 })} className="w-full bg-[#333] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-warm-white text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" fullWidth onClick={handleSaveService} disabled={!serviceForm.name.trim()}>
                  {editingServiceId ? 'Update Service' : 'Add Service'}
                </Button>
                <button onClick={() => setShowServiceForm(false)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 text-sm hover:bg-white/10 transition-colors cursor-pointer">
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {services.length === 0 && !showServiceForm ? (
            <div className="text-center py-6">
              <List size={24} className="text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm mb-1">No services yet.</p>
              <p className="text-gray-600 text-xs">Add your standard services — like "Full Detail $150" — to add them to invoices instantly.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {services.map((svc) => (
                <div key={svc.id} className="bg-[#2A2A2A] border border-white/5 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-warm-white text-sm font-semibold truncate">{svc.name}</p>
                      {svc.description && (
                        <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{svc.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEditService(svc)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-500 hover:text-warm-white transition-colors cursor-pointer">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteService(svc.id)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors cursor-pointer">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1 text-gray-500 text-xs">
                      <Clock size={11} /> {svc.estimatedHours}h
                    </div>
                    <div className="flex items-center gap-1 text-orange-400 text-xs font-bold">
                      <DollarSign size={11} />${svc.defaultPrice.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Inventory ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4">
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

          {inventory.length === 0 && !showAddItem ? (
            <div className="text-center py-4">
              <p className="text-gray-600 text-xs">No inventory items. Add parts you keep on your truck.</p>
            </div>
          ) : (
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
          )}
        </div>

        {/* ── Account ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-warm-white flex items-center gap-2 mb-3">
            <User size={14} className="text-gray-400" /> Account
          </h2>
          {userEmail && (
            <p className="text-gray-400 text-xs mb-3">Signed in as <span className="text-warm-white">{userEmail}</span></p>
          )}
          {!showLogoutConfirm ? (
            <button onClick={() => setShowLogoutConfirm(true)} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer">
              <LogOut size={15} /> Sign Out
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-gray-400 text-xs">Are you sure?</p>
              <div className="flex gap-2">
                <button onClick={() => signOut()} className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/25 transition-colors cursor-pointer">Yes, Sign Out</button>
                <button onClick={() => setShowLogoutConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* ── About ── */}
        <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-4 text-center">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center mx-auto mb-2">
            <Briefcase size={18} className="text-orange-400" />
          </div>
          <p className="text-warm-white font-semibold">FieldCraft</p>
          <p className="text-gray-500 text-xs mt-1">Your job brain. In your pocket.</p>
          <p className="text-gray-600 text-xs mt-3">v1.1.0 · Built for the field</p>
        </div>
      </div>
    </div>
  )
}
