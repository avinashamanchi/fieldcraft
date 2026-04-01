import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Wrench, Eye, EyeOff, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { createAccount, getAccount } from '../lib/auth'

export default function Signup() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const passwordStrength = (() => {
    const p = form.password
    if (!p) return 0
    let score = 0
    if (p.length >= 8) score++
    if (/[A-Z]/.test(p)) score++
    if (/[0-9]/.test(p)) score++
    if (/[^A-Za-z0-9]/.test(p)) score++
    return score
  })()

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][passwordStrength]
  const strengthColor = ['', '#EF4444', '#F59E0B', '#22C55E', '#22C55E'][passwordStrength]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const emailTrimmed = form.email.trim().toLowerCase()
    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords don\'t match.')
      return
    }

    const existing = getAccount()
    if (existing) {
      setError('An account already exists on this device. Log in instead.')
      return
    }

    setLoading(true)
    try {
      await createAccount(emailTrimmed, form.password)
      // createAccount dispatches auth change event → App.tsx re-renders → shows Onboarding
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-charcoal flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-gray-400 hover:text-warm-white transition-colors cursor-pointer"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
            <Wrench size={13} className="text-white" />
          </div>
          <span className="text-warm-white font-bold">FieldCraft</span>
        </div>
        <div className="w-9" />
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-sm mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-3xl font-black text-warm-white mb-1">Create account.</h1>
          <p className="text-gray-400 text-sm mb-8">
            Already have one?{' '}
            <button onClick={() => navigate('/login')} className="text-orange-400 hover:text-orange-300 font-semibold cursor-pointer">
              Log in
            </button>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                className="w-full bg-[#242424] border border-white/10 rounded-2xl px-4 py-3.5 text-warm-white text-base placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full bg-[#242424] border border-white/10 rounded-2xl px-4 py-3.5 pr-12 text-warm-white text-base placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 cursor-pointer"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {form.password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className="h-1 flex-1 rounded-full transition-all duration-300"
                        style={{
                          backgroundColor: passwordStrength >= level ? strengthColor : '#333',
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium" style={{ color: strengthColor }}>{strengthLabel}</span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">
                Confirm Password
              </label>
              <input
                type="password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className={`w-full bg-[#242424] border rounded-2xl px-4 py-3.5 text-warm-white text-base placeholder-gray-500 focus:outline-none transition-colors ${
                  form.confirm && form.confirm !== form.password
                    ? 'border-red-500/50 focus:border-red-500'
                    : 'border-white/10 focus:border-orange-500'
                }`}
              />
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3"
              >
                <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !form.email || !form.password || !form.confirm}
              className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base py-4 rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-orange-500/20 mt-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Create Account'}
            </button>
          </form>

          <p className="text-gray-600 text-xs text-center mt-6 leading-relaxed">
            By creating an account you agree to our{' '}
            <a href="#" className="text-gray-500 hover:text-gray-400 underline">Terms</a>
            {' '}and{' '}
            <a href="#" className="text-gray-500 hover:text-gray-400 underline">Privacy Policy</a>.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
