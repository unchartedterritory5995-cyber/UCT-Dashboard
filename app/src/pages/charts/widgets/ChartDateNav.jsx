import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ChartDateNav.module.css'
import { parseDate, maskMDY } from '../../../components/chart/dateText'

// Time Navigator — the top-bar date box (MarketSmith-style). Sits between the
// timeframe buttons and the info fields. Type a date + Enter (or pick from the
// calendar) to jump so that day sits at the RIGHT edge; ◀/▶ step one bar; the ▾
// dropdown opens a month calendar + a list of every year the symbol has traded
// (click a year to frame that whole calendar year). All chart work is done by
// StockChart's imperative API, reached through `paneRef` (ChartPane handle):
//   goToDate(ms) · goToYear(y) · stepBar(dir) · ensureFullHistory() · getDateMeta()
// ⭐ (owner, 2026-11-27: scanning charts AT a past date) A HOST MAY TAKE THE JUMPS: `nav` ({goToDate, goToYear, stepBar})
// receives them instead of the pane, so the /charts widget can carry the date to every next symbol. While the host
// says the box is `anchored`, a "Latest" button (and Enter on an empty field) hands the date back (`onLatest`).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const fmtDate = (ms) => {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}

// M/D/YYYY -> UTC-midnight ms: THE one parser (chart/dateText.js), shared with the draft's warm

// Smart M/D/YYYY mask: the user types digits only and the slashes appear on their
// own. Month/day take 2 digits only when the first two form a valid value (so "15…"
// → 1/5, but "12…" → 12/…); the trailing year takes up to 4. Never requires a "/".
// The mask is shared with the Breadth Monitor's date box: `maskMDY` in components/chart/dateText.js.

// Exported so the Breadth Monitor reuses this exact calendar (breadth/BreadthDateNav.jsx).
export function CalendarPopover({ anchor, seedMs, minMs, maxMs, years, loadingYears, onPickDate, onPickYear, onClose, themeVars }) {
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

  // "Go to a date" (owner 11-15): type any date at the top of the calendar and jump there —
  // the same masked M/D/YYYY entry as the header field, so the calendar works on its own.
  const [typed, setTyped] = useState('')
  const typedMs = parseDate(typed)
  const goTyped = () => { if (typedMs != null) onPickDate(typedMs) }

  const W = 312
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)) : 40
  const top = anchor ? anchor.bottom + 4 : 60

  const inRange = (ms) => (
    (minMs == null || ms >= minMs - 86400000) && (maxMs == null || ms <= maxMs + 86400000)
  )

  return createPortal(
    <div ref={ref} className={styles.pop} style={{ left, top, width: W, ...(themeVars || {}) }} role="dialog" aria-label="Go to date">
      <form className={styles.goRow} onSubmit={(e) => { e.preventDefault(); goTyped() }}>
        <input
          className={styles.goField}
          value={typed}
          placeholder="Go to a date  ·  M/D/YYYY"
          aria-label="Go to a date"
          spellCheck={false}
          inputMode="numeric"
          autoFocus
          onChange={(e) => setTyped(maskMDY(e.target.value))}
        />
        <button type="submit" className={styles.goBtn} disabled={typedMs == null}>Go</button>
      </form>
      <div className={styles.popBody}>
        <div className={styles.cal}>
          <div className={styles.calHead}>
            <button type="button" className={styles.calNav} onClick={() => stepMonth(-1)} aria-label="Previous month">
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4 6 8l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className={styles.calTitle}>{MONTHS[viewM]} {viewY}</span>
            <button type="button" className={styles.calNav} onClick={() => stepMonth(1)} aria-label="Next month">
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
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
                  aria-current={isSel ? 'date' : undefined}
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
                aria-current={y === selY || undefined}
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

// ⭐ (2026-11-28, PR 1.2) `onDraft(text, ms)`: each draft as the member types it (the masked text, '' when the edit ends;
// `ms`: parseDate(text, {whole: true}), the date Enter will go to, or null while it is not one yet)
// without a date), so a host can warm the date before Enter (chart/dateWarm.js).
export default function ChartDateNav({ paneRef, themeVars = null, nav = null, anchored = false, onLatest = null, onDraft = null }) {
  const jump = () => nav || paneRef?.current
  const [meta, setMeta] = useState(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const sigRef = useRef('')
  const navRef = useRef(nav)
  navRef.current = nav
  const caretRef = useRef(null)

  // Poll the chart's date meta so the field mirrors the right-edge date + bounds.
  // Cheap (one object read) and only re-renders when something actually changed.
  useEffect(() => {
    let alive = true, timer = 0
    const tick = () => {
      if (!alive) return
      // lite: the five fields this field shows, not the Agent's full read-back (4×/s for the page's life)
      const m = paneRef?.current?.getDateMeta?.({ lite: true }) || null
      const sig = m ? `${m.rightMs}|${m.firstYear}|${m.lastYear}|${m.fullyLoaded}|${m.loading}` : 'null'
      if (sig !== sigRef.current) {
        sigRef.current = sig; setMeta(m)
        // (review of #2947, LOW 3) the host notes every view the chart shows (its unanchored newest bar is the present),
        // not only the ones a jump reads: a halted name's last bar never reads as "the present" for a typed date
        try { navRef.current?.note?.() } catch { /* the host's */ }
      }
      timer = setTimeout(tick, 250)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [paneRef])

  const shown = editing ? draft : fmtDate(meta?.rightMs)

  const submit = () => {
    if (!String(draft || '').trim() && anchored && onLatest) { onLatest(); setEditing(false); return }   // a cleared date
    const ms = parseDate(draft)
    if (ms != null) { jump()?.goToDate?.(ms) }
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
        onClick={() => jump()?.stepBar?.(-1)}
      >◀</button>
      <input
        className={styles.field}
        value={shown}
        placeholder="M/D/YYYY"
        spellCheck={false}
        title="Go to a date — type and press Enter"
        data-guide="chart.goToDate"
        onFocus={(e) => { setEditing(true); setDraft(fmtDate(meta?.rightMs)); requestAnimationFrame(() => e.target.select()) }}
        onChange={(e) => { const t = maskMDY(e.target.value); setDraft(t); onDraft?.(t, parseDate(t, { whole: true })) }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { setEditing(false); onDraft?.('', null); e.currentTarget.blur() }
        }}
      />
      <button
        type="button"
        className={styles.step}
        title="Step forward one bar"
        aria-label="Step forward one bar"
        onClick={() => jump()?.stepBar?.(1)}
      >▶</button>
      {anchored && onLatest && (
        <button
          type="button"
          className={styles.step}
          title="Back to the latest bar: every next symbol opens at the present again"
          aria-label="Back to the latest bar"
          onClick={() => onLatest()}
        >Latest</button>
      )}
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
          onPickDate={(ms) => { jump()?.goToDate?.(ms); setOpen(false) }}
          onPickYear={(y) => { jump()?.goToYear?.(y); setOpen(false) }}
          onClose={() => setOpen(false)}
          themeVars={themeVars}
        />
      )}
    </div>
  )
}
