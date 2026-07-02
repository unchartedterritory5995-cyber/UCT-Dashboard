import { useState, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BrandSplash from './BrandSplash'

function MaintenancePage() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0e0f0d', color: '#e8e3d6',
      fontFamily: "'Instrument Sans', sans-serif", textAlign: 'center',
      overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)',
        animation: 'maintenancePulse 3s ease-in-out infinite',
      }} />
      <div style={{
        fontFamily: "'Instrument Sans', sans-serif", fontSize: 42, fontWeight: 700,
        color: '#c9a84c', letterSpacing: 6, marginBottom: 24,
        position: 'relative', zIndex: 1,
      }}>
        UCT
      </div>
      <div style={{
        fontSize: 18, color: '#a09882', marginBottom: 8,
        position: 'relative', zIndex: 1,
      }}>
        We'll be back shortly
      </div>
      <div style={{
        fontSize: 13, color: '#706b5e', maxWidth: 360, lineHeight: 1.6,
        position: 'relative', zIndex: 1,
      }}>
        The platform is undergoing scheduled maintenance. Please check back in a few minutes.
      </div>
      <style>{`
        @keyframes maintenancePulse {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
        }
      `}</style>
    </div>
  )
}

export default function AuthGuard() {
  const { user, isPaid, loading } = useAuth()
  const location = useLocation()
  const [maintenance, setMaintenance] = useState(false)
  const [maintenanceChecked, setMaintenanceChecked] = useState(false)

  useEffect(() => {
    fetch('/api/maintenance')
      .then(r => r.json())
      .then(d => setMaintenance(!!d.maintenance))
      .catch(() => {})
      .finally(() => setMaintenanceChecked(true))
  }, [])

  if (loading || !maintenanceChecked) {
    return <BrandSplash label="Signing you in" />
  }

  // Maintenance mode: block non-admins
  if (maintenance && (!user || user.role !== 'admin')) {
    return <MaintenancePage />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Require email verification (admins exempt)
  if (!user.email_verified && user.role !== 'admin') {
    return <Navigate to="/verify-pending" replace />
  }

  // Free tier: ONLY these four pages are accessible without a paid plan.
  // Keep in sync with FREE_PAGES in NavBar.jsx + MobileNav.jsx.
  const FREE_PAGES = ['/breadth', '/charts', '/options-flow', '/journal']
  // Where to bounce a non-paid user who hits a locked page. MUST be a free
  // page — bouncing to /dashboard (now paid-only) would infinite-loop.
  const FREE_HOME = '/breadth'

  // Admin-only pages
  if (location.pathname.startsWith('/admin') && user.role !== 'admin') {
    return <Navigate to={FREE_HOME} replace />
  }

  // Allow settings page always (so they can manage billing / subscribe)
  if (location.pathname === '/settings') {
    return <Outlet />
  }

  // /research/* is paid-only but renders its OWN paywall teaser (not a hard
  // redirect), so let it through and let the page decide. Do NOT add it to
  // FREE_PAGES — it must not appear as a free nav item.
  if (location.pathname.startsWith('/research')) {
    return <Outlet />
  }

  // Live Flow pages — accessible via direct URL for any logged-in user during
  // test/validation phase. Not in FREE_PAGES nav (deliberately no sidebar
  // entry — discovered via URL only). Once test phase is complete and we
  // wire NavBar links, this can move into FREE_PAGES or admin-only gating.
  //
  // /live-massive: TEST page that polls Massive WS via FlowDB
  // /live-flow:    PRODUCTION page that polls Bullflow SSE (existing)
  if (location.pathname === '/live-flow' || location.pathname === '/live-massive') {
    return <Outlet />
  }

  const isFreePage = FREE_PAGES.some(p => location.pathname.startsWith(p))

  // isPaid = admin OR pro/premium/lifetime (single source of truth in AuthContext)
  if (!isPaid && !isFreePage) {
    return <Navigate to={FREE_HOME} replace />
  }

  return <Outlet />
}
