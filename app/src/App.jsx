import { Suspense, useEffect } from 'react'
// Auto-reload on stale-chunk 404 after Railway redeploys (new asset hashes
// land while user has old HTML loaded). Wraps React.lazy with a one-shot
// retry that hard-reloads the page instead of hanging on a missing chunk.
import lazy from './utils/lazyWithRetry'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { VoiceProvider } from './context/VoiceContext'
import { useVoice } from './context/VoiceContext'
import useRealtimeSession from './hooks/useRealtimeSession'
import useWakeWord from './hooks/useWakeWord'
import AudioPlayerBar from './components/voice/AudioPlayerBar'
import FloatingOrb from './components/voice/FloatingOrb'
import TranscriptBubble from './components/voice/TranscriptBubble'
import usePushToTalkHotkey from './hooks/usePushToTalkHotkey'
import useProactiveVoice from './hooks/useProactiveVoice'
import AuthGuard from './components/AuthGuard'
import Layout from './components/Layout'
import RouteErrorBoundary from './components/RouteErrorBoundary'
import IntroAnimation from './components/intro/IntroAnimation'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Subscribe = lazy(() => import('./pages/Subscribe'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MorningWire = lazy(() => import('./pages/MorningWire'))
const UCT20 = lazy(() => import('./pages/UCT20'))
const Breadth = lazy(() => import('./pages/Breadth'))
const ThemeTrackerPage = lazy(() => import('./pages/ThemeTrackerPage'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Screener = lazy(() => import('./pages/Screener'))
const OptionsFlow = lazy(() => import('./pages/OptionsFlow'))
const LiveFlow = lazy(() => import('./pages/LiveFlow'))
const DarkPool = lazy(() => import('./pages/DarkPool'))
const PostMarket = lazy(() => import('./pages/PostMarket'))
const ModelBook = lazy(() => import('./pages/ModelBook'))
const SetupLibrary = lazy(() => import('./pages/SetupLibrary'))
const Journal = lazy(() => import('./pages/journal-2-0/JournalTwoRoot'))
const J2DayDetailPage = lazy(() => import('./pages/journal-2-0/components/calendar/DayDetailPage'))
const J2ReportPage = lazy(() => import('./pages/journal-2-0/components/ReportPage'))
const GlobalAddPositionProvider = lazy(() => import('./pages/journal-2-0/GlobalAddPositionProvider'))
const MultiChart = lazy(() => import('./pages/MultiChart'))
const Watchlists = lazy(() => import('./pages/Watchlists'))
const Patterns = lazy(() => import('./pages/Patterns'))
const RiskDashboard = lazy(() => import('./pages/RiskDashboard'))
const Support = lazy(() => import('./pages/Support'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const ChartHealth = lazy(() => import('./pages/admin/ChartHealth'))
const PatternAdmin = lazy(() => import('./pages/admin/PatternAdmin'))
const Terms = lazy(() => import('./pages/Terms'))
const Privacy = lazy(() => import('./pages/Privacy'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const VerifyPending = lazy(() => import('./pages/VerifyPending'))
const NotFound = lazy(() => import('./pages/NotFound'))

/** Global voice UI — must render inside VoiceProvider */
function VoiceMounts() {
  const { wakeEnabled } = useVoice()
  const { connect } = useRealtimeSession()
  usePushToTalkHotkey({ context: 'global' })
  useWakeWord({ enabled: wakeEnabled, onWake: () => connect('global') })
  // P4-A: Compass speaks proactive alerts when the user has opted in
  // (Compass Settings → "Compass can speak proactive alerts"). The hook
  // is a no-op when the toggle is off; backend gates the unspoken queue.
  useProactiveVoice()
  // Batch 10a: when an agent emits route_to_agent, start a fresh session
  // in the target agent's context.
  useEffect(() => {
    const onSwitch = (e) => {
      const target = e?.detail?.agent_id
      if (target) {
        setTimeout(() => connect(target), 300)
      }
    }
    window.addEventListener('uct:voice:switch-agent', onSwitch)
    return () => window.removeEventListener('uct:voice:switch-agent', onSwitch)
  }, [connect])
  return (
    <>
      <FloatingOrb context="global" />
      <TranscriptBubble />
    </>
  )
}

/** Show Landing only if NOT logged in; otherwise redirect to dashboard */
function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <VoiceProvider>
        {/* Cinematic intro overlay — plays once per session on first dashboard
            visit. Self-unmounts on completion or skip. */}
        <IntroAnimation />
        {/* Global right-click → "+ Add to Portfolio" on every StockChart.
            Skips silently when logged out; only mounts once at app root. */}
        <Suspense fallback={null}>
          <GlobalAddPositionProvider />
        </Suspense>
        <RouteErrorBoundary>
          <Suspense fallback={
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100vh',
              background: '#0e0f0d',
              color: '#a8a290',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
              letterSpacing: '0.5px',
            }}>
              Loading…
            </div>
          }>
            <Routes>
            {/* Public routes — redirect to dashboard if already logged in */}
            <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/subscribe" element={<Subscribe />} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/verify-pending" element={<VerifyPending />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />

            {/* Protected routes — require authentication */}
            <Route element={<AuthGuard />}>
              {/* LiveFlow has its own full-page layout — no sidebar/nav wrapper */}
              <Route path="/live-flow" element={<LiveFlow />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/morning-wire" element={<MorningWire />} />
                <Route path="/uct-20" element={<UCT20 />} />
                <Route path="/breadth" element={<Breadth />} />
                <Route path="/theme-tracker" element={<ThemeTrackerPage />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/screener" element={<Screener />} />
                <Route path="/options-flow" element={<OptionsFlow />} />
                <Route path="/dark-pool" element={<DarkPool />} />
                <Route path="/post-market" element={<PostMarket />} />
                <Route path="/model-book" element={<ModelBook />} />
                <Route path="/setup-library" element={<SetupLibrary />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/journal-2-0/calendar/:date" element={<J2DayDetailPage />} />
                <Route path="/journal-2-0/report" element={<J2ReportPage />} />
                <Route path="/multi-chart" element={<MultiChart />} />
                <Route path="/watchlists" element={<Watchlists />} />
                <Route path="/patterns" element={<Patterns />} />
                <Route path="/risk" element={<RiskDashboard />} />
                <Route path="/support" element={<Support />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/chart-health" element={<ChartHealth />} />
                <Route path="/admin/patterns" element={<PatternAdmin />} />
              </Route>
            </Route>

            {/* Catch-all — 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </RouteErrorBoundary>
        <VoiceMounts />
        <AudioPlayerBar />
        </VoiceProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
