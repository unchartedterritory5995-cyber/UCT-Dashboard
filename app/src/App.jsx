import { Suspense } from 'react'
import BrandSplash from './components/BrandSplash'
import { SWRConfig } from 'swr'
// Auto-reload on stale-chunk 404 after Railway redeploys (new asset hashes
// land while user has old HTML loaded). Wraps React.lazy with a one-shot
// retry that hard-reloads the page instead of hanging on a missing chunk.
import lazy from './utils/lazyWithRetry'
import { COMING_SOON } from './utils/comingSoon'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
// The screener share link's route pattern. ⛔ DERIVED, never retyped: the copy-
// link button in `SaveScreenBar` builds its URL from this same module, so the
// link a member sends and the route that answers it cannot drift apart.
import { SHARED_SCREEN_ROUTE } from './pages/screener/screenShareLink'
import { SHARED_NOTE_ROUTE } from './pages/journal-2-0/lib/noteShareLink'

const Landing = lazy(() => import('./pages/Landing'))
const ComingSoon = lazy(() => import('./pages/ComingSoon'))
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
const SharedScreen = lazy(() => import('./pages/screener/SharedScreen'))
const SharedNotePage = lazy(() => import('./pages/journal-2-0/SharedNotePage'))
const AiSearchPage = lazy(() => import('./pages/AiSearchPage'))
const OptionsFlow = lazy(() => import('./pages/OptionsFlow'))
const FlowScoreboard = lazy(() => import('./pages/FlowScoreboard'))
const LiveFlow = lazy(() => import('./pages/LiveFlow'))
const LiveFlowMassive = lazy(() => import('./pages/LiveFlowMassive'))
const Traders = lazy(() => import('./pages/Traders'))
const AlertTester = lazy(() => import('./pages/AlertTester'))
const DarkPool = lazy(() => import('./pages/DarkPool'))
const PostMarket = lazy(() => import('./pages/PostMarket'))
const ModelBook = lazy(() => import('./pages/ModelBook'))
const SetupLibrary = lazy(() => import('./pages/SetupLibrary'))
const Desk = lazy(() => import('./pages/desk/Desk'))
const ArticleReader = lazy(() => import('./pages/desk/ArticleReader'))
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
const CalendarSurface = lazy(() => import('./pages/journal-2-0/surfaces/CalendarSurface'))
const NotebookSurface = lazy(() => import('./pages/journal-2-0/surfaces/NotebookSurface'))
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
const ChartRender = lazy(() => import('./pages/ChartRender'))
const CatalystsRender = lazy(() => import('./pages/CatalystsRender'))
const CalendarRender = lazy(() => import('./pages/CalendarRender'))
const InternalsRender = lazy(() => import('./pages/InternalsRender'))
const TweetsRender = lazy(() => import('./pages/TweetsRender'))
const FlowRender = lazy(() => import('./pages/FlowRender'))
const BreadthRender = lazy(() => import('./pages/BreadthRender'))
const ThemesRender = lazy(() => import('./pages/ThemesRender'))
const BookRender = lazy(() => import('./pages/BookRender'))
const EconRender = lazy(() => import('./pages/EconRender'))
const EarnCardsRender = lazy(() => import('./pages/EarnCardsRender'))
const EarnResultsRender = lazy(() => import('./pages/EarnResultsRender'))
const MoversRender = lazy(() => import('./pages/MoversRender'))
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
const Methodology = lazy(() => import('./pages/Methodology'))
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

/** Pre-launch: send every marketing / account-creation route back to the
 *  COMING SOON page. Logged-in members bypass it entirely and go to their home,
 *  so an existing member who bookmarked /pricing still lands somewhere useful. */
