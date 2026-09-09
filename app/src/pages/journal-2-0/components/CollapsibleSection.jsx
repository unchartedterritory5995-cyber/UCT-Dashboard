/**
 * CollapsibleSection — accordion panel for the Analytics tab.
 *
 * Wraps a heavy chart section behind a clickable header so the user can
 * collapse what they don't want to scroll past. Open/closed state persists
 * per-section in localStorage. Children are unmounted while collapsed, so the
 * ECharts instances inside don't render (and don't cost layout) until opened.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import styles from './CollapsibleSection.module.css'

const KEY_PREFIX = 'uct.j2.analytics.section.'

function readInitial(id, defaultOpen) {
  if (typeof window === 'undefined') return defaultOpen
  try {
    const v = window.localStorage.getItem(KEY_PREFIX + id)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default
  }
  return defaultOpen
}

export default function CollapsibleSection({
  id,
  title,
  meta = null,
  defaultOpen = false,
  /** ⭐ Wave O6: a navigation that lands INSIDE this section must open it.
   *  Children are unmounted while collapsed, so a deep link to something in
   *  here would otherwise resolve to nothing at all — silently, which reads
   *  exactly like "search only opens the note".
   *
   *  ⛔ IT DOES NOT PERSIST. The stored value is the member's own preference
   *  for this section; being sent here once is not them changing their mind
   *  about whether it should be open by default. Any change of a truthy value
   *  reopens, so a second result in the same section re-triggers. */
  openSignal = null,
  children,
}) {
  const [open, setOpen] = useState(() => readInitial(id, defaultOpen))
  const regionId = useId()

  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(KEY_PREFIX + id, next ? '1' : '0')
      } catch {
        // ignore persistence failure — in-memory toggle still works
      }
      return next
    })
  }, [id])

  return (
    <section className={styles.panel}>
      <button
        type="button"
        className={`${styles.header} ${open ? styles.headerOpen : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
      >
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className={`${styles.title} ${open ? styles.titleOpen : ''}`}>{title}</span>
        {meta != null && <span className={styles.meta}>{meta}</span>}
      </button>
      {open && (
        <div id={regionId} className={styles.body}>
          {children}
        </div>
      )}
    </section>
  )
}
