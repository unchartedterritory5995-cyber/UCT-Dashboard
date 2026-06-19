// app/src/components/NavBar.jsx
import { NavLink, Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'
import AlertBell from './AlertBell'
import UIcon from './ui/UIcon'
import styles from './NavBar.module.css'
import uctLogo from './intro/assets/compass-mark.png'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: 'dashboard' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: 'wire' },
  { to: '/uct-20',       label: 'UCT 20',        icon: 'star' },
  { to: '/breadth',      label: 'Breadth',       icon: 'breadth' },
  { to: '/charts',       label: 'Charts',        icon: 'chart' },
  { to: '/calendar',     label: 'Calendar',      icon: 'calendar' },
  { to: '/screener',     label: 'Screener',      icon: 'screener' },
  { to: '/patterns',     label: 'Patterns',      icon: 'patterns' },
  { to: '/options-flow', label: 'Options Flow',  icon: 'flow' },
  { to: '/post-market',  label: 'Post Market',   icon: 'moon' },
  { to: '/model-book',   label: 'Model Book',    icon: 'book' },
  { to: '/setup-library',label: 'Setup Library', icon: 'library' },
  { to: '/educational-videos', label: 'Educational Videos', icon: 'education' },
  { to: '/journal',      label: 'Journal',       icon: 'journal' },
  { to: '/support',      label: 'Support',       icon: 'chat' },
]

const WEBSITE_URL = 'https://whop.com/uncharted/uncharted'

const FREE_PAGES = ['/breadth', '/charts', '/options-flow', '/journal']

export default function NavBar() {
  const { user, plan } = useAuth()
  const isAdmin = user?.role === 'admin'
  const showAll = plan === 'pro' || isAdmin

  // P5-C unification: Compass unread count on the Journal nav link.
  // Polls /api/voice/insights/pending every 30s. Quietly silent when
  // the user isn't authenticated or doesn't have voice access.
  const { data: pending } = useSWR(
    user ? '/api/voice/insights/pending' : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  )
  const compassUnread = pending?.insights?.length || 0

  return (
    <nav data-testid="nav-sidebar" className={styles.nav}>
      <Link
        to="/landing"
        className={styles.brand}
        title="UCT Intelligence — home"
        aria-label="UCT Intelligence — go to landing page"
      >
        <img className={styles.brandLogo} src={uctLogo} alt="UCT" />
        <span className={styles.brandName}>
          <span className={styles.brandNameTop}>UCT</span>
          <span className={styles.brandNameSub}>INTELLIGENCE</span>
        </span>
      </Link>

      <div className={styles.mainItems}>
        {NAV_ITEMS.filter(item => showAll || FREE_PAGES.includes(item.to)).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
            }
            title={item.label}
            aria-label={item.label}
          >
            <span className={styles.icon} aria-hidden="true"><UIcon name={item.icon} /></span>
            <span className={styles.label}>{item.label}</span>
            {item.to === '/journal' && compassUnread > 0 && (
              <span className={styles.compassBadge}
                    title={`${compassUnread} Compass insight${compassUnread === 1 ? '' : 's'} waiting`}>
                {compassUnread > 9 ? '9+' : compassUnread}
              </span>
            )}
          </NavLink>
        ))}
      </div>
      <div className={styles.bottomItems}>
        <div className={styles.alertSlot}>
          <AlertBell />
        </div>
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
            }
            title="Admin"
            aria-label="Admin"
          >
            <span className={styles.icon} aria-hidden="true"><UIcon name="shield" /></span>
            <span className={styles.label}>Admin</span>
          </NavLink>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
          }
          title="Settings"
          aria-label="Settings"
        >
          <span className={styles.icon} aria-hidden="true"><UIcon name="gear" /></span>
          <span className={styles.label}>Settings</span>
        </NavLink>
        <a
          href={WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.item}
          title="UCT Website"
          aria-label="UCT Website"
        >
          <span className={styles.icon} aria-hidden="true"><UIcon name="globe" /></span>
          <span className={styles.label}>Website</span>
        </a>
      </div>
    </nav>
  )
}
