import { Link, useLocation } from 'react-router-dom'
import { useIsPaid } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import { NAV_GROUPS } from '../navGroups'
import styles from './MobileTabBar.module.css'

// 4 routed tabs + a "More" button. `match` = path prefixes that light the tab.
// `paidOnly` tabs are hidden for free users; `freeOnly` tabs are hidden for
// paid users (free tier only gets Morning Wire, so it needs its own tab).
// `icon` = a UIcon name (branded line-icon set) — never raw emoji.
//
// Derived from NAV_GROUPS (../navGroups.js) — the shared taxonomy NavBar's
// desktop rail groups by too, so the two surfaces cannot drift apart. Each
// group becomes one tab: `routes` becomes `match`, `routes[0]` becomes `to`.
// The one exception is `home`: its group bundles /dashboard + /morning-wire
// into a single taxonomy bucket, but free vs paid users need mutually
// exclusive TABS for them (the free tier gets ONLY Morning Wire) — that
// per-tier split is mobile-specific presentation, not part of the shared
// taxonomy, so Home/Wire stay two hand-built entries reading routes[0]/[1]
// off the group rather than retyping either path.
const HOME_GROUP = NAV_GROUPS.find((g) => g.key === 'home')
const OTHER_GROUPS = NAV_GROUPS.filter((g) => g.key !== 'home')

const TABS = [
  { key: 'home', label: 'Home', icon: 'dashboard', to: HOME_GROUP.routes[0], match: [HOME_GROUP.routes[0]], paidOnly: true },
  { key: 'wire', label: 'Wire', icon: 'wire', to: HOME_GROUP.routes[1], match: [HOME_GROUP.routes[1]], freeOnly: true },
  ...OTHER_GROUPS.map((g) => ({
    key: g.key, label: g.label, icon: g.icon, to: g.routes[0], match: g.routes, paidOnly: true,
  })),
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
