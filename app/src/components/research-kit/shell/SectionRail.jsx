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
 */
export default function SectionRail({
  sections,
  links,
  active,
  onSelect,
  idPrefix = 'rk-rail',
  ariaLabel = 'Sections',
  className = '',
}) {
  const list = Array.isArray(sections) ? sections : []
  const linkList = Array.isArray(links) ? links : []
  const refs = useRef([])

  const activeIdx = Math.max(0, list.findIndex((s) => s.id === active))

  const onKeyDown = (e) => {
    const target = nextIndex(activeIdx, e.key, list.length)
    if (target < 0) return
    e.preventDefault()
    const nextId = list[target]?.id
    if (nextId && onSelect) onSelect(nextId)
    refs.current[target]?.focus()
  }

  return (
    <nav className={`${styles.rail} ${className}`}>
      <div className={styles.tabs} role="tablist" aria-label={ariaLabel} aria-orientation="vertical">
        {list.map((s, i) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${s.id}`}
              aria-controls={`${idPrefix}-panel-${s.id}`}
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
