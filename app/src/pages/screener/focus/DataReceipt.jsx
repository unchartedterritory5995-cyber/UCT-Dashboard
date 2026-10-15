import { useEffect, useId, useRef, useState } from 'react'
import CoverageLine from '../../../components/provenance/CoverageLine'
import { sessionCloseLabel, isStaleSnapshot } from './dates'
import { plainColumnLabel } from './plainWords'
import { COLUMN_DEFS } from '../columnDefs'
import styles from './FocusScreener.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- a pure helper the orchestrator shares with this receipt
export function coverageHasDrop(c) {
  return !!c && ((c.dropped || 0) > 0 || (c.not_computable || 0) > 0)
}
// The label names the SESSION the snapshot describes (dates.js), not the night it was built.
const day = iso => sessionCloseLabel(iso) || 'latest close'

// The live overlay's clock in ET: "2:47 PM". `as_of` is epoch seconds from the sweep; a string
// is the server's own wording and is shown as it came.
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper the tests read
export function liveClock(live) {
  const v = live?.as_of
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return new Date(v * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
}
const columnName = c => plainColumnLabel(c) || COLUMN_DEFS[c]?.label || c

// What the button and the popover say. `live` is the scan's `snapshot.live` (query.py
// live_screen_state): `state === 'live'` only when rows on this page carry values the minute
// sweep recomputed, and `columns` names exactly those columns. Live time leads; the nightly
// date follows only when it is overdue, so a fresh live screen never reads as delayed, and a
// missed nightly is still said out loud for the columns it owns.
// P7: a snapshot more than one session old is said out loud (amber), never a quiet date change.
// `now` is injectable for tests.
export default function DataReceipt({ snapshotDate, live, coverage, now }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const btn = useRef(null)
  const id = useId()
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const onKeyDown = e => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    btn.current?.focus()
  }
  const when = sessionCloseLabel(snapshotDate)
  // Staleness is computed at RENDER: there is no timer, so a page left open across a missed
  // nightly turns stale on its next render (a scan answer, a live tick, any interaction).
  const stale = !!when && isStaleSnapshot(snapshotDate, now)
  const isLive = live?.state === 'live'
  const clock = isLive ? liveClock(live) : null
  const liveCols = isLive ? (live.columns || []).map(columnName) : []
  const nightlyShort = when ? when.replace(/ close$/, '') : null
  return (
    <span className={styles.menuWrap} ref={box} onKeyDown={onKeyDown}>
      <button ref={btn} type="button" className={styles.receiptBtn} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}>
        <span className={isLive ? styles.liveDot : styles.idleDot} aria-hidden="true" />
        {isLive
          ? <>Live{clock ? ` · ${clock}` : ''}{stale && nightlyShort ? <> · <span className={styles.staleTag}>nightly {nightlyShort}</span></> : null}</>
          : <span className={stale ? styles.staleTag : undefined}>{day(snapshotDate)}{stale ? ' · stale' : ''}</span>}
        <span className={styles.infoMark} aria-hidden="true">i</span>
      </button>
      {open && (
        <div id={id} role="region" aria-label="About this data" className={`${styles.menu} ${styles.menuRight} ${styles.receipt}`}>
          {isLive ? (
            <>
              <p className={styles.receiptHead}>Live{clock ? `, updated ${clock} ET` : ''}: {liveCols.join(', ')}. These refresh about once a minute while the market is open.</p>
              <p className={styles.receiptHead}>Everything else on this screen (RS rank, volume vs avg, ratings, fundamentals and patterns) is from the {when || 'latest close'}.</p>
            </>
          ) : (
            <p className={styles.receiptHead}>Nightly data from {when ? `the ${when}` : 'the latest close'}.</p>
          )}
          {stale && <p className={`${styles.receiptHead} ${styles.staleTag}`}>The nightly data is more than one session old: the nightly update has not landed since.</p>}
          {/* TERM-047: the scan's own four-count receipt, with its reasons and its
              "nothing could be answered" refusal, through the shared CoverageLine. */}
          <CoverageLine coverage={coverage ?? null} density="compact" />
        </div>
      )}
    </span>
  )
}
