import { Suspense } from 'react'
import BrandSplash from './components/BrandSplash'
import { SWRConfig } from 'swr'
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
// Journal 2.0 P4 runtime shell kill-switch (Task A1). Eager (tiny — only imports
// react) so window.__uctJ2Shell is wired at app boot and the /journal selector
// can read the flag without a reload. Mirrors StockChart's uct.barsPush gate.
import { useJ2Shell } from './pages/journal-2-0/shellFlag'

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
const AiSearchPage = lazy(() => import('./pages/AiSearchPage'))
const OptionsFlow = lazy(() => import('./pages/OptionsFlow'))
const LiveFlow = lazy(() => import('./pages/LiveFlow'))
const LiveFlowMassive = lazy(() => import('./pages/LiveFlowMassive'))
const DarkPool = lazy(() => import('./pages/DarkPool'))
const PostMarket = lazy(() => import('./pages/PostMarket'))
const ModelBook = lazy(() => import('./pages/ModelBook'))
const SetupLibrary = lazy(() => import('./pages/SetupLibrary'))
const Desk = lazy(() => import('./pages/desk/Desk'))
const Journal = lazy(() => import('./pages/journal-2-0/JournalTwoRoot'))
// A2: the new nested-route shell (v5). Renders a header + 5-item primary nav +
// <Outlet/>; the child routes below render into that Outlet. The legacy
// JournalTwoRoot (v8) has NO Outlet, so under v8 the deep /journal/* routes
// aren't reached (v8 users navigate via ?j2tab=) — the escape hatch.
const JournalLayout = lazy(() => import('./pages/journal-2-0/JournalLayout'))
// Surface wrappers (lazy so each surface + the heavy tab components it hosts
// stay out of the entry bundle; JournalLayout wraps <Outlet/> in its own
// Suspense so a surface chunk load never blanks the whole shell).
const TodaySurface = lazy(() => import('./pages/journal-2-0/surfaces/TodaySurface'))
const TradesSurface = lazy(() => import('./pages/journal-2-0/surfaces/TradesSurface'))
const JournalSurface = lazy(() => import('./pages/journal-2-0/surfaces/JournalSurface'))
const InsightsSurface = lazy(() => import('./pages/journal-2-0/surfaces/InsightsSurface'))
const CompassSurface = lazy(() => import('./pages/journal-2-0/surfaces/CompassSurface'))
const CommunitySurface = lazy(() => import('./pages/journal-2-0/surfaces/CommunitySurface'))
const AccountsSurface = lazy(() => import('./pages/journal-2-0/surfaces/AccountsSurface'))
const Community = lazy(() => import('./pages/community/CommunityPage'))
const J2DayDetailPage = lazy(() => import('./pages/journal-2-0/components/calendar/DayDetailPage'))
const J2ReportPage = lazy(() => import('./pages/journal-2-0/components/ReportPage'))
const J2PositionDetailPage = lazy(() => import('./pages/journal-2-0/components/position/PositionDetailPage'))
const J2TradeDetailPage = lazy(() => import('./pages/journal-2-0/components/trade/TradeDetailPage'))
const GlobalAddPositionProvider = lazy(() => import('./pages/journal-2-0/GlobalAddPositionProvider'))
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
const Compare = lazy(() => import('./pages/Compare'))
const BrokersPage = lazy(() => import('./pages/BrokersPage'))
const Pricing = lazy(() => import('./pages/Pricing'))
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
  if (user) return <Navigate to={isPaid ? '/dashboard' : '/morning-wire'} replace />
  return children
}

// Global SWR defaults. The library defaults (revalidateOnFocus:true,
// dedupingInterval:2000) caused a refetch STORM on every page navigation and
// every window-focus regain — the "switching tabs is slow" symptom. Live data
// stays fresh via each hook's own refreshInterval (prices 2s, catalysts 30s,
// alerts 60s, etc.), which these defaults do NOT touch — so turning off
// focus/reconnect revalidation and widening the dedup window is safe and cuts
// redundant requests app-wide. Per-hook options still override these. (2026-07-01)
const SWR_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 8000,
  focusThrottleInterval: 10000,
  errorRetryCount: 3,
}

/** Journal 2.0 P4 shell selector — the Task A1 seam (runtime kill-switch).
 *  Reads `uct.j2.shell` via useJ2Shell(): 'v8' → the legacy 8-tab JournalTwoRoot,
 *  'v5' → the new nested-route shell (JournalLayout, with <Outlet/>). Reversible
 *  at runtime without a deploy: window.__uctJ2Shell('v8') restores the old shell,
 *  'v5' the new.
 *
 *  ROUTING NUANCE: this selector is the element of the PARENT `/journal` route.
 *  For 'v5' it returns <JournalLayout/>, which renders <Outlet/> — so the child
 *  routes (index=Today, trades, journal, insights, compass, community, accounts)
 *  render inside it. For 'v8' it returns <JournalTwoRoot/>, which has NO Outlet,
 *  so those child routes are simply never reached under the legacy shell — v8 is
 *  the escape hatch and uses ?j2tab= for its tabs. Deep new-routes only work
 *  under v5, by design. */
