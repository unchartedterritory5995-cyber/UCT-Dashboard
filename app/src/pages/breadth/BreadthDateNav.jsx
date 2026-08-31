import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './BreadthDateNav.module.css'

// Breadth Time Navigator — the Monitor header's date box (the same MarketSmith-
// style control the /charts widget uses, adapted to the breadth sheet). Type a
// date + Enter (or pick from the calendar) and the Monitor teleports so that day
// is the TOP row; ◀/▶ step one trading day; the ▾ dropdown opens a month
// calendar + a list of every year we hold breadth data for (click a year to jump
// to the START of that year). All the actual window work is the page's — this
// only reports the target through the callbacks:
//   onStep(dir) · onPickDate(iso) · onPickYear(year)
// and mirrors the current top row via `topDate`.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const pad2 = (n) => String(n).padStart(2, '0')

// ISO 'YYYY-MM-DD' → 'M/D/YYYY' (the field's masked form).
const isoToDisplay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  return `${+m[2]}/${+m[3]}/${m[1]}`
}

// Accepts M/D/YYYY (the masked form). Returns ISO 'YYYY-MM-DD'.
const parseToIso = (txt) => {
  if (!txt) return null
  const mm = String(txt).trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!mm) return null
  let m = +mm[1], d = +mm[2], y = +mm[3]
  if (!y || !m || !d) return null
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

// Smart M/D/YYYY mask: the user types digits only and the slashes appear on their
// own. Month/day take 2 digits only when the first two form a valid value (so "15…"
// → 1/5, but "12…" → 12/…); the trailing year takes up to 4. Never requires a "/".
const maskMDY = (raw) => {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8)
  if (!d) return ''
  let i = 0
  let mlen
  if (d[0] === '0') mlen = 2
  else if (d[0] === '1') mlen = (d.length > 1 && '012'.includes(d[1])) ? 2 : 1
  else mlen = 1
  const month = d.slice(i, i + mlen); i += mlen
  if (i >= d.length) return month
  let dlen
  if (d[i] === '0' || d[i] === '1' || d[i] === '2') dlen = 2
  else if (d[i] === '3') dlen = (d.length > i + 1 && '01'.includes(d[i + 1])) ? 2 : 1
  else dlen = 1
  const day = d.slice(i, i + dlen); i += dlen
  if (i >= d.length) return `${month}/${day}`
  return `${month}/${day}/${d.slice(i, i + 4)}`
}

const isoOf = (y, m, day) => `${y}-${pad2(m + 1)}-${pad2(day)}` // m is 0-based

function CalendarPopover({ anchor, seedIso, minIso, maxIso, years, onPickDate, onPickYear, onClose }) {
  const ref = useRef(null)
  const seed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(seedIso || '')
  const [viewY, setViewY] = useState(seed ? +seed[1] : new Date().getUTCFullYear())
  const [viewM, setViewM] = useState(seed ? +seed[2] - 1 : new Date().getUTCMonth())
  // The currently-framed date (top row) — gold-accented in the grid + year list.
  const selY = seed ? +seed[1] : null
  const selM = seed ? +seed[2] - 1 : null
  const selD = seed ? +seed[3] : null

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); clearTimeout(t) }
  }, [onClose])

  const stepMonth = (delta) => {
    let m = viewM + delta, y = viewY
    while (m < 0) { m += 12; y -= 1 }
    while (m > 11) { m -= 12; y += 1 }
    setViewM(m); setViewY(y)
  }

  const grid = useMemo(() => {
    const startDow = new Date(Date.UTC(viewY, viewM, 1)).getUTCDay()
    const daysIn = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let day = 1; day <= daysIn; day++) cells.push(day)
    return cells
  }, [viewY, viewM])

  const W = 300
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)) : 40
  const top = anchor ? anchor.bottom + 4 : 60

  // ISO strings compare lexically, so the bounds check is a plain string compare.
  const inRange = (iso) => (
    (minIso == null || iso >= minIso) && (maxIso == null || iso <= maxIso)
  )

  return createPortal(
    <div ref={ref} className={styles.pop} style={{ left, top, width: W }} role="dialog" aria-label="Go to date">
      <div className={styles.popBody}>
        <div className={styles.cal}>
          <div className={styles.calHead}>
            <button type="button" className={styles.calNav} onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
            <span className={styles.calTitle}>{MONTHS[viewM]} {viewY}</span>
            <button type="button" className={styles.calNav} onClick={() => stepMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className={styles.calDow}>{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className={styles.calGrid}>
            {grid.map((day, i) => {
              if (day == null) return <span key={i} className={styles.calEmpty} />
              const iso = isoOf(viewY, viewM, day)
              const ok = inRange(iso)
              const isSel = viewY === selY && viewM === selM && day === selD
              return (
                <button
                  key={i}
                  type="button"
                  className={`${styles.calDay} ${isSel ? styles.calDaySel : ''}`}
                  disabled={!ok}
                  onClick={() => onPickDate(iso)}
                >{day}</button>
              )
            })}
          </div>
        </div>
        <div className={styles.years}>
          <div className={styles.yearsLabel}>Year</div>
          <div className={styles.yearsScroll}>
            {years.length === 0 && <div className={styles.yearsHint}>—</div>}
            {years.map((y) => (
              <button
                key={y}
                type="button"
                className={`${styles.yearBtn} ${y === selY ? styles.yearBtnSel : ''}`}
                onClick={() => onPickYear(y)}
              >{y}</button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function BreadthDateNav({
  topDate, minDate, maxDate, canForward,
  onStep, onPickDate, onPickYear,
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const caretRef = useRef(null)

  const shown = editing ? draft : isoToDisplay(topDate)

  const submit = () => {
    const iso = parseToIso(draft)
    if (iso) onPickDate(iso)
    setEditing(false)
  }

  const years = useMemo(() => {
    const fy = /^(\d{4})/.exec(minDate || '')
    const ly = /^(\d{4})/.exec(maxDate || '')
    if (!fy || !ly) return []
    const out = []
    for (let y = +ly[1]; y >= +fy[1]; y--) out.push(y)
    return out
  }, [minDate, maxDate])

  const openMenu = () => {
    if (caretRef.current) setAnchor(caretRef.current.getBoundingClientRect())
    setOpen(true)
  }

  return (
    <div className={styles.nav}>
      <button
        type="button"
        className={styles.step}
        title="Step back one trading day"
        aria-label="Step back one trading day"
        onClick={() => onStep(-1)}
      >◀</button>
      <input
        className={styles.field}
        value={shown}
        placeholder="M/D/YYYY"
        spellCheck={false}
        title="Go to a date — type and press Enter"
        onFocus={(e) => { setEditing(true); setDraft(isoToDisplay(topDate)); requestAnimationFrame(() => e.target.select()) }}
        onChange={(e) => setDraft(maskMDY(e.target.value))}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { setEditing(false); e.currentTarget.blur() }
        }}
      />
      <button
        type="button"
        className={styles.step}
        title="Step forward one trading day"
        aria-label="Step forward one trading day"
        disabled={!canForward}
        onClick={() => canForward && onStep(1)}
      >▶</button>
      <button
        ref={caretRef}
        type="button"
        className={styles.caret}
        title="Pick a date or year"
        aria-label="Pick a date or year"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <svg width="9" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
