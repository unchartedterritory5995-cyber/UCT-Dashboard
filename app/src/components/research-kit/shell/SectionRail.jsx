// app/src/components/research-kit/shell/SectionRail.jsx
import { useRef } from 'react'
import UIcon from '../../ui/UIcon'
import styles from './SectionRail.module.css'

/**
 * Roving-tabindex target for a key press, or -1 when the key is not ours.
 *
 * Handles BOTH axes deliberately: the same list is a vertical rail on desktop
 * and a horizontal chip row on phone, and reading the viewport in JS at first
 * paint is the known stale trap (useMediaQuery seeds at mount). CSS switches the
 * layout; the semantics and the key handling never change.
 */
export function nextIndex(current, key, count) {
  if (!count || count <= 0) return -1
  const i = Number.isInteger(current) && current >= 0 ? current : 0
  if (key === 'ArrowDown' || key === 'ArrowRight') return (i + 1) % count
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (i - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return -1
}

/**
 * The section rail (spec §4.1/§5.1) — the shared navigator for the modal's left
 * pane and the research page.
 *
 * `sections` are TABS (they swap the canvas beside them). `links` are LINKS:
 * §4.3's "Analyst & Ownership" and "Filings" deep-open the /research section, so
 * they live in a sibling group and are never announced as "tab 6 of 7" for
 * something that navigates away.
 *
 * Tablist semantics with roving tabindex: exactly one tab is in the tab order,
 * arrows move selection AND focus, Home/End jump to the ends.
 *
 * `aria-controls` is only ever stamped on the ACTIVE tab (review round 1,
 * item 6). A consuming canvas that unmounts its inactive panels (P2's GATE c,
 * `EarningsResearchModal`'s own `<Panel/>`) has no element at
 * `{idPrefix}-panel-{id}` for the other tabs to point at — three of four
 * `aria-controls` IDREFs would dangle, pointing at nothing, on every render.
 */
export default function SectionRail({
  sections,
  links,
  active,
  onSelect,
  idPrefix = 'rk-rail',
  ariaLabel = 'Sections',
  // Opt-IN row tightening for a pointer:fine device. `--tap-min` (44px) is a
  // TOUCH target floor; on a mouse it is simply oversized, and 12 sections at
  // 44px is ~570px of rail beside a dense canvas. Default FALSE so the two
  // other consumers of this rail — ResearchPage and CatalystFlow — keep the
  // geometry they were designed with; only a caller that has looked at its own
  // layout opts in. Touch keeps the full floor either way: the CSS is behind
  // `@media (pointer: fine)`, so this prop cannot shrink a thumb target.
  dense = false,
  className = '',
}) {
  const list = Array.isArray(sections) ? sections : []
  const linkList = Array.isArray(links) ? links : []
  const refs = useRef([])

  const activeIdx = Math.max(0, list.findIndex((s) => s.id === active))
  // The tablist's roving tabindex must land SOMEWHERE reachable even when
  // `active` matches nothing in `list` (a stale id, or null before the first
  // section is chosen): `activeIdx` already falls back to 0 above, but
  // `isActive` used to compare against the raw `active` prop, so an unmatched
  // id left EVERY tab's tabIndex at -1 — a tablist the keyboard can't enter.
  // Deriving the compared id from the same fallback index keeps both in sync.
  const activeId = list[activeIdx]?.id

  const onKeyDown = (e) => {
    const target = nextIndex(activeIdx, e.key, list.length)
    if (target < 0) return
    e.preventDefault()
    const nextId = list[target]?.id
    if (nextId && onSelect) onSelect(nextId)
    refs.current[target]?.focus()
  }

  // The nav landmark gets its own accessible name too — it wraps the non-tab
  // `links` group (§4.3) as well as the tablist, so it is a distinct landmark
  // concern from the tablist's own aria-label, not a duplicate of it.
  return (
    // `data-rk-dense` is the density's ONE authority: the CSS selects on it and
    // a test can read it. A hashed CSS-module class name would be neither
    // greppable nor assertable without coupling to Vite's scoping scheme —
    // the coupling research-kit/testing/restraint.js retired for exactly this.
    <nav
      className={`${styles.rail} ${className}`}
      data-rk-dense={dense || undefined}
      aria-label={ariaLabel}
    >
      <div className={styles.tabs} role="tablist" aria-label={ariaLabel} aria-orientation="vertical">
        {list.map((s, i) => {
          const isActive = s.id === activeId
          return (
            <button
              key={s.id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${s.id}`}
              aria-controls={isActive ? `${idPrefix}-panel-${s.id}` : undefined}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              onClick={() => onSelect && onSelect(s.id)}
              onKeyDown={onKeyDown}
            >
              {s.icon && <UIcon name={s.icon} size={14} gold={false} className={styles.icon} />}
              <span className={styles.itemLabel}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {linkList.length > 0 && (
        <div className={styles.links}>
          {linkList.map((l) => (
            <a key={l.id} className={`${styles.item} ${styles.linkItem}`} href={l.href}>
              {l.icon && <UIcon name={l.icon} size={14} gold={false} className={styles.icon} />}
              <span className={styles.itemLabel}>{l.label}</span>
              <UIcon name="chevronRight" size={12} gold={false} className={styles.linkChevron} />
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}
