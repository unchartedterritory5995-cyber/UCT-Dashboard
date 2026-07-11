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
  { to: '/live-massive', label: 'Live Flow',     icon: 'bolt' },
  { to: '/post-market',  label: 'Post Market',   icon: 'moon' },
  { to: '/model-book',   label: 'Model Book',    icon: 'book' },
  { to: '/desk',         label: 'The Desk',      icon: 'desk' },
  { to: '/journal',      label: 'Journal',       icon: 'journal' },
  { to: '/community',    label: 'Community',     icon: 'community' },
  { to: '/support',      label: 'Support',       icon: 'chat' },
]

const WEBSITE_URL = 'https://whop.com/uncharted/uncharted'

// Keep in sync with FREE_PAGES in AuthGuard.jsx + MoreSheet.jsx.
const FREE_PAGES = ['/dashboard', '/breadth', '/charts', '/options-flow', '/live-massive', '/flow-scoreboard', '/journal', '/model-book']

export default function NavBar() {
  const { user, isPaid } = useAuth()
  const isAdmin = user?.role === 'admin'
  const showAll = isPaid  // admin + pro/premium/lifetime (AuthContext single source)

  // P5-C unification: Compass unread count on the Journal nav link.
  // Polls /api/voice/insights/pending every 30s. Voice/Compass is paid-only
  // (mirrors GlobalVoiceGate's isPaid check), so only poll for paid users —
  // the badge is meaningless without voice access, and this was firing on
  // every page for every logged-in user otherwise. (2026-07-01 perf pass)
  const { data: pending } = useSWR(
    isPaid ? '/api/voice/insights/pending' : null,
    fetcher,
    { refreshInterval: 30_000 },
  )
  const compassUnread = pending?.insights?.length || 0

  // The Floor (community) — dark-launch gate + unread badge. Status poll is
  // cheap (2-min) and gates the nav item entirely while COMMUNITY_ENABLED is off.
  const { data: communityStatus } = useSWR(user ? '/api/community/status' : null, fetcher, {
    refreshInterval: 120_000,
  })
  const { data: communityUnread } = useSWR(
    communityStatus?.enabled && isPaid ? '/api/community/unread' : null,
    fetcher,
    { refreshInterval: 30_000 },
  )
  // Nav badge = forum-board unread + unseen @-mentions (the high-signal pull-back).
  // Pulse chat volume is deliberately NOT counted here (it would be permanent noise
  // during market hours); its aliveness shows inside /community via The Tape.
  const floorUnread = (communityUnread?.total || 0) + (communityStatus?.mentions_unseen || 0)

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
        {NAV_ITEMS.map(item => {
          // Dark launch: hide The Floor entirely until COMMUNITY_ENABLED is on.
          if (item.to === '/community' && !communityStatus?.enabled) return null
          // Show paid tools instead of hiding them — a free user can't want what
          // they can't see. Locked rows are dimmed with a gold lock and route to
          // the upgrade page rather than the tool.
          const locked = !showAll && !FREE_PAGES.includes(item.to)
          if (locked) {
            return (
              <Link
                key={item.to}
                to="/subscribe"
                className={`${styles.item} ${styles.locked}`}
                title={`${item.label} — unlock with Pro`}
                aria-label={`${item.label} — unlock with Pro`}
              >
                <span className={styles.icon} aria-hidden="true"><UIcon name={item.icon} gold /></span>
                <span className={styles.label}>{item.label}</span>
                <span className={styles.lock} aria-hidden="true"><UIcon name="lock" size={11} gold /></span>
              </Link>
            )
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')
              }
              title={item.label}
              aria-label={item.label}
            >
              <span className={styles.icon} aria-hidden="true"><UIcon name={item.icon} gold /></span>
              <span className={styles.label}>{item.label}</span>
              {item.to === '/journal' && compassUnread > 0 && (
                <span className={styles.compassBadge}
                      title={`${compassUnread} Compass insight${compassUnread === 1 ? '' : 's'} waiting`}>
                  {compassUnread > 9 ? '9+' : compassUnread}
                </span>
              )}
              {item.to === '/community' && floorUnread > 0 && (
                <span className={styles.compassBadge} title={`${floorUnread} unread`}>
                  {floorUnread > 9 ? '9+' : floorUnread}
                </span>
              )}
            </NavLink>
          )
        })}
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
            <span className={styles.icon} aria-hidden="true"><UIcon name="shield" gold /></span>
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
          <span className={styles.icon} aria-hidden="true"><UIcon name="gear" gold /></span>
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
          <span className={styles.icon} aria-hidden="true"><UIcon name="globe" gold /></span>
          <span className={styles.label}>Website</span>
        </a>
      </div>
    </nav>
  )
}
