import { useState, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
        fontFamily: "'Cinzel', serif", fontSize: 48, fontWeight: 700,
        color: '#c9a84c', letterSpacing: 12, marginBottom: 24,
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
  const { user, plan, loading } = useAuth()
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
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg)', color: 'var(--text-muted)',
        fontFamily: "'Instrument Sans', sans-serif", fontSize: '14px',
      }}>
        Loading...
      </div>
    )
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

  // Admin-only pages
  if (location.pathname.startsWith('/admin') && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  // Allow settings page always (so they can manage billing / subscribe)
  if (location.pathname === '/settings') {
    return <Outlet />
  }

  // Require paid plan for all other pages
  if (plan !== 'pro' && user.role !== 'admin') {
    return <Navigate to="/subscribe" replace />
  }

  return <Outlet />
}
