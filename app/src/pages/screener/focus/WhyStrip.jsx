import { useId, useLayoutEffect, useRef, useState } from 'react'
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
  const listRef = useRef(null)
  const [fit, setFit] = useState({ items: null, n: Infinity })
  const shownN = fit.items === items ? fit.n : Infinity
  // Measure with every item laid out, then keep as many as fit.
  useLayoutEffect(() => {
    const ul = listRef.current
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
    setFit({ items, n: n >= lis.length ? Infinity : n })
  }, [items, more, shownN])
  // A new width re-measures from the full set.
  useLayoutEffect(() => {
    const ul = listRef.current
    if (!ul || typeof ResizeObserver === 'undefined') return undefined
    let w = ul.clientWidth
    const ro = new ResizeObserver(() => {
      if (ul.clientWidth !== w) { w = ul.clientWidth; setFit({ items: null, n: Infinity }) }
    })
    ro.observe(ul)
    return () => ro.disconnect()
  }, [])
  if (!items?.length) return null
  const shown = Number.isFinite(shownN) ? items.slice(0, shownN) : items
  const hidden = items.length - shown.length + (more || 0)
  return (
    <div className={styles.why}>
      <span className={styles.whyLabel} id={labelId}>Why it&apos;s here</span>
      <ul ref={listRef} className={styles.whyList} aria-labelledby={labelId}>
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
