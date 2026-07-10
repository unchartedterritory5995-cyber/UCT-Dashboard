// app/src/components/MobileNav.jsx — Mobile top bar (title + menu + movers + alerts)
//
// The full navigation directory lives in the unified MoreSheet (opened by both
// this menu button and the bottom tab bar's "More"). This component is just the
// fixed top header: a menu trigger, the current page title, a movers shortcut,
// and the alert bell.
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import AlertBell from './AlertBell'
import UIcon from './ui/UIcon'
import useKeyboardVisible from '../hooks/useKeyboardVisible'
import Sheet from './mobile/Sheet'
import MoversSidebar from './MoversSidebar'
import styles from './MobileNav.module.css'

// Flat route → title map (longest-prefix wins for nested routes).
const ROUTE_TITLES = {
  '/dashboard': 'Dashboard',
  '/morning-wire': 'Morning Wire',
  '/uct-20': 'UCT 20',
  '/breadth': 'Breadth',
  '/charts': 'Charts',
  '/calendar': 'Calendar',
  '/screener': 'Screener',
  '/patterns': 'Patterns',
  '/options-flow': 'Options Flow',
  '/dark-pool': 'Dark Pool',
  '/post-market': 'Post Market',
  '/model-book': 'Model Book',
  '/setup-library': 'Setup Library',
  '/desk': 'The Desk',
  '/journal': 'Journal',
  '/community': 'Community',
  '/support': 'Support',
  '/settings': 'Settings',
  '/admin': 'Admin',
  '/research': 'Research',
}

function titleFor(pathname) {
  const match = Object.keys(ROUTE_TITLES)
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0]
  return match ? ROUTE_TITLES[match] : 'UCT'
}

export default function MobileNav({ onMenu }) {
  const [moversOpen, setMoversOpen] = useState(false)
  const location = useLocation()
  const keyboardOpen = useKeyboardVisible()

  const pageTitle = titleFor(location.pathname)

  return (
    <>
      {/* ── Fixed top header bar ── */}
      <header
        className={styles.topBar}
        style={{ transform: keyboardOpen ? 'translateY(-100%)' : 'none', transition: 'transform 0.2s ease' }}
      >
        <button
          className={styles.hamburger}
          onClick={() => onMenu?.()}
          aria-label="Open menu"
        >
          <div className={styles.hamburgerLine} />
          <div className={styles.hamburgerLine} />
          <div className={styles.hamburgerLine} />
        </button>
        <span className={styles.pageTitle}>{pageTitle}</span>
        <div className={styles.topBarRight}>
          <button
            className={styles.moversBtn}
            onClick={() => setMoversOpen(true)}
            aria-label="Market movers"
          >
            <UIcon name="equity" size={20} />
          </button>
          <AlertBell />
        </div>
      </header>

      {/* ── Movers bottom-sheet (the desktop right-rail's mobile home) ── */}
      {moversOpen && (
        <Sheet open onClose={() => setMoversOpen(false)} variant="bottom-sheet" title="Movers">
          <MoversSidebar />
        </Sheet>
      )}
    </>
  )
}
