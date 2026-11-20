import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ScanHeader } from './scan/ScanDeckParts'
import useDrillDateNav from './useDrillDateNav'
import useReading from './reading/useReading'
import HistoryPanel from './reading/HistoryPanel'
import { fmtDate } from './reading/readingModel'
import { universeLabel } from '../monitorUniverses'
import styles from './BreadthReadingModal.module.css'

// The READING-ONLY window (owner pick B3, 2026-11-19): a Monitor cell with no stock list behind it
// — a ratio (5D Ratio), a percent (>50SMA), a market-wide reading (VIX, CNN F/G…) or any cell off
// the UCT universe (no lists there yet). The same top band as the scan window, then the History
// as the body. ⛔ No list is fetched: there is none.

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function noteFor(drill, universe) {
  if (universe !== 'uct' && drill.hasList) return `No stock list for ${universeLabel(universe)} yet, so History fills the window.`
  return `${drill.label} has no stock list behind it, so History fills the window.`
}

export default function BreadthReadingModal({ drill, onClose, rows = null, onNavigate = null, universe = 'uct', drillCols = null }) {
  const colKey = drill?.colKey || null
  const date = drill?.date || null
  const live = !!drill?.live
  const { reading, loading, error } = useReading({ universe, metric: colKey, date, live, value: drill?.value ?? null, per: drill?.per ?? null })
  const { dateNav, step } = useDrillDateNav({ rows, colKey, date, live, onNavigate })
  const fmt = drill?.fmt || String

  // The count tile's picture: this column's own readings, from the reading's series.
  const ctx = useMemo(() => (reading?.series
    ? { series: reading.series.values, seriesDates: reading.series.dates }
    : null), [reading])
  const isCount = !!drill?.isCount
  const tile = useMemo(() => ({
    label: isCount ? 'Stocks' : drill?.label,
    fmt,
    unitOne: isCount ? 'stock' : '',
    unitMany: isCount ? 'stocks' : '',
  }), [isCount, drill?.label, fmt])

  const pickMetric = useCallback((key) => {
    onNavigate?.({ colKey: key, date, live })
  }, [onNavigate, date, live])
  const pickSimilarDay = useCallback((d) => {
    if (d && colKey) onNavigate?.({ colKey, date: d, live: false })
  }, [colKey, onNavigate])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-label="Go to date"]')) return
        onClose?.()
        return
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const t = e.target
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === '[') { e.preventDefault(); step(-1) }
      else if (e.key === ']') { e.preventDefault(); step(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  const dialogRef = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    return () => { if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus() }
  }, [])
  const onDialogKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    const nodes = root ? Array.from(root.querySelectorAll(FOCUSABLE)) : []
    if (!nodes.length) { e.preventDefault(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const here = root.ownerDocument.activeElement
    if (e.shiftKey && (here === first || here === root)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus() }
  }, [])

  const uName = universeLabel(universe)
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={`${drill?.label ?? ''} on ${uName}, reading`} onKeyDown={onDialogKeyDown}
        onClick={e => e.stopPropagation()} data-reading-only="">
        <ScanHeader
          label={drill?.label}
          count={Number.isFinite(drill?.value) ? drill.value : (reading?.value ?? null)}
          live={live}
          drillCols={drillCols}
          colKey={colKey}
          onPickMetric={onNavigate && drillCols?.length > 1 ? pickMetric : null}
          dateNav={dateNav}
          ctx={ctx}
          onWantDays={null}
          modes={[]}
          onClose={onClose}
          reading={reading}
          readingLoading={loading}
          tile={tile}
          badge={universe !== 'uct' ? uName : null}
          note={noteFor(drill || {}, universe)}
        />
        <div className={styles.body}>
          <div className={styles.bodyHead}>
            <b>History</b>
            <span>{drill?.label}{drill?.valueText ? ` at ${drill.valueText}` : ''}{date ? ` on ${fmtDate(date)}` : ''} · {uName}</span>
          </div>
          <div className={styles.bodyScroll}>
            <HistoryPanel reading={reading} loading={loading} error={error} fmt={fmt} layout="row"
              onPickDate={onNavigate ? pickSimilarDay : null} />
          </div>
        </div>
      </div>
    </div>
  )
}
