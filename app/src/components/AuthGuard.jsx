import { useState, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BrandSplash from './BrandSplash'
// Reuses the calendar's OWN deep-link ticker validator (§13 below) rather
// than a second, drifting regex.
import { normalizeSym } from '../pages/calendar/useEarningsModalRoute'

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

  // Free tier: ONLY Morning Wire is accessible without a paid plan (owner
  // decision 2026-07-19 — everything else is behind the paywall).
  // Keep in sync with FREE_PAGES in NavBar.jsx + MoreSheet.jsx.
  const FREE_PAGES = ['/morning-wire']
  // Where to bounce a non-paid user who hits a locked page. MUST be a free page.
  const FREE_HOME = '/morning-wire'

  // Admin-only pages. `/alert-tester` is admin tooling that does not live under
  // the /admin prefix (it is a full-page simulator, outside <Layout/>) — every
  // endpoint it calls is already fail-closed admin-guarded server-side, so
  // without this a paid non-admin could load a console whose every request 403s.
  const isAdminOnly = location.pathname.startsWith('/admin')
    || location.pathname === '/alert-tester'
  if (isAdminOnly && user.role !== 'admin') {
    return <Navigate to={FREE_HOME} replace />
  }

  // Settings is paid/admin-only too (2026-07-19). Free users upgrade via
  // the public /subscribe page instead of the Settings billing card.
  if (location.pathname === '/settings' && !isPaid) {
    return <Navigate to={FREE_HOME} replace />
  }

  // §13 free-tier deep link (owner call, 2026-08-05). Calendar STAYS paid —
  // this does not touch FREE_PAGES. A shared link like
  // /calendar?earnings=NVDA used to silently drop the ?earnings param and
  // bounce a blocked user to bare Morning Wire with no explanation of what
  // they were sent (the most viral surface in the product, spent as an
  // unexplained bounce). If the param looks like a real ticker, send that
  // user to the existing personalized paywall teaser (/research/:sym, which
  // AuthGuard already lets through below) instead. No param, or a param that
  // doesn't validate as a ticker, falls through to the EXACT SAME FREE_HOME
  // bounce as before — this only changes where a blocked /calendar visit
  // with a valid symbol lands, nothing else. Paid/admin users never reach
  // this block (isPaid gate below already lets them through unconditionally).
  if (location.pathname === '/calendar' && !isPaid) {
    const sym = normalizeSym(new URLSearchParams(location.search).get('earnings'))
    return <Navigate to={sym ? `/research/${sym}` : FREE_HOME} replace />
  }

  // /research/* is paid-only but renders its OWN paywall teaser (not a hard
  // redirect), so let it through and let the page decide. Do NOT add it to
  // FREE_PAGES — it must not appear as a free nav item.
  if (location.pathname.startsWith('/research')) {
    return <Outlet />
  }

  // Live Flow pages (promoted 2026-07-06, roadmap T1-1).
  // /live-massive: Massive OPRA full-tape feed via FlowDB (canonical)
  // /live-flow:    Bullflow SSE alert feed (URL-only pending T2-6 merge)
  // 2026-07-19: no longer free — paid/admin only, falls through to the
  // standard isPaid gate below.
  if (location.pathname === '/live-flow' || location.pathname === '/live-massive') {
    return isPaid ? <Outlet /> : <Navigate to={FREE_HOME} replace />
  }

  const isFreePage = FREE_PAGES.some(p => location.pathname.startsWith(p))

  // isPaid = admin OR pro/premium/lifetime (single source of truth in AuthContext)
  if (!isPaid && !isFreePage) {
    return <Navigate to={FREE_HOME} replace />
  }

  return <Outlet />
}
