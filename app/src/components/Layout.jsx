import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import NavBar from './NavBar'
import MobileNav from './MobileNav'
import FeedbackWidget from './FeedbackWidget'
import MobileTabBar from './mobile/MobileTabBar'
import MoreSheet from './mobile/MoreSheet'
import { TickerHubProvider } from './mobile/TickerHubContext'
import TickerHubSheet from './mobile/TickerHubSheet'
import usePreferences from '../hooks/usePreferences'
import { initBarsPack } from '../lib/barsPackClient'
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

  // Pre-seed IndexedDB with the Universe Bars Pack so D/W/M charts are instant
  // on first view. Idle-deferred + idempotent + safe on any failure; only runs
  // inside the authed shell (never for anonymous landing-page visitors).
  useEffect(() => { initBarsPack() }, [])

  // Apply the app theme to the <html> element.
  //
  // Two ALWAYS-PRESENT base themes: 'oled' (default) and 'light'. The legacy
  // 'midnight' / 'dim' / 'system' options were removed 2026-08-23 — any account
  // still holding one of those values resolves to OLED here (we never fall back
  // to bare :root, so the retired Midnight-green palette can no longer render).
  // 'light' is the only value that sets data-theme="light". Everything else —
  // including the future 'uct:<id>' custom-theme values, which are applied by a
  // separate effect — falls through to OLED as the safe base until that lands.
  useEffect(() => {
    const t = prefs.theme
    if (t === 'light') {
      document.documentElement.dataset.theme = 'light'
    } else {
      document.documentElement.dataset.theme = 'oled'
    }
  }, [prefs.theme])

  // Smooth theme transitions
  useEffect(() => {
    document.documentElement.style.transition = 'background-color 0.3s ease, color 0.3s ease'
    return () => { document.documentElement.style.transition = '' }
  }, [])

  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <TickerHubProvider>
      <div className={styles.shell}>
        {/* Desktop sidebar — hidden at <=1024px via CSS */}
        <NavBar />
        {/* Mobile top bar — shown at <=1024px via CSS. Its menu button opens
            the same unified MoreSheet as the bottom tab bar's "More". */}
        <MobileNav onMenu={() => setMoreOpen(true)} />
        <main className={styles.main}>
          {children ?? <Outlet />}
        </main>
        <FeedbackWidget />
        {/* Mobile primary nav + global hosts (self-hide on desktop) */}
        <MobileTabBar onMore={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
        <TickerHubSheet />
      </div>
    </TickerHubProvider>
  )
}
