import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AuthGuard from './components/AuthGuard'
import Layout from './components/Layout'

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
const Traders = lazy(() => import('./pages/Traders'))
const Screener = lazy(() => import('./pages/Screener'))
const OptionsFlow = lazy(() => import('./pages/OptionsFlow'))
const LiveFlow = lazy(() => import('./pages/LiveFlow'))
const DarkPool = lazy(() => import('./pages/DarkPool'))
const PostMarket = lazy(() => import('./pages/PostMarket'))
const ModelBook = lazy(() => import('./pages/ModelBook'))
const Journal = lazy(() => import('./pages/Journal'))
const Watchlists = lazy(() => import('./pages/Watchlists'))
const Community = lazy(() => import('./pages/Community'))
const Settings = lazy(() => import('./pages/Settings'))

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
                <Route path="/traders" element={<Traders />} />
                <Route path="/screener" element={<Screener />} />
                <Route path="/options-flow" element={<OptionsFlow />} />
                <Route path="/dark-pool" element={<DarkPool />} />
                <Route path="/post-market" element={<PostMarket />} />
                <Route path="/model-book" element={<ModelBook />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/watchlists" element={<Watchlists />} />
                <Route path="/community" element={<Community />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