function JournalShellSelector() {
  const shell = useJ2Shell()
  if (shell === 'v8') return <Journal />   // legacy 8-tab shell (no Outlet — children unreached)
  return <JournalLayout />                  // new nested-route shell (renders <Outlet/>)
}

export default function App() {
  return (
    <BrowserRouter>
      <SWRConfig value={SWR_CONFIG}>
      <AuthProvider>
        <VoiceProvider>
        {/* Cinematic intro overlay — plays on page load for the APP, but never
            on public marketing routes: a cold visitor clicking through to the
            landing page must see it immediately, not a 9-second brand film. */}
        {!['/landing', '/pricing', '/compare', '/brokers', '/terms', '/privacy'].includes(window.location.pathname) && (
          <IntroAnimation />
        )}
        {/* Global right-click → "+ Add to Portfolio" on every StockChart.
            Skips silently when logged out; only mounts once at app root. */}
        <Suspense fallback={null}>
          <GlobalAddPositionProvider />
        </Suspense>
        {/* Persistent Desk video player — one instance, survives all routing. */}
        <GlobalVideoLayer />
        <RouteErrorBoundary>
          <Suspense fallback={
            <BrandSplash label="Loading page" />
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
            {/* Public marketing comparison page (UCT vs. TradeZella/TraderSync/
                Tradervue). Not in FREE_PAGES — that gates logged-in nav; this is
                a fully public page reachable while logged out or in. */}
            <Route path="/compare" element={<Compare />} />
            {/* Public "Verified Sync" marketing page — the broker-trust surface.
                Static content only (no user data), so it is safe to serve
                logged-out, outside AuthGuard. */}
            <Route path="/brokers" element={<BrokersPage />} />
            {/* Public pricing page — the ONE plan, 7-day
                no-card trial, honest scope. Adapts CTA to auth state. */}
            <Route path="/pricing" element={<Pricing />} />

            {/* Protected routes — require authentication */}
            <Route element={<AuthGuard />}>
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
                <Route path="/ai-search" element={<AiSearchPage />} />
                <Route path="/options-flow" element={<OptionsFlow />} />
                {/* Live Flow pages render inside the app shell (left nav) so users
                    can navigate back out — same as every other section. */}
                <Route path="/live-flow" element={<LiveFlow />} />
                <Route path="/live-massive" element={<LiveFlowMassive />} />
                {/* Flow Scoreboard is now a section INSIDE Options Flow (not its own
                    nav section). Redirect old links/bookmarks to that section. */}
                <Route path="/flow-scoreboard" element={<Navigate to="/options-flow?view=scoreboard" replace />} />
                <Route path="/dark-pool" element={<DarkPool />} />
                <Route path="/post-market" element={<PostMarket />} />
                <Route path="/model-book" element={<ModelBook />} />
                <Route path="/setup-library" element={<SetupLibrary />} />
                <Route path="/desk" element={<Desk />} />
                <Route path="/educational-videos" element={<Navigate to="/desk?section=videos" replace />} />
                {/* /journal is a nested-route parent under the v5 shell. The
                    selector renders JournalLayout (with <Outlet/>) for v5, or
                    the legacy JournalTwoRoot (no Outlet) for v8. The 4
                    /journal-2-0/* detail routes below stay siblings, UNCHANGED. */}
                <Route path="/journal" element={<JournalShellSelector />}>
                  <Route index element={<TodaySurface />} />
                  <Route path="trades" element={<TradesSurface />} />
                  <Route path="journal" element={<JournalSurface />} />
                  <Route path="insights" element={<InsightsSurface />} />
                  <Route path="compass" element={<CompassSurface />} />
                  <Route path="community" element={<CommunitySurface />} />
                  <Route path="accounts" element={<AccountsSurface />} />
                </Route>
                <Route path="/community" element={<Community />} />
                <Route path="/community/:threadId" element={<Community />} />
                <Route path="/journal-2-0/calendar/:date" element={<J2DayDetailPage />} />
                <Route path="/journal-2-0/report" element={<J2ReportPage />} />
                <Route path="/journal-2-0/position/:sym" element={<J2PositionDetailPage />} />
                <Route path="/journal-2-0/trade/:id" element={<J2TradeDetailPage />} />
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
      </SWRConfig>
    </BrowserRouter>
  )
}
