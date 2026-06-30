import { Suspense } from 'react'
// Auto-reload on stale-chunk 404 after Railway redeploys (new asset hashes
// land while user has old HTML loaded). Wraps React.lazy with a one-shot
// retry that hard-reloads the page instead of hanging on a missing chunk.
import lazy from './utils/lazyWithRetry'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { VoiceProvider } from './context/VoiceContext'
import AuthGuard from './components/AuthGuard'
import Layout from './components/Layout'
import RouteErrorBoundary from './components/RouteErrorBoundary'
import IntroAnimation from './components/intro/IntroAnimation'
import GlobalVideoLayer from './components/video/GlobalVideoLayer'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Subscribe = lazy(() => import('./pages/Subscribe'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MorningWire = lazy(() => import('./pages/MorningWire'))
const ResearchPage = lazy(() => import('./pages/research/ResearchPage'))
const UCT20 = lazy(() => import('./pages/UCT20'))
const Breadth = lazy(() => import('./pages/Breadth'))
const ThemeTrackerPage = lazy(() => import('./pages/ThemeTrackerPage'))
const Calendar = lazy(() => import('./pages/Calendar'))
const MyStocksHub = lazy(() => import('./pages/calendar/MyStocksHub'))
const Screener = lazy(() => import('./pages/Screener'))
const OptionsFlow = lazy(() => import('./pages/OptionsFlow'))
const LiveFlow = lazy(() => import('./pages/LiveFlow'))
const LiveFlowMassive = lazy(() => import('./pages/LiveFlowMassive'))
const DarkPool = lazy(() => import('./pages/DarkPool'))
const PostMarket = lazy(() => import('./pages/PostMarket'))
const ModelBook = lazy(() => import('./pages/ModelBook'))
const SetupLibrary = lazy(() => import('./pages/SetupLibrary'))
const Desk = lazy(() => import('./pages/desk/Desk'))
const Journal = lazy(() => import('./pages/journal-2-0/JournalTwoRoot'))
const J2DayDetailPage = lazy(() => import('./pages/journal-2-0/components/calendar/DayDetailPage'))
const J2ReportPage = lazy(() => import('./pages/journal-2-0/components/ReportPage'))
const GlobalAddPositionProvider = lazy(() => import('./pages/journal-2-0/GlobalAddPositionProvider'))
const MultiChart = lazy(() => import('./pages/MultiChart'))
const Watchlists = lazy(() => import('./pages/Watchlists'))
const ChartsWorkspace = lazy(() => import('./pages/charts/ChartsWorkspace'))
const LegacyRedirect = lazy(() => import('./pages/charts/LegacyRedirect'))
const Patterns = lazy(() => import('./pages/Patterns'))
const CatalystsHistory = lazy(() => import('./pages/CatalystsHistory'))
const Support = lazy(() => import('./pages/Support'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const ChartHealth = lazy(() => import('./pages/admin/ChartHealth'))
const PatternAdmin = lazy(() => import('./pages/admin/PatternAdmin'))
const LandingAnalytics = lazy(() => import('./pages/admin/LandingAnalytics'))
const PatternReview = lazy(() => import('./pages/admin/PatternReview'))
const Terms = lazy(() => import('./pages/Terms'))
const Privacy = lazy(() => import('./pages/Privacy'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const VerifyPending = lazy(() => import('./pages/VerifyPending'))
const NotFound = lazy(() => import('./pages/NotFound'))

/** Heavy voice/audio layer (wake-word wasm, realtime session, audio player).
 *  Lazily code-split so its ~MB of deps stay out of the entry bundle and are
 *  only fetched once the user is confirmed paid (see GlobalVoiceGate). */
const GlobalVoiceLayer = lazy(() => import('./components/voice/GlobalVoiceLayer'))

/** Paid-only gate for the voice layer. The dynamic import (and thus the
 *  voice/wasm chunk) only fires for paid users — free users never download
 *  any of it. Returns null until auth resolves and the user is paid. */
function GlobalVoiceGate() {
  const { isPaid } = useAuth()
  if (!isPaid) return null
  return (
    <Suspense fallback={null}>
      <GlobalVoiceLayer />
    </Suspense>
  )
}

/** Show Landing only if NOT logged in; otherwise redirect to the user's home
 *  (dashboard for paid/admin, first free page for free users). */
function PublicOnly({ children }) {
  const { user, isPaid, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to={isPaid ? '/dashboard' : '/breadth'} replace />
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
        {/* Persistent Desk video player — one instance, survives all routing. */}
        <GlobalVideoLayer />
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
            {/* Always-public marketing landing page — reachable from the
                in-app logo even while logged in (unlike "/", which redirects
                authenticated users to their home). */}
            <Route path="/landing" element={<Landing />} />
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
              <Route path="/live-massive" element={<LiveFlowMassive />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/morning-wire" element={<MorningWire />} />
                <Route path="/uct-20" element={<UCT20 />} />
                <Route path="/breadth" element={<Breadth />} />
                <Route path="/charts" element={<ChartsWorkspace />} />
                <Route path="/theme-tracker" element={<LegacyRedirect />} />
                <Route path="/watchlists" element={<LegacyRedirect />} />
                <Route path="/multi-chart" element={<LegacyRedirect />} />
                <Route path="/research/:sym" element={<ResearchPage />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/calendar/mystocks" element={<MyStocksHub />} />
                <Route path="/screener" element={<Screener />} />
                <Route path="/options-flow" element={<OptionsFlow />} />
                <Route path="/dark-pool" element={<DarkPool />} />
                <Route path="/post-market" element={<PostMarket />} />
                <Route path="/model-book" element={<ModelBook />} />
                <Route path="/setup-library" element={<SetupLibrary />} />
                <Route path="/desk" element={<Desk />} />
                <Route path="/educational-videos" element={<Navigate to="/desk?section=videos" replace />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/journal-2-0/calendar/:date" element={<J2DayDetailPage />} />
                <Route path="/journal-2-0/report" element={<J2ReportPage />} />
                <Route path="/patterns" element={<Patterns />} />
                <Route path="/support" element={<Support />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/catalysts/history" element={<CatalystsHistory />} />
                <Route path="/admin/chart-health" element={<ChartHealth />} />
                <Route path="/admin/patterns" element={<PatternAdmin />} />
                <Route path="/admin/pattern-review" element={<PatternReview />} />
                <Route path="/admin/landing-analytics" element={<LandingAnalytics />} />
              </Route>
            </Route>

            {/* Catch-all — 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </RouteErrorBoundary>
        <GlobalVoiceGate />
        </VoiceProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
