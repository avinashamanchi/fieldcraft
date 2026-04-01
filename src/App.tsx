import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
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

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-charcoal min-h-screen">
      {children}
      <BottomNav />
    </div>
  )
}

export default function App() {
  const { userProfile } = useStore()

  if (!userProfile.onboardingComplete) {
    return (
      <HashRouter>
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
      </HashRouter>
    )
  }

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
