// app/src/components/MobileNav.jsx — Full-screen drawer nav for mobile
import { useState, useEffect, useCallback } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AlertBell from './AlertBell'
import useKeyboardVisible from '../hooks/useKeyboardVisible'
import styles from './MobileNav.module.css'

const NAV_SECTIONS = [
  {
    label: 'Core',
    items: [
      { to: '/dashboard',    label: 'Dashboard',     icon: '\u229E' },
      { to: '/morning-wire', label: 'Morning Wire',  icon: '\uD83D\uDCF0' },
      { to: '/uct-20',       label: 'UCT 20',        icon: '\u2B50' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/breadth',        label: 'Breadth',        icon: '\uD83D\uDCF6' },
      { to: '/theme-tracker',  label: 'Theme Tracker',  icon: '\uD83C\uDFAF' },
      { to: '/calendar',       label: 'Calendar',       icon: '\uD83D\uDCC5' },
      { to: '/screener',       label: 'Screener',       icon: '\u26A1' },
    ],
  },
  {
    label: 'Flow',
    items: [
      { to: '/options-flow', label: 'Options Flow', icon: '\uD83D\uDCCA' },
      { to: '/dark-pool',    label: 'Dark Pool',    icon: '\uD83C\uDF0A' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { to: '/traders',     label: 'Traders',     icon: '\uD83D\uDC65' },
      { to: '/post-market', label: 'Post Market', icon: '\uD83C\uDF19' },
      { to: '/model-book',  label: 'Model Book',  icon: '\uD83D\uDCD6' },
      { to: '/journal',     label: 'Journal',     icon: '\uD83D\uDCD3' },
      { to: '/watchlists',  label: 'Watchlists',  icon: '\uD83D\uDCCB' },
    ],
  },
  {
    label: 'Social',
    items: [
      { to: '/community', label: 'Community', icon: '\uD83D\uDCCA' },
    ],
  },
]

const WEBSITE_URL = 'https://whop.com/uncharted/uncharted'

// Flat lookup for page title
const ALL_ITEMS = NAV_SECTIONS.flatMap(s => s.items)

// Routes outside NAV_SECTIONS (footer links, etc.)
const EXTRA_ROUTES = {
  '/settings': 'Settings',
  '/website': 'Website',
  '/admin': 'Admin',
}

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const keyboardOpen = useKeyboardVisible()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Get current page title for header
  const currentItem = ALL_ITEMS.find(i => location.pathname.startsWith(i.to))
  const pageTitle = currentItem?.label
    || EXTRA_ROUTES[location.pathname]
    || 'UCT'

  // Close drawer on route change
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // Lock body scroll when drawer open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Close on escape
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') setOpen(false)
  }, [])

  useEffect(() => {
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, handleKey])

  return (
    <>
      {/* ── Fixed top header bar ── */}
      <header className={styles.topBar} style={{ transform: keyboardOpen ? 'translateY(-100%)' : 'none', transition: 'transform 0.2s ease' }}>
        <button
          className={styles.hamburger}
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <div className={`${styles.hamburgerLine} ${open ? styles.hamburgerOpen1 : ''}`} />
          <div className={`${styles.hamburgerLine} ${open ? styles.hamburgerOpen2 : ''}`} />
          <div className={`${styles.hamburgerLine} ${open ? styles.hamburgerOpen3 : ''}`} />
        </button>
        <span className={styles.pageTitle}>{pageTitle}</span>
        <div className={styles.topBarRight}>
          <AlertBell />
        </div>
      </header>

      {/* ── Backdrop ── */}
      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/* ── Slide-out drawer ── */}
      <nav className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`} role="navigation" aria-label="Main navigation">
        <div className={styles.drawerHeader}>
          <span className={styles.brand}>UCT</span>
          <span className={styles.brandSub}>Intelligence Engine</span>
        </div>

        <div className={styles.drawerScroll}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className={styles.section}>
              <div className={styles.sectionLabel}>{section.label}</div>
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.drawerItem, isActive ? styles.drawerItemActive : ''].filter(Boolean).join(' ')
                  }
                >
                  <span className={styles.drawerIcon}>{item.icon}</span>
                  <span className={styles.drawerLabel}>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}

          {/* Bottom section */}
          <div className={styles.drawerFooter}>
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  [styles.drawerItem, isActive ? styles.drawerItemActive : ''].filter(Boolean).join(' ')
                }
              >
                <span className={styles.drawerIcon}>{'\uD83D\uDD12'}</span>
                <span className={styles.drawerLabel}>Admin</span>
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                [styles.drawerItem, isActive ? styles.drawerItemActive : ''].filter(Boolean).join(' ')
              }
            >
              <span className={styles.drawerIcon}>{'\u2699\uFE0F'}</span>
              <span className={styles.drawerLabel}>Settings</span>
            </NavLink>
            <a
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.drawerItem}
            >
              <span className={styles.drawerIcon}>{'\uD83C\uDF10'}</span>
              <span className={styles.drawerLabel}>Website</span>
              <span className={styles.externalArrow}>{'\u2197'}</span>
            </a>
          </div>
        </div>
      </nav>
    </>
  )
}
