// app/src/components/NavBar.jsx
import { NavLink, Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'
import AlertBell from './AlertBell'
import UIcon from './ui/UIcon'
import { NAV_GROUPS } from './navGroups'
import styles from './NavBar.module.css'
import uctLogo from './intro/assets/compass-mark.png'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

// Exported so navGroups.test.js can verify every entry maps into exactly one
// NAV_GROUPS bucket, without restating this list a second time in the test.
export const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: 'dashboard' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: 'wire' },
  { to: '/charts',       label: 'Charts',        icon: 'equity' },
  { to: '/ai-search',    label: 'AI Search',     icon: 'sparkle' },
  { to: '/uct-20',       label: 'UCT 20',        icon: 'star' },
  { to: '/breadth',      label: 'Breadth',       icon: 'breadth' },
  { to: '/calendar',     label: 'Calendar',      icon: 'calendar' },
  { to: '/screener',     label: 'Screener',      icon: 'screener' },
  { to: '/options-flow', label: 'Options Flow',  icon: 'flow' },
  { to: '/flow-scoreboard', label: 'Flow Record',  icon: 'star' },
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
const FREE_PAGES = ['/morning-wire']

// Bucket NAV_ITEMS under the shared taxonomy's groups (./navGroups.js) —
// MobileTabBar's bottom tab bar groups the same routes, so the two surfaces
// derive from one authority instead of drifting the way desktop's flat
// 16-icon rail had from mobile's four labeled tabs. Each item keeps its
// original relative order WITHIN its group; an item whose `to` isn't listed
// in any group's `routes` falls into a headingless trailing bucket rather
// than silently vanishing.
const GROUPED_NAV_ITEMS = (() => {
  const byKey = new Map(NAV_GROUPS.map((g) => [g.key, { ...g, items: [] }]))
  const orphans = []
  for (const item of NAV_ITEMS) {
    const group = NAV_GROUPS.find((g) => g.routes.includes(item.to))
    if (group) byKey.get(group.key).items.push(item)
    else orphans.push(item)
  }
  const groups = NAV_GROUPS.map((g) => byKey.get(g.key))
  if (orphans.length) groups.push({ key: '_ungrouped', label: null, items: orphans })
  return groups
})()

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

  // One item's row — pulled out of the group loop below so grouping doesn't
  // duplicate the locked/badge logic per group.
  function renderItem(item) {
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
  }

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
        {GROUPED_NAV_ITEMS.map((group) => (
          <div key={group.key} className={styles.navGroup}>
            {group.label && <div className={styles.groupLabel}>{group.label}</div>}
            {group.items.map(renderItem)}
          </div>
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
            <span className={styles.icon} aria-hidden="true"><UIcon name="shield" gold /></span>
            <span className={styles.label}>Admin</span>
          </NavLink>
        )}
        {showAll ? (
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
        ) : (
          <Link
            to="/subscribe"
            className={`${styles.item} ${styles.locked}`}
            title="Settings — unlock with Pro"
            aria-label="Settings — unlock with Pro"
          >
            <span className={styles.icon} aria-hidden="true"><UIcon name="gear" gold /></span>
            <span className={styles.label}>Settings</span>
            <span className={styles.lock} aria-hidden="true"><UIcon name="lock" size={11} gold /></span>
          </Link>
        )}
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
