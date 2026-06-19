// app/src/components/NavBar.jsx
import { NavLink, Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'
import AlertBell from './AlertBell'
import styles from './NavBar.module.css'
import uctLogo from './intro/assets/compass-mark.png'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/uct-20',       label: 'UCT 20',        icon: '⭐' },
  { to: '/breadth',      label: 'Breadth',       icon: '📶' },
  { to: '/charts',       label: 'Charts',        icon: '📈' },
  { to: '/calendar',     label: 'Calendar',      icon: '📅' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/patterns',     label: 'Patterns',      icon: '🎯' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',   label: 'Model Book',    icon: '📖' },
  { to: '/setup-library',label: 'Setup Library', icon: '📚' },
  { to: '/journal',      label: 'Journal',       icon: '📓' },
  { to: '/support',      label: 'Support',       icon: '💬' },
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
            <span className={styles.icon} aria-hidden="true">{item.icon}</span>
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
            <span className={styles.icon} aria-hidden="true">{'\uD83D\uDD12'}</span>
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
          <span className={styles.icon} aria-hidden="true">⚙️</span>
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
          <span className={styles.icon} aria-hidden="true">🌐</span>
          <span className={styles.label}>Website</span>
        </a>
      </div>
    </nav>
  )
}
