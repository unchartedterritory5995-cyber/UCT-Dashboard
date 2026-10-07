/**
 * Journal 2.0 — phone section nav (Task B5).
 *
 * A horizontal, scrollable segmented nav of the 6 primary surfaces
 * (Today · Trades · Calendar · Notebook · Insights · Compass) rendered at the TOP of the
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
import useRovingTabIndex from '../../hooks/useRovingTabIndex'
import { NOTEBOOK_PATH } from './lib/journalRoutes'
import styles from './JournalMobileNav.module.css'

// Same 6 surfaces + icons as JournalLayout's PRIMARY_NAV. Kept as its own list
// (not imported) so the mobile treatment can diverge (icon-over-label) without
// coupling to the desktop rail's shape.
const MOBILE_NAV = [
  { to: '/journal', label: 'Today', icon: 'sun', end: true },
  { to: '/journal/trades', label: 'Trades', icon: 'equity' },
  { to: '/journal/calendar', label: 'Calendar', icon: 'calendar' },
  { to: NOTEBOOK_PATH, label: 'Notebook', icon: 'journal' },
  { to: '/journal/insights', label: 'Insights', icon: 'chart' },
  { to: '/journal/compass', label: 'Compass', icon: 'compass', paidOnly: true },
]

export default function JournalMobileNav() {
  const isPaid = useIsPaid()

  // Wave 13 (13Q-4): the same roving-tabindex treatment as the desktop rail
  // in JournalLayout.jsx (one Tab stop, Arrow/Home/End move focus) — this
  // component mirrors the same 6 surfaces for the phone width, where the
  // click-budget instrument measured the same shared-chrome cost. See
  // useRovingTabIndex.js and docs/notebook/wave13-13q2.md §4.
  const { containerProps: mobileNavRovingProps, itemProps: mobileNavItemProps } =
    useRovingTabIndex({ orientation: 'horizontal' })

  return (
    <nav
      className={styles.mobileNav}
      aria-label="Journal sections (mobile)"
      {...mobileNavRovingProps}
    >
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
              {...mobileNavItemProps(item.to, { disabled: true })}
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
            {...mobileNavItemProps(item.to)}
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
