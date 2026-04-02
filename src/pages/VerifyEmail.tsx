import { useState } from 'react'
import { motion } from 'framer-motion'
import { Wrench, Mail, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { resendVerification } from '../lib/auth'

interface VerifyEmailProps {
  email: string
}

export default function VerifyEmail({ email }: VerifyEmailProps) {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState('')

  const handleResend = async () => {
    setResending(true)
    setError('')
    setResent(false)
    const { error: err } = await resendVerification(email)
    setResending(false)
    if (err) {
      setError(err)
    } else {
      setResent(true)
      setTimeout(() => setResent(false), 4000)
    }
  }

  return (
    <div className="min-h-screen bg-charcoal flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center px-4 pt-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <Wrench size={15} className="text-white" />
          </div>
          <span className="text-warm-white font-bold text-lg">FieldCraft</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center px-6 py-8 max-w-sm mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full text-center"
        >
          {/* Mail icon */}
          <motion.div
            className="w-20 h-20 rounded-3xl bg-orange-500/15 border border-orange-500/20 flex items-center justify-center mx-auto mb-6"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Mail size={36} className="text-orange-400" />
          </motion.div>

          <h1 className="text-3xl font-black text-warm-white mb-2">Check your inbox.</h1>
          <p className="text-gray-400 text-sm leading-relaxed mb-2">
            We sent a verification link to:
          </p>
          <div className="bg-[#242424] border border-white/10 rounded-2xl px-4 py-3 mb-8">
            <p className="text-orange-400 font-semibold text-sm">{email}</p>
          </div>

          <p className="text-gray-500 text-xs leading-relaxed mb-8">
            Click the link in the email to activate your account. Check your spam folder if you don't see it within a minute.
          </p>

          {/* Status messages */}
          {resent && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-4"
            >
              <CheckCircle size={15} className="text-green-400 flex-shrink-0" />
              <p className="text-green-400 text-sm">Verification email resent!</p>
            </motion.div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4"
            >
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </motion.div>
          )}

          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={resending}
            className="w-full bg-[#242424] hover:bg-[#2a2a2a] border border-white/10 hover:border-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-warm-white font-semibold text-sm py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {resending ? (
              <>
                <RefreshCw size={16} className="animate-spin text-orange-400" />
                Sending...
              </>
            ) : (
              <>
                <RefreshCw size={16} className="text-orange-400" />
                Resend verification email
              </>
            )}
          </button>

          <p className="text-gray-600 text-xs mt-6 leading-relaxed">
            Once verified, come back and{' '}
            <a href="#/login" className="text-orange-500 hover:text-orange-400 underline">
              log in
            </a>{' '}
            to get started.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
