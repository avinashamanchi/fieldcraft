import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Wrench, Eye, EyeOff, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { loginWithPassword, getAccount } from '../lib/auth'

export default function Login() {
  const navigate = useNavigate()
  const account = getAccount()
  const [form, setForm] = useState({ email: account?.email ?? '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const ok = await loginWithPassword(form.email, form.password)
      if (!ok) {
        setError('Incorrect email or password.')
        setLoading(false)
      }
      // On success: loginWithPassword dispatches auth change event → App.tsx re-renders
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
          <h1 className="text-3xl font-black text-warm-white mb-1">Welcome back.</h1>
          {account ? (
            <p className="text-gray-400 text-sm mb-8">
              Signed in as <span className="text-orange-400 font-medium">{account.email}</span>
            </p>
          ) : (
            <p className="text-gray-400 text-sm mb-8">
              New here?{' '}
              <button onClick={() => navigate('/signup')} className="text-orange-400 hover:text-orange-300 font-semibold cursor-pointer">
                Create account
              </button>
            </p>
          )}

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
                autoFocus={!account}
                disabled={!!account}
                className="w-full bg-[#242424] border border-white/10 rounded-2xl px-4 py-3.5 text-warm-white text-base placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
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
                  placeholder="Your password"
                  autoComplete="current-password"
                  autoFocus={!!account}
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
              disabled={loading || !form.email || !form.password}
              className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base py-4 rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-orange-500/20 mt-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Log In'}
            </button>
          </form>

          {/* Divider + alternate account */}
          {account && (
            <div className="mt-6 text-center">
              <p className="text-gray-600 text-xs">
                Not {account.email}?{' '}
                <button
                  onClick={() => navigate('/signup')}
                  className="text-gray-500 hover:text-gray-300 underline cursor-pointer"
                >
                  Create new account
                </button>
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
