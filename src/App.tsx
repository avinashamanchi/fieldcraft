import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import { getAccount, getSession } from './lib/auth'
import BottomNav from './components/ui/BottomNav'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import VoiceInvoice from './pages/VoiceInvoice'
import Onboarding from './pages/Onboarding'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-charcoal min-h-screen">
      {children}
      <BottomNav />
    </div>
  )
}

export default function App() {
  const { userProfile, hydrated } = useStore()

  // Re-read auth state from localStorage on every render + when the auth-change event fires
  const [authTick, setAuthTick] = useState(0)
  useEffect(() => {
    const handler = () => setAuthTick((t) => t + 1)
    window.addEventListener('fieldcraft-auth-change', handler)
    return () => window.removeEventListener('fieldcraft-auth-change', handler)
  }, [])

  // Suppress unused warning — authTick drives re-reads below
  void authTick
  const account = getAccount()
  const session = getSession()
  const isAuthenticated = !!(account && session)

  // Wait for zustand to rehydrate from localStorage before making routing decisions
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-charcoal flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-orange-500 flex items-center justify-center animate-pulse">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm">Loading FieldCraft...</p>
        </div>
      </div>
    )
  }

  // Not authenticated → show landing / login / signup
  if (!isAuthenticated) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </HashRouter>
    )
  }

  // Authenticated but not onboarded → show onboarding
  if (!userProfile.onboardingComplete) {
    return (
      <HashRouter>
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
      </HashRouter>
    )
  }

  // Fully authenticated + onboarded → full app
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
        <Route path="/jobs" element={<AppLayout><Jobs /></AppLayout>} />
        <Route path="/jobs/:id" element={<AppLayout><JobDetail /></AppLayout>} />
        <Route path="/clients" element={<AppLayout><Clients /></AppLayout>} />
        <Route path="/clients/:id" element={<AppLayout><ClientDetail /></AppLayout>} />
        <Route path="/expenses" element={<AppLayout><Expenses /></AppLayout>} />
        <Route path="/settings" element={<AppLayout><Settings /></AppLayout>} />
        <Route path="/voice" element={<VoiceInvoice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
