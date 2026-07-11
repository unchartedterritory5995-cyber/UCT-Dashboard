/**
 * Journal 2.0 — phone section nav (Task B5).
 *
 * A horizontal, scrollable segmented nav of the 5 primary surfaces
 * (Today · Trades · Journal · Insights · Compass) rendered at the TOP of the
 * journal content on phone, BELOW the header. It replaces the desktop tab rail
 * (`.nav`) on phone — NOT a second fixed BOTTOM bar (that would collide with the
 * app-wide `MobileTabBar`). Each item is a gold `UIcon` + label with a 44px tap
 * target; the row scrolls horizontally if the labels overflow the viewport.
 *
 * Show/hide is CSS-driven (`@media (max-width:640px)` in the module: the mobile
 * nav is `display:none` on desktop, the desktop rail is `display:none` on
 * phone) — NOT a JS `useIsPhone` branch, which reads stale at first paint in a
 * fixed mobile context (the documented `useMediaQuery` trap). So this component
 * is ALWAYS mounted; CSS decides where it shows.
 *
 * No emoji — every glyph is a `UIcon` (feedback_no_generic_emoji).
 */

import { NavLink } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import { useIsPaid } from '../../context/AuthContext'
import styles from './JournalMobileNav.module.css'

// Same 5 surfaces + icons as JournalLayout's PRIMARY_NAV. Kept as its own list
// (not imported) so the mobile treatment can diverge (icon-over-label) without
// coupling to the desktop rail's shape.
const MOBILE_NAV = [
  { to: '/journal', label: 'Today', icon: 'sun', end: true },
  { to: '/journal/trades', label: 'Trades', icon: 'equity' },
  { to: '/journal/journal', label: 'Journal', icon: 'journal' },
  { to: '/journal/insights', label: 'Insights', icon: 'chart' },
  { to: '/journal/compass', label: 'Compass', icon: 'compass', paidOnly: true },
]

export default function JournalMobileNav() {
  const isPaid = useIsPaid()

  return (
    <nav className={styles.mobileNav} aria-label="Journal sections (mobile)">
      {MOBILE_NAV.map((item) => {
        const locked = item.paidOnly && !isPaid
        if (locked) {
          // Compass while unpaid — a present-but-disabled teaser (never hidden),
          // mirroring the desktop rail's lock treatment (spec §61).
          return (
            <button
              key={item.to}
              type="button"
              disabled
              className={`${styles.item} ${styles.itemLocked}`}
              data-locked="true"
              title="Compass — upgrade to unlock AI coaching"
            >
              <span className={styles.icon} aria-hidden="true">
                <UIcon name={item.icon} size={18} />
              </span>
              <span className={styles.label}>{item.label}</span>
              <span className={styles.lock} aria-hidden="true">
                <UIcon name="lock" size={11} />
              </span>
            </button>
          )
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `${styles.item} ${isActive ? styles.itemActive : ''}`
            }
          >
            <span className={styles.icon} aria-hidden="true">
              <UIcon name={item.icon} size={18} />
            </span>
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
