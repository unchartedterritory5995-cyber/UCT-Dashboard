// app/src/components/research/SectionTabs.jsx
//
// The modal's navigator: five group tabs, and a sub-tab row that appears only
// for a group that actually branches.
//
// ⛔ THIS IS NOT A COPY OF SectionRail. The keyboard model — roving tabindex,
// arrows move selection AND focus, Home/End jump — is `nextIndex` imported from
// the kit, the same tested function the rail uses. What differs is the LAYOUT
// and the second level, and both are specific to this surface: SectionRail is a
// single-level vertical rail, and the research page still wants it that way.
// One grammar, two presentations; the arithmetic lives in exactly one place.
//
// The state this drives is the LEAF id (see railSections.js) — clicking a group
// tab selects that group's first member, clicking a sub-tab selects that member
// directly. The component itself is stateless.
import { useRef } from 'react'

import UIcon from '../ui/UIcon'
import { nextIndex } from '../research-kit'
import { GROUPS, defaultSectionFor, groupOf, subsectionsFor } from './railSections'
import styles from './SectionTabs.module.css'

/** The canvas's element id, derived from the same prefix the tabs are. Exported
 *  so the modal stamps the panel with THIS, instead of both sides typing the
 *  same literal and drifting apart the day one of them takes a new prefix. */
export function panelIdFor(idPrefix = 'erm-rail') {
  return `${idPrefix}-panel`
}

/**
 * A roving-tabindex tab row. Extracted so both levels share ONE implementation
 * — the group row and the sub row differ by class and id prefix, nothing else,
 * and a second hand-written copy is how the two levels' keyboard behaviour
 * drifts apart.
 */
function TabRow({
  items, activeId, onSelect, idPrefix, panelId, ariaLabel, className, rowClass, showIcons = false,
}) {
  const refs = useRef([])
  const activeIdx = Math.max(0, items.findIndex((s) => s.id === activeId))
  // Compare against the id the FALLBACK index resolves to, never the raw
  // `activeId` prop: an id that matches nothing would otherwise leave every
  // tab at tabIndex -1 — a tablist the keyboard cannot enter.
  const resolvedId = items[activeIdx]?.id

  const onKeyDown = (e) => {
    const target = nextIndex(activeIdx, e.key, items.length)
    if (target < 0) return
    e.preventDefault()
    const id = items[target]?.id
    if (id && onSelect) onSelect(id)
    refs.current[target]?.focus()
  }

  return (
    <div
      className={`${rowClass} ${className || ''}`}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
    >
      {items.map((s, i) => {
        const isActive = s.id === resolvedId
        return (
          <button
            key={s.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`${idPrefix}-${s.id}`}
            // Only the ACTIVE tab points at a panel: the canvas unmounts every
            // inactive panel (the modal's GATE c), so the other tabs' IDREFs
            // would dangle at an element that does not exist.
            aria-controls={isActive ? panelId : undefined}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onSelect && onSelect(s.id)}
            onKeyDown={onKeyDown}
          >
            {showIcons && s.icon && (
              <UIcon name={s.icon} size={13} gold={false} className={styles.icon} />
            )}
            <span className={styles.label}>{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function SectionTabs({ active, onSelect, idPrefix = 'erm-rail', className = '' }) {
  const group = groupOf(active)
  const subs = subsectionsFor(group)

  return (
    <div className={`${styles.wrap} ${className}`}>
      <TabRow
        items={GROUPS}
        activeId={group}
        onSelect={(id) => onSelect && onSelect(defaultSectionFor(id))}
        idPrefix={`${idPrefix}-tab`}
        panelId={panelIdFor(idPrefix)}
        ariaLabel="Report sections"
        rowClass={styles.groups}
        showIcons
      />

      {subs.length > 0 && (
        <TabRow
          items={subs}
          activeId={active}
          onSelect={onSelect}
          idPrefix={`${idPrefix}-sub`}
          panelId={panelIdFor(idPrefix)}
          ariaLabel={`${GROUPS.find((g) => g.id === group)?.label ?? ''} sections`}
          rowClass={styles.subs}
        />
      )}
    </div>
  )
}

/**
 * The element id that labels the canvas — the ACTIVE SUB-tab when the group
 * branches, the group tab otherwise. Exported so the modal derives it from the
 * same rules that render it, instead of restating the naming scheme.
 */
export function panelLabelledBy(active, idPrefix = 'erm-rail') {
  const group = groupOf(active)
  return subsectionsFor(group).length > 0
    ? `${idPrefix}-sub-${active}`
    : `${idPrefix}-tab-${group}`
}
