import { useMemo, useRef, useState } from 'react'
import { CalendarPopover } from '../BreadthDateNav'
import styles from './JoinedDateNav.module.css'

// The breadth drill window's date control: ‹ | Thu Nov 6, 2026 📅 | › as one
// bordered control; the date opens the same calendar the Monitor header uses.
// Its own file (not a variant of BreadthDateNav) so it loads only with the
// drill window, never in the shared bundles other pages open with.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const isoParts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return { dow: WEEKDAY[d.getDay()], text: `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` }
}

export default function JoinedDateNav({ topDate, minDate, maxDate, canForward, onStep, onPickDate, onPickYear }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const dateRef = useRef(null)
  const years = useMemo(() => {
    const fy = /^(\d{4})/.exec(minDate || '')
    const ly = /^(\d{4})/.exec(maxDate || '')
    if (!fy || !ly) return []
    const out = []
    for (let y = +ly[1]; y >= +fy[1]; y--) out.push(y)
    return out
  }, [minDate, maxDate])
  const toggle = () => {
    if (open) { setOpen(false); return }
    if (dateRef.current) setAnchor(dateRef.current.getBoundingClientRect())
    setOpen(true)
  }
  const p = isoParts(topDate)
  return (
    <div className={styles.joined}>
      <button type="button" className={styles.jStep} title="Previous trading day" aria-label="Step back one trading day"
        onClick={() => onStep(-1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button ref={dateRef} type="button" className={styles.jDate} title="Pick a date or year" aria-label="Pick a date or year"
        aria-expanded={open} onClick={toggle}>
        {p ? <><small>{p.dow}</small>{p.text}</> : '—'}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className={styles.jCal}>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className={styles.jStep} title={canForward ? 'Next trading day' : 'No newer trading day'}
        aria-label="Step forward one trading day" disabled={!canForward} onClick={() => canForward && onStep(1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <CalendarPopover
          anchor={anchor}
          seedIso={topDate}
          minIso={minDate}
          maxIso={maxDate}
          years={years}
          onPickDate={(iso) => { onPickDate(iso); setOpen(false) }}
          onPickYear={(y) => { onPickYear(y); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
