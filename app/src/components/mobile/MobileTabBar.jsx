import { Link, useLocation } from 'react-router-dom'
import { useIsPaid } from '../../context/AuthContext'
import styles from './MobileTabBar.module.css'

// 4 routed tabs + a "More" button. `match` = path prefixes that light the tab.
// `paidOnly` tabs are hidden for free users (Home → /dashboard is paid-only).
const TABS = [
  { key: 'home', label: 'Home', icon: '⌂', to: '/dashboard', match: ['/dashboard'], paidOnly: true },
  { key: 'markets', label: 'Markets', icon: '◳', to: '/breadth',
    match: ['/breadth', '/options-flow', '/dark-pool', '/post-market', '/screener', '/patterns', '/calendar', '/catalysts'] },
  { key: 'charts', label: 'Charts', icon: '📈', to: '/charts',
    match: ['/charts', '/watchlists', '/theme-tracker', '/multi-chart'] },
  { key: 'journal', label: 'Journal', icon: '📓', to: '/journal', match: ['/journal'] },
]

export default function MobileTabBar({ onMore }) {
  const { pathname } = useLocation()
  const isPaid = useIsPaid()
  const tabs = TABS.filter((t) => isPaid || !t.paidOnly)
  const matchesMore = !tabs.some((t) => t.match.some((p) => pathname.startsWith(p)))

  return (
    <nav className={styles.bar} role="navigation" aria-label="Primary">
      {tabs.map((t) => {
        const active = t.match.some((p) => pathname.startsWith(p))
        return (
          <Link
            key={t.key}
            to={t.to}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">{t.icon}</span>
            <span className={styles.label}>{t.label}</span>
          </Link>
        )
      })}
      <button
        type="button"
        className={`${styles.tab} ${matchesMore ? styles.active : ''}`}
        onClick={onMore}
        aria-current={matchesMore ? 'page' : undefined}
      >
        <span className={styles.icon} aria-hidden="true">⋯</span>
        <span className={styles.label}>More</span>
      </button>
    </nav>
  )
}
