import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthGuard() {
  const { user, plan, loading } = useAuth()
  const location = useLocation()

  if (loading) {
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

  if (!user) {
    return <Navigate to="/login" replace />
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
