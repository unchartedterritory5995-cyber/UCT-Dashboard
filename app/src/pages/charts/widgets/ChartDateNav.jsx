import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ChartDateNav.module.css'

// Time Navigator — the top-bar date box (MarketSmith-style). Sits between the
// timeframe buttons and the info fields. Type a date + Enter (or pick from the
// calendar) to jump so that day sits at the RIGHT edge; ◀/▶ step one bar; the ▾
// dropdown opens a month calendar + a list of every year the symbol has traded
// (click a year to frame that whole calendar year). All chart work is done by
// StockChart's imperative API, reached through `paneRef` (ChartPane handle):
//   goToDate(ms) · goToYear(y) · stepBar(dir) · ensureFullHistory() · getDateMeta()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const fmtDate = (ms) => {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}

// Accepts M/D/YYYY (the masked form). Returns a UTC-midnight ms.
const parseDate = (txt) => {
  if (!txt) return null
  const s = String(txt).trim()
  const mm = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!mm) return null
  let m = +mm[1], d = +mm[2], y = +mm[3]
  if (!y || !m || !d) return null
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Date.UTC(y, m - 1, d)
}

// Smart M/D/YYYY mask: the user types digits only and the slashes appear on their
// own. Month/day take 2 digits only when the first two form a valid value (so "15…"
// → 1/5, but "12…" → 12/…); the trailing year takes up to 4. Never requires a "/".
const maskMDY = (raw) => {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8)
  if (!d) return ''
  let i = 0
  // month
  let mlen
  if (d[0] === '0') mlen = 2
  else if (d[0] === '1') mlen = (d.length > 1 && '012'.includes(d[1])) ? 2 : 1
  else mlen = 1
  const month = d.slice(i, i + mlen); i += mlen
  if (i >= d.length) return month
  // day
  let dlen
  if (d[i] === '0' || d[i] === '1' || d[i] === '2') dlen = 2
  else if (d[i] === '3') dlen = (d.length > i + 1 && '01'.includes(d[i + 1])) ? 2 : 1
  else dlen = 1
  const day = d.slice(i, i + dlen); i += dlen
  if (i >= d.length) return `${month}/${day}`
  return `${month}/${day}/${d.slice(i, i + 4)}`
}

function CalendarPopover({ anchor, seedMs, minMs, maxMs, years, loadingYears, onPickDate, onPickYear, onClose, themeVars }) {
  const ref = useRef(null)
  const seed = Number.isFinite(seedMs) ? new Date(seedMs) : new Date()
  const [viewY, setViewY] = useState(seed.getUTCFullYear())
  const [viewM, setViewM] = useState(seed.getUTCMonth())
  // The currently-framed date (right edge) — gold-accented in the grid + year list.
  const sel = Number.isFinite(seedMs) ? new Date(seedMs) : null
  const selY = sel ? sel.getUTCFullYear() : null
  const selM = sel ? sel.getUTCMonth() : null
  const selD = sel ? sel.getUTCDate() : null

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
    const first = new Date(Date.UTC(viewY, viewM, 1))
    const startDow = first.getUTCDay()
    const daysIn = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let day = 1; day <= daysIn; day++) cells.push(day)
    return cells
  }, [viewY, viewM])

  const W = 300
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)) : 40
  const top = anchor ? anchor.bottom + 4 : 60

  const inRange = (ms) => (
    (minMs == null || ms >= minMs - 86400000) && (maxMs == null || ms <= maxMs + 86400000)
  )

  return createPortal(
    <div ref={ref} className={styles.pop} style={{ left, top, width: W, ...(themeVars || {}) }} role="dialog" aria-label="Go to date">
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
              const ms = Date.UTC(viewY, viewM, day)
              const ok = inRange(ms)
              const isSel = viewY === selY && viewM === selM && day === selD
              return (
                <button
                  key={i}
                  type="button"
                  className={`${styles.calDay} ${isSel ? styles.calDaySel : ''}`}
                  disabled={!ok}
                  onClick={() => onPickDate(ms)}
                >{day}</button>
              )
            })}
          </div>
        </div>
        <div className={styles.years}>
          <div className={styles.yearsLabel}>Year</div>
          <div className={styles.yearsScroll}>
            {loadingYears && <div className={styles.yearsHint}>loading…</div>}
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

export default function ChartDateNav({ paneRef, themeVars = null }) {
  const [meta, setMeta] = useState(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const sigRef = useRef('')
  const caretRef = useRef(null)

  // Poll the chart's date meta so the field mirrors the right-edge date + bounds.
  // Cheap (one object read) and only re-renders when something actually changed.
  useEffect(() => {
    let alive = true, timer = 0
    const tick = () => {
      if (!alive) return
      const m = paneRef?.current?.getDateMeta?.() || null
      const sig = m ? `${m.rightMs}|${m.firstYear}|${m.lastYear}|${m.fullyLoaded}|${m.loading}` : 'null'
      if (sig !== sigRef.current) { sigRef.current = sig; setMeta(m) }
      timer = setTimeout(tick, 250)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [paneRef])

  const shown = editing ? draft : fmtDate(meta?.rightMs)

  const submit = () => {
    const ms = parseDate(draft)
    if (ms != null) { paneRef?.current?.goToDate?.(ms) }
    setEditing(false)
  }

  const years = useMemo(() => {
    if (!meta || meta.firstYear == null || meta.lastYear == null) return []
    const out = []
    for (let y = meta.lastYear; y >= meta.firstYear; y--) out.push(y)
    return out
  }, [meta])

  const openMenu = () => {
    if (caretRef.current) setAnchor(caretRef.current.getBoundingClientRect())
    setOpen(true)
    // Fill the year list back to the true origin — load full history without moving
    // the view. The list fills in over ~1s as the deeper bars land (polled above).
    if (meta && !meta.fullyLoaded) paneRef?.current?.ensureFullHistory?.()
  }

  return (
    <div className={styles.nav}>
      <button
        type="button"
        className={styles.step}
        title="Step back one bar"
        aria-label="Step back one bar"
        onClick={() => paneRef?.current?.stepBar?.(-1)}
      >◀</button>
      <input
        className={styles.field}
        value={shown}
        placeholder="M/D/YYYY"
        spellCheck={false}
        title="Go to a date — type and press Enter"
        onFocus={(e) => { setEditing(true); setDraft(fmtDate(meta?.rightMs)); requestAnimationFrame(() => e.target.select()) }}
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
        title="Step forward one bar"
        aria-label="Step forward one bar"
        onClick={() => paneRef?.current?.stepBar?.(1)}
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
          seedMs={meta?.rightMs}
          minMs={meta?.firstMs}
          maxMs={meta?.lastMs}
          years={years}
          loadingYears={meta ? !meta.fullyLoaded : false}
          onPickDate={(ms) => { paneRef?.current?.goToDate?.(ms); setOpen(false) }}
          onPickYear={(y) => { paneRef?.current?.goToYear?.(y); setOpen(false) }}
          onClose={() => setOpen(false)}
          themeVars={themeVars}
        />
      )}
    </div>
  )
}
