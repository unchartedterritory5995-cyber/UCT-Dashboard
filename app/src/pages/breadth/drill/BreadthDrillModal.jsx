import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import usePreferences from '../../../hooks/usePreferences'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { widgetOwnChrome, chartTypeCanvasEntry } from '../../charts/widgetChrome'
import useDrillWorkspace from './drillWorkspace'
import { DrillSourceContext } from './DrillSourceContext'
import BreadthDrillBoard from './BreadthDrillBoard'
import { DRILL_BOARD_PREF, parseBoard, serializeBoard } from './drillBoardPrefs'
import styles from './BreadthDrillModal.module.css'

// The breadth cell drill: a two-widget charts board in an overlay.
//
// The overlay + title bar are all this file owns. Everything inside is the real
// charts workspace machinery — a complete WorkspaceContext (drillWorkspace.js),
// WidgetHost, Watchlists in scan mode, ChartWidget.

export default function BreadthDrillModal({ drill, latestDate, onClose }) {
  const { prefs, setPref } = usePreferences()
  // Same expression ChartsWorkspace uses, deliberately — not a near-equivalent.
  const chartsTheme = prefs?.charts_theme || 'default'

  // ── Board state, seeded from the stored pref ────────────────────────────────
  // Seeded ONCE per open. A later pref round-trip must not stomp the board the
  // user is currently dragging.
  const [board, setBoard] = useState(() => parseBoard(prefs?.[DRILL_BOARD_PREF]))
  const onBoardChange = useCallback((fn) => {
    setBoard(prev => (typeof fn === 'function' ? fn(prev) : fn))
  }, [])

  // Debounced persist, mirroring the workspace's own 500ms layout save. A split
  // drag emits on every pointermove; writing each one would hammer the prefs API.
  const saveTimer = useRef(null)
  const boardRef = useRef(board)
  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [board, setPref])
  // Flush on unmount so the last arrangement always lands, rather than depending
  // on the 500ms window having elapsed before the modal closed.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }
  }, [setPref])

  // ── The workspace value ─────────────────────────────────────────────────────
  // Per-widget chrome so each widget's frame follows ITS OWN canvas, and the
  // chart's type default so an uncustomized drill chart is framed exactly like an
  // uncustomized chart on /charts. Watchlists deliberately have no type entry.
  const widgetCanvasById = useMemo(() => {
    const out = {}
    for (const w of board.widgets) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    return out
  }, [board.widgets, chartsTheme])
  const widgetCanvasByType = useMemo(
    () => ({ chart: chartTypeCanvasEntry(prefs?.chart_settings, chartsTheme) }),
    [prefs?.chart_settings, chartsTheme],
  )

  const firstSym = drill?.items?.[0]?.t || null
  const workspace = useDrillWorkspace({
    initialSym: firstSym,
    chartsTheme,
    widgetCanvasByType,
    widgetCanvasById,
  })

  // ── The drill payload ───────────────────────────────────────────────────────
  const source = useMemo(() => ({
    items: drill?.items ?? [],
    label: drill?.label ?? '',
    date: drill?.date ?? null,
    live: !!drill?.live,
    asOf: drill?.asOf ?? null,
    latestDate: latestDate ?? null,
  }), [drill, latestDate])

  // Escape closes. Bound on the overlay's own document so a popped-out widget's
  // window cannot swallow it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const count = source.items.length
  const whenLabel = source.live ? 'LIVE' : source.date

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${source.label} constituents`}
    >
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.bar}>
          <span className={styles.title}>
            {source.label}
            {drill?.items && <span className={styles.count}> · {count.toLocaleString()} {count === 1 ? 'stock' : 'stocks'}</span>}
          </span>
          {whenLabel && <span className={styles.when}>{whenLabel}</span>}
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <UIcon name="x" size={14} />
          </button>
        </div>

        <WorkspaceContext.Provider value={workspace}>
          <DrillSourceContext.Provider value={source}>
            <BreadthDrillBoard board={board} onBoardChange={onBoardChange} />
          </DrillSourceContext.Provider>
        </WorkspaceContext.Provider>
      </div>
    </div>
  )
}