function PreLaunchGate({ children }) {
  const { user, isPaid, loading } = useAuth()
  if (!COMING_SOON) return children
  if (loading) return null
  if (user) return <Navigate to={isPaid ? '/dashboard' : '/morning-wire'} replace />
  return <Navigate to="/" replace />
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

/** 🔴 THE OLD FLOW-SCOREBOARD DEEP LINK, HONOURED FROM OUTSIDE THE PARTNER FILE.
 *
 *  `93980419` folded the Flow Scoreboard into `OptionsFlow.jsx` as a `dataMode`
 *  view and pointed both shipped doors — the Dashboard `FlowScoreboardTile` and
 *  the `/flow-scoreboard` route — at `?view=scoreboard`. `ed608046`, a bare
 *  "Update OptionsFlow.jsx" web-UI commit the SAME DAY, removed every trace of
 *  it: `OptionsFlow.jsx` contains the string "scoreboard" zero times today, so
 *  both doors have been opening onto the default Stocks tab ever since.
 *
 *  ⛔ `OptionsFlow.jsx` is PARTNER-OWNED (~7k lines, all inline styles), and the
 *  in-page view mode lives entirely inside it — the `dataMode` initialiser, two
 *  mode-switcher arrays and four render guards. Re-adding it there is a partner
 *  conflict, so reachability is restored HERE instead: `/flow-scoreboard` is a
 *  real route again (its pre-`93980419` shape) and this wrapper forwards the
 *  month of live `?view=scoreboard` links onto it. Zero partner edits; every
 *  door that exists today opens on the page it names.
 *  Rail: `app/src/routes/lostDoors.route.test.jsx`.
 */
function OptionsFlowRoute() {
  const { search } = useLocation()
  if (new URLSearchParams(search).get('view') === 'scoreboard') {
    return <Navigate to="/flow-scoreboard" replace />
  }
  return <OptionsFlow />
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
        {![
          '/landing', '/pricing', '/compare', '/brokers', '/terms', '/privacy',
          '/r/chart', '/r/catalysts', '/r/calendar', '/r/internals', '/r/tweets',
          '/r/flow', '/r/breadth', '/r/themes', '/r/book', '/r/econ',
          '/r/earncards', '/r/earnresults', '/r/movers',
          // Pre-launch, "/" is the COMING SOON holding page — same reasoning as
          // the marketing routes above: social traffic must not wait 9 seconds.
          ...(COMING_SOON ? ['/'] : []),
        ].includes(window.location.pathname) && (
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
            {/* Public routes — redirect to dashboard if already logged in.
                Pre-launch, "/" serves the COMING SOON holding page instead of
                the full marketing Landing (which stays mounted at /landing and
                returns here the moment VITE_COMING_SOON is off). */}
            <Route
              path="/"
              element={<PublicOnly>{COMING_SOON ? <ComingSoon /> : <Landing />}</PublicOnly>}
            />
            {/* Always-public marketing landing page — reachable from the
                in-app logo even while logged in (unlike "/", which redirects
                authenticated users to their home). */}
            <Route path="/landing" element={<PreLaunchGate><Landing /></PreLaunchGate>} />
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/signup" element={<PreLaunchGate><Signup /></PreLaunchGate>} />
            <Route path="/subscribe" element={<PreLaunchGate><Subscribe /></PreLaunchGate>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/verify-pending" element={<VerifyPending />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/methodology" element={<Methodology />} />
            {/* Public marketing comparison page (UCT vs. TradeZella/TraderSync/
                Tradervue). Not in FREE_PAGES — that gates logged-in nav; this is
                a fully public page reachable while logged out or in. */}
            <Route path="/compare" element={<PreLaunchGate><Compare /></PreLaunchGate>} />
            {/* Public "Verified Sync" marketing page — the broker-trust surface.
                Static content only (no user data), so it is safe to serve
                logged-out, outside AuthGuard. */}
            <Route path="/brokers" element={<PreLaunchGate><BrokersPage /></PreLaunchGate>} />
            {/* Public pricing page — the ONE plan, 7-day
                no-card trial, honest scope. Adapts CTA to auth state. */}
            <Route path="/pricing" element={<PreLaunchGate><Pricing /></PreLaunchGate>} />

            {/* 🔴 THE FAR END OF A SCREENER SHARE LINK.
                `GET /api/screener/shared/{share_token}` has been served all
                along and takes NO auth — the token is the credential, and the
                payload is a saved filter SPEC, never scan output. Until this
                route existed there was nothing that rendered its answer and no
                Share button to mint a token, so a complete public-sharing
                backend was reachable from nothing (reachability audit §3a).
                ⛔ OUTSIDE AuthGuard on purpose: a link that only opens for
                people who already have an account is not sharing. ⛔ And NOT
                behind PreLaunchGate — that gate exists to funnel marketing and
                account-creation routes to COMING SOON, and it would silently
                break every link a member sent.
                ⛔ The path is DERIVED from `sharedScreen.js`, which the copy-
                link button builds its URL from too — one authority over one
                value, so the route and the link cannot drift apart.
                Rail: `app/src/pages/screener/sharedScreen.route.test.jsx`. */}
            <Route path={SHARED_SCREEN_ROUTE} element={<SharedScreen />} />

            {/* The far end of a NOTEBOOK share link — same posture as the
                screener share above: token IS the credential, OUTSIDE
                AuthGuard, NOT behind PreLaunchGate (it would break every link
                a member sent), route DERIVED from noteShareLink.js. The
                server pair is additionally flag-gated (J2_SHARE_LINKS_ENABLED)
                so the whole public surface has an env kill-switch.
                Rail: journal-2-0/sharedNote.route.test.jsx. */}
            <Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} />

            {/* Headless, token-gated chart export for the Morning Wire → Substack
                renderer (and future Discord charts). Renders the real StockChart
                for a ticker with entry/stop/target lines; /api/bars is public so
                no session is needed. */}
            <Route path="/r/chart" element={<ChartRender />} />
            <Route path="/r/catalysts" element={<CatalystsRender />} />
            <Route path="/r/calendar" element={<CalendarRender />} />
            <Route path="/r/internals" element={<InternalsRender />} />
            <Route path="/r/tweets" element={<TweetsRender />} />
            <Route path="/r/flow" element={<FlowRender />} />
            <Route path="/r/breadth" element={<BreadthRender />} />
            <Route path="/r/themes" element={<ThemesRender />} />
            <Route path="/r/book" element={<BookRender />} />
            <Route path="/r/econ" element={<EconRender />} />
            <Route path="/r/earncards" element={<EarnCardsRender />} />
            <Route path="/r/earnresults" element={<EarnResultsRender />} />
            <Route path="/r/movers" element={<MoversRender />} />

            {/* Protected routes — require authentication */}
            <Route element={<AuthGuard />}>
              {/* 🔴 RESTORED 2026-08-09 at the URL the live pipeline documents.
                  `27f6a4e0` added this route; `25a711b7` — an unexplained bare
                  "Update App.jsx" web-UI commit — removed it, in the same diff
                  that dropped `GlobalVideoLayer` (since restored). It was not a
                  retirement: `api/liveflow_worker.py:576` still prints this exact
                  URL as the tuning procedure for the live alert gates, and every
                  endpoint the page calls is mounted and admin-guarded today —
                  `/api/admin/alert-tester/{configs,simulate}` plus three
                  `/api/admin/live/*` CSV routes. Restoring the door is what makes
                  the procedure true; correcting the doc would instead leave a live
                  5-endpoint admin backend with no operator surface.
                  Full-page (outside <Layout/>) exactly as it shipped — this is a
                  dense simulator, not a dashboard section. AuthGuard gates it to
                  admins alongside /admin/*, so a paid non-admin can no longer load
                  a console whose every request 403s. */}
              <Route path="/alert-tester" element={<AlertTester />} />
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
                {/* ?view=scoreboard forwards to /flow-scoreboard — see
                    OptionsFlowRoute above for why it cannot live in the page. */}
                <Route path="/options-flow" element={<OptionsFlowRoute />} />
                {/* Live Flow pages render inside the app shell (left nav) so users
                    can navigate back out — same as every other section. */}
                <Route path="/live-flow" element={<LiveFlow />} />
                <Route path="/live-massive" element={<LiveFlowMassive />} />
                {/* 🔴 RESTORED 2026-08-09. This route redirected to
                    /options-flow?view=scoreboard, which `ed608046` had already
                    stopped answering — so the Dashboard tile AND this route both
                    landed a member on the default Stocks tab. Rail:
                    `app/src/routes/lostDoors.route.test.jsx`. */}
                <Route path="/flow-scoreboard" element={<FlowScoreboard />} />
                {/* 🔴 RESTORED 2026-08-09 — this page had NO route at all while
                    `GET /api/traders` stayed mounted and live and the voice
                    navigator's PAGE_ALIASES sent "traders" straight here, i.e.
                    the assistant walked members into NotFound. The standing rail
                    is `tests/test_navigation_targets_resolve.py`, which resolves
                    every voice navigation target against this route table. */}
                <Route path="/traders" element={<Traders />} />
                <Route path="/dark-pool" element={<DarkPool />} />
                <Route path="/post-market" element={<PostMarket />} />
                <Route path="/model-book" element={<ModelBook />} />
                <Route path="/setup-library" element={<SetupLibrary />} />
                <Route path="/desk" element={<Desk />} />
                <Route path="/desk/article/:slug" element={<ArticleReader />} />
                <Route path="/educational-videos" element={<Navigate to="/desk?section=videos" replace />} />
                {/* /journal is a nested-route parent under the v5 shell. The
                    selector renders JournalLayout (with <Outlet/>) for v5, or
                    the legacy JournalTwoRoot (no Outlet) for v8. The 4
                    /journal-2-0/* detail routes below stay siblings, UNCHANGED. */}
                <Route path="/journal" element={<JournalShellSelector />}>
                  <Route index element={<TodaySurface />} />
                  <Route path="trades" element={<TradesSurface />} />
                  <Route path="calendar" element={<CalendarSurface />} />
                  <Route path="notebook" element={<NotebookSurface />} />
                  {/* Legacy grouped route — redirects to calendar/notebook. */}
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
