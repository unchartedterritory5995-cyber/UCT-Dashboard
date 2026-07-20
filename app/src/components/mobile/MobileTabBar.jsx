import { Link, useLocation } from 'react-router-dom'
import { useIsPaid } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import styles from './MobileTabBar.module.css'

// 4 routed tabs + a "More" button. `match` = path prefixes that light the tab.
// `paidOnly` tabs are hidden for free users; `freeOnly` tabs are hidden for
// paid users (free tier only gets Morning Wire, so it needs its own tab).
// `icon` = a UIcon name (branded line-icon set) — never raw emoji.
const TABS = [
  { key: 'home', label: 'Home', icon: 'dashboard', to: '/dashboard', match: ['/dashboard'], paidOnly: true },
  { key: 'wire', label: 'Wire', icon: 'wire', to: '/morning-wire', match: ['/morning-wire'], freeOnly: true },
  { key: 'markets', label: 'Markets', icon: 'markets', to: '/breadth',
    match: ['/breadth', '/options-flow', '/dark-pool', '/post-market', '/screener', '/patterns', '/calendar', '/catalysts'],
    paidOnly: true },
  { key: 'charts', label: 'Charts', icon: 'chart', to: '/charts',
    match: ['/charts', '/watchlists', '/theme-tracker'], paidOnly: true },
  { key: 'journal', label: 'Journal', icon: 'journal', to: '/journal', match: ['/journal'], paidOnly: true },
]

export default function MobileTabBar({ onMore }) {
  const { pathname } = useLocation()
  const isPaid = useIsPaid()
  const tabs = TABS.filter((t) => (isPaid ? !t.freeOnly : !t.paidOnly))
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
            <span className={styles.icon} aria-hidden="true"><UIcon name={t.icon} size={22} /></span>
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
        <span className={styles.icon} aria-hidden="true"><UIcon name="more" size={22} /></span>
        <span className={styles.label}>More</span>
      </button>
    </nav>
  )
}
