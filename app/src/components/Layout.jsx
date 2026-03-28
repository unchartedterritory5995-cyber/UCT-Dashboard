import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import NavBar from './NavBar'
import MobileNav from './MobileNav'
import FeedbackWidget from './FeedbackWidget'
import usePreferences from '../hooks/usePreferences'
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
  const { prefs } = usePreferences()

  // Apply theme to <html> element with system preference detection
  useEffect(() => {
    const applyTheme = (theme) => {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        // System: use oled for dark preference, dim for light
        document.documentElement.dataset.theme = prefersDark ? '' : 'dim'
        if (prefersDark) delete document.documentElement.dataset.theme
      } else if (theme && theme !== 'midnight') {
        document.documentElement.dataset.theme = theme
      } else {
        delete document.documentElement.dataset.theme
      }
    }

    applyTheme(prefs.theme)

    // Listen for OS theme changes when set to "system"
    if (prefs.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [prefs.theme])

  // Smooth theme transitions
  useEffect(() => {
    document.documentElement.style.transition = 'background-color 0.3s ease, color 0.3s ease'
    return () => { document.documentElement.style.transition = '' }
  }, [])

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
