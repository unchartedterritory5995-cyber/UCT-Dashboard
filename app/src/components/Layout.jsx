import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import NavBar from './NavBar'
import MobileNav from './MobileNav'
import FeedbackWidget from './FeedbackWidget'
import styles from './Layout.module.css'

function usePageTracking() {
  const location = useLocation()
  const lastPath = useRef(null)

  useEffect(() => {
    const path = location.pathname
    if (path === lastPath.current) return
    lastPath.current = path

    // Only track if user has a session cookie (logged in)
    if (!document.cookie.includes('uct_session')) return

    // Fire-and-forget — no await, no error handling
    fetch('/api/auth/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: path }),
    }).catch(() => {})
  }, [location.pathname])
}

export default function Layout({ children }) {
  usePageTracking()

  return (
    <div className={styles.shell}>
      {/* Desktop sidebar — hidden on mobile via CSS */}
      <NavBar />
      {/* Mobile header + drawer — hidden on desktop via CSS */}
      <MobileNav />
      <main className={styles.main}>
        {children ?? <Outlet />}
      </main>
      <FeedbackWidget />
    </div>
  )
}
