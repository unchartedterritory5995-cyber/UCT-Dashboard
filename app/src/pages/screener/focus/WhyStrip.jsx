import { useId, useLayoutEffect, useState } from 'react'
import styles from './FocusScreener.module.css'

// Room kept for the "+N more" cue when items do not fit.
const MORE_RESERVE = 72
const GAP = 14

// Only kind 'check' earns a tick. 'pool' and 'note' (including a checkable
// filter whose row value was missing) get the open circle: we never claim a
// pass we did not verify on this row.
//
// ONE line at every width: items never wrap inside themselves. Items that do not fit are left
// out and counted into the "+N more" cue (with `more`, the items the strip never had room for),
// which opens the full list.
export default function WhyStrip({ items, more = 0, onMore }) {
  const labelId = useId()
  // The list element as state (a callback ref), so the resize observer attaches whenever the
  // list exists: a strip that mounts empty and gets items later is observed too.
  const [ul, setUl] = useState(null)
  // A fit holds for the items AND the `more` it was measured with; either changing re-measures.
  const [fit, setFit] = useState({ items: null, more: 0, n: Infinity })
  const shownN = fit.items === items && fit.more === more ? fit.n : Infinity
  // The list's width as last seen by the observer: a new width re-measures even when the last
  // measure kept every item (shownN was already Infinity, so it alone would not change).
  const [width, setWidth] = useState(0)
  // Measure with every item laid out, then keep as many as fit.
  useLayoutEffect(() => {
    if (!ul || shownN !== Infinity) return
    const avail = ul.clientWidth
    const lis = [...ul.querySelectorAll('[data-why-item]')]
    if (!avail || !lis.length) return   // nothing laid out (no layout engine): show them all
    let used = 0, n = 0
    for (const li of lis) {
      const w = li.offsetWidth + (n ? GAP : 0)
      const rest = lis.length - n - 1 + more
      if (used + w + (rest > 0 ? MORE_RESERVE : 0) > avail) break
      used += w; n++
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a layout measurement: the fitted count can only be known after the full set is laid out
    setFit({ items, more, n: n >= lis.length ? Infinity : n })
  }, [ul, items, more, shownN, width])
  // A new width re-measures from the full set.
  useLayoutEffect(() => {
    if (!ul || typeof ResizeObserver === 'undefined') return undefined
    let w = ul.clientWidth
    const ro = new ResizeObserver(() => {
      if (ul.clientWidth !== w) { w = ul.clientWidth; setWidth(w); setFit({ items: null, more: 0, n: Infinity }) }
    })
    ro.observe(ul)
    return () => ro.disconnect()
  }, [ul])
  if (!items?.length) return null
  const shown = Number.isFinite(shownN) ? items.slice(0, shownN) : items
  const hidden = items.length - shown.length + (more || 0)
  return (
    <div className={styles.why}>
      <span className={styles.whyLabel} id={labelId}>Why it&apos;s here</span>
      <ul ref={setUl} className={styles.whyList} aria-labelledby={labelId}>
        {shown.map((it, i) => (
          <li key={i} className={styles.whyItem} data-why-item="">
            <span aria-hidden="true" className={it.kind === 'check' ? styles.whyCheck : styles.whyPool}>
              {it.kind === 'check' ? '✓' : '○'}
            </span>
            {it.kind === 'check' && <span className="sr-only">Passes: </span>}
            <span className={styles.whyText}>{it.label}</span>
            {it.value && <span className={styles.whyValue}>{it.value}</span>}
          </li>
        ))}
        {hidden > 0 && <li className={styles.whyMore}><button type="button" className={styles.linkBtn} onClick={onMore}>+{hidden} more</button></li>}
      </ul>
    </div>
  )
}
