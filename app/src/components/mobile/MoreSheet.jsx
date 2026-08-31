import { useNavigate, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from './Sheet'
import UIcon from '../ui/UIcon'
import styles from './MoreSheet.module.css'
import uctLogo from '../intro/assets/compass-mark.png'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

// The single comprehensive mobile directory. Opened by both the bottom "More"
// tab and the top-bar menu button — one menu, branded icons (never emoji).
const NAV_SECTIONS = [
  {
    label: 'Core',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { to: '/morning-wire', label: 'Morning Wire', icon: 'wire' },
      { to: '/uct-20', label: 'UCT 20', icon: 'star' },
    ],
  },
  {
    label: 'Markets',
    items: [
      { to: '/breadth', label: 'Breadth', icon: 'breadth' },
      { to: '/options-flow', label: 'Options Flow', icon: 'flow' },
      { to: '/flow-scoreboard', label: 'Flow Record', icon: 'star' },
      { to: '/live-massive', label: 'Live Flow', icon: 'bolt' },
      { to: '/post-market', label: 'Post Market', icon: 'moon' },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/charts', label: 'Charts', icon: 'chart' },
      { to: '/ai-search', label: 'AI Search', icon: 'search' },
      { to: '/screener', label: 'Screener', icon: 'screener' },
      { to: '/calendar', label: 'Calendar', icon: 'calendar' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { to: '/model-book', label: 'Model Book', icon: 'book' },
      { to: '/desk', label: 'The Desk', icon: 'desk' },
      { to: '/journal', label: 'Journal', icon: 'journal' },
      { to: '/community', label: 'Community', icon: 'community' },
    ],
  },
  {
    label: 'Help',
    items: [
      // ⭐ THE VOCABULARY A MEMBER BUILDS INDICATORS WITH. Reachable ONLY by
      // typing the URL until this entry existed — and a page a member has to
      // already know about is not a reference. `/formulas/reference` is derived
      // wholly from the engine's manifest, so it can never be out of date.
      { to: '/formulas/reference', label: 'Formula reference', icon: 'library' },
      // ⭐⭐ AND WHAT OTHER MEMBERS PUBLISHED. A library nobody can find is
      // the same defect as a reference nobody can find, one shelf over — and
      // worse, because an empty-looking library reads as "nobody uses this"
      // rather than "you have not found the door".
      { to: '/formulas/library', label: 'Formula library', icon: 'book' },
      { to: '/support', label: 'Support', icon: 'chat' },
    ],
  },
]

// Keep in sync with FREE_PAGES in AuthGuard.jsx + NavBar.jsx.
const FREE_PAGES = ['/morning-wire']
const WEBSITE_URL = 'https://whop.com/uncharted/uncharted'

export default function MoreSheet({ open, onClose }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, plan, isPaid } = useAuth()
  const isAdmin = user?.role === 'admin'
  const showAll = isPaid  // admin + pro/premium/lifetime (AuthContext single source)

  const { data: pending } = useSWR(
    open && user ? '/api/voice/insights/pending' : null,
    fetcher,
    { refreshInterval: 30_000 },
  )
  const compassUnread = pending?.insights?.length || 0

  // Dark launch: hide the Community item until COMMUNITY_ENABLED is on
  // (mirrors the NavBar gate).
  const { data: communityStatus } = useSWR(
    open && user ? '/api/community/status' : null,
    fetcher,
    { refreshInterval: 120_000 },
  )

  if (!open) return null
  const go = (to) => { onClose?.(); navigate(to) }
  const isActive = (to) => pathname === to || pathname.startsWith(`${to}/`)

  const planLabel = isAdmin ? 'Admin'
    : isPaid ? (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Pro')
    : 'Free'

  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title="Menu">
      {/* Identity header */}
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {user?.id ? (
            <img
              src={`/api/auth/avatar/${user.id}`}
              alt=""
              className={styles.avatarImg}
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
            />
          ) : null}
          <span
            className={styles.avatarInitials}
            style={user?.id ? { display: 'none' } : undefined}
          >
            {(user?.display_name || user?.email || '?')[0].toUpperCase()}
          </span>
        </div>
        <div className={styles.profileText}>
          <span className={styles.profileName}>{user?.display_name || user?.email || 'Guest'}</span>
          <span className={styles.profilePlan}>
            <img className={styles.profileBrand} src={uctLogo} alt="" aria-hidden="true" />
            UCT Intelligence · {planLabel}
          </span>
        </div>
      </div>

      <div className={styles.list}>
        {NAV_SECTIONS.map((section) => {
          // Show every tool. Paid ones a free user can't open are dimmed + locked
          // and route to the upgrade page instead of being hidden.
          return (
            <div key={section.label} className={styles.section}>
              <div className={styles.sectionLabel}>{section.label}</div>
              {section.items
                .filter((l) => l.to !== '/community' || communityStatus?.enabled)
                .map((l) => {
                const locked = !showAll && !FREE_PAGES.includes(l.to)
                return (
                  <button
                    key={l.to}
                    type="button"
                    className={`${styles.item} ${isActive(l.to) ? styles.active : ''} ${locked ? styles.locked : ''}`}
                    aria-current={isActive(l.to) ? 'page' : undefined}
                    aria-label={locked ? `${l.label} — unlock with Pro` : undefined}
                    onClick={() => go(locked ? '/subscribe' : l.to)}
                  >
                    <span className={styles.icon} aria-hidden="true"><UIcon name={l.icon} size={20} /></span>
                    <span className={styles.itemLabel}>{l.label}</span>
                    {!locked && l.to === '/journal' && compassUnread > 0 && (
                      <span className={styles.badge}>{compassUnread > 9 ? '9+' : compassUnread}</span>
                    )}
                    <span className={styles.chev} aria-hidden="true">
                      <UIcon name={locked ? 'lock' : 'chevronRight'} size={16} />
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}

        {/* Account / footer */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Account</div>
          {isAdmin && (
            <button
              type="button"
              className={`${styles.item} ${isActive('/admin') ? styles.active : ''}`}
              onClick={() => go('/admin')}
            >
              <span className={styles.icon} aria-hidden="true"><UIcon name="shield" size={20} /></span>
              <span className={styles.itemLabel}>Admin</span>
              <span className={styles.chev} aria-hidden="true"><UIcon name="chevronRight" size={16} /></span>
            </button>
          )}
          <button
            type="button"
            className={`${styles.item} ${isActive('/settings') ? styles.active : ''} ${!showAll ? styles.locked : ''}`}
            aria-label={!showAll ? 'Settings — unlock with Pro' : undefined}
            onClick={() => go(showAll ? '/settings' : '/subscribe')}
          >
            <span className={styles.icon} aria-hidden="true"><UIcon name="gear" size={20} /></span>
            <span className={styles.itemLabel}>Settings</span>
            <span className={styles.chev} aria-hidden="true"><UIcon name={showAll ? 'chevronRight' : 'lock'} size={16} /></span>
          </button>
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.item}
            onClick={() => onClose?.()}
          >
            <span className={styles.icon} aria-hidden="true"><UIcon name="globe" size={20} /></span>
            <span className={styles.itemLabel}>Website</span>
            <span className={styles.chev} aria-hidden="true"><UIcon name="chevronRight" size={16} /></span>
          </a>
        </div>
      </div>
    </Sheet>
  )
}
