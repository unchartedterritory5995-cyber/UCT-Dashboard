import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AuthGuard from './components/AuthGuard'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import MorningWire from './pages/MorningWire'
import UCT20 from './pages/UCT20'
import Breadth from './pages/Breadth'
import ThemeTrackerPage from './pages/ThemeTrackerPage'
import Calendar from './pages/Calendar'
import Traders from './pages/Traders'
import Screener from './pages/Screener'
import OptionsFlow from './pages/OptionsFlow'
import LiveFlow from './pages/LiveFlow'
import DarkPool from './pages/DarkPool'
import PostMarket from './pages/PostMarket'
import ModelBook from './pages/ModelBook'
import Journal from './pages/Journal'
import Watchlists from './pages/Watchlists'
import Community from './pages/Community'
import Settings from './pages/Settings'
import Subscribe from './pages/Subscribe'

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
      </AuthProvider>
    </BrowserRouter>
  )
}
