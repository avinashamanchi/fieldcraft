import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useStore } from './store/useStore'
import { supabase, handleAuthCallback, isSupabaseConfigured } from './lib/supabase'
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
import DemoTour from './pages/DemoTour'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import VerifyEmail from './pages/VerifyEmail'

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-charcoal min-h-screen">
      {children}
      <BottomNav />
    </div>
  )
}

function LoadingScreen() {
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

function SetupRequired() {
  const steps = [
    {
      num: '1',
      title: 'Create free Supabase account',
      desc: 'Go to supabase.com → click "Start your project" → sign in with GitHub (1 click)',
      link: 'https://supabase.com/dashboard/sign-up',
      linkText: 'supabase.com →',
    },
    {
      num: '2',
      title: 'Get your Access Token',
      desc: 'In Supabase dashboard → click your avatar → Account → Access Tokens → Generate new token',
      link: 'https://supabase.com/dashboard/account/tokens',
      linkText: 'Get token →',
    },
    {
      num: '3',
      title: 'Run the Setup Workflow',
      desc: 'Go to GitHub Actions → "Setup Supabase Backend" → click "Run workflow" → paste your token → Run',
      link: 'https://github.com/avinashamanchi/fieldcraft/actions/workflows/setup-backend.yml',
      linkText: 'Open workflow →',
    },
  ]

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-orange-500 flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(255,107,43,0.4)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-warm-white mb-2">One-time setup needed</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            FieldCraft needs a free database to store user data securely across devices. Takes 3 minutes.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-8">
          {steps.map((step) => (
            <div key={step.num} className="bg-[#1E1E1E] border border-white/8 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-black">{step.num}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-warm-white text-sm font-bold mb-1">{step.title}</p>
                  <p className="text-gray-500 text-xs leading-relaxed mb-2">{step.desc}</p>
                  <a
                    href={step.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-400 text-xs font-semibold hover:text-orange-300"
                  >
                    {step.linkText}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Note */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
          <p className="text-blue-400 text-xs leading-relaxed">
            After the workflow runs, the site redeploys automatically and everything is live. All user data is encrypted and isolated — nobody can access another user's data.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { userProfile, hydrated, loadUserData, clearUserData } = useStore()
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = loading
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)

  useEffect(() => {
    // Handle auth callback (email verification redirect, PKCE, etc.)
    if (isSupabaseConfigured()) {
      handleAuthCallback().catch(console.error)
    }

    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        loadUserData().catch(console.error)
      } else {
        // No session — mark hydrated so we don't show loading spinner forever
        useStore.setState({ hydrated: true })
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)

      if (event === 'SIGNED_IN' && newSession) {
        // Check if email is confirmed
        if (!newSession.user.email_confirmed_at) {
          setPendingVerificationEmail(newSession.user.email ?? null)
        } else {
          setPendingVerificationEmail(null)
          loadUserData().catch(console.error)
        }
      } else if (event === 'SIGNED_OUT') {
        clearUserData()
        setPendingVerificationEmail(null)
      } else if (event === 'USER_UPDATED' && newSession) {
        // Email just confirmed
        if (newSession.user.email_confirmed_at) {
          setPendingVerificationEmail(null)
          loadUserData().catch(console.error)
        }
      } else if (event === 'TOKEN_REFRESHED' && newSession) {
        // Session refreshed, make sure data is loaded
        if (newSession.user.email_confirmed_at && !hydrated) {
          loadUserData().catch(console.error)
        }
      }
    })

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show setup required if Supabase is not configured
  if (!isSupabaseConfigured()) {
    return <SetupRequired />
  }

  // Still initializing (waiting for getSession response)
  if (session === undefined) {
    return <LoadingScreen />
  }

  // Not authenticated → show landing / login / signup
  if (!session) {
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

  // Authenticated but email not verified
  if (pendingVerificationEmail || !session.user.email_confirmed_at) {
    const emailToShow = pendingVerificationEmail ?? session.user.email ?? ''
    return <VerifyEmail email={emailToShow} />
  }

  // Wait for data to load from Supabase
  if (!hydrated) {
    return <LoadingScreen />
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

  // Onboarded but hasn't seen the demo tour → show it once
  if (!userProfile.hasSeenDemo) {
    return (
      <HashRouter>
        <Routes>
          <Route path="*" element={<DemoTour />} />
        </Routes>
      </HashRouter>
    )
  }

  // Fully authenticated + onboarded + demo seen → full app
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
