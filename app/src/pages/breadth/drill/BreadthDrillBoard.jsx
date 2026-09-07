import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetHost from '../../charts/WidgetHost'
import { clampSplit, LIST_WIDGET_ID } from './drillBoardPrefs'
import styles from './BreadthDrillBoard.module.css'

// Two REAL charts-workspace widgets in a resizable split.
//
// Everything visible below the split is `WidgetHost` — the same component /charts
// mounts — so the chrome (colour dot, tab strip, add-tab, float, pop-out) and the
// bodies (Watchlists in scan mode, ChartWidget) are not replicas of the charts tab,
// they ARE it. The only thing this file owns is the two-pane geometry.
//
// ⛔ It deliberately does NOT rebuild the RGL grid. `renderGrid` is a closure inside
// ChartsWorkspace (2,600 lines) and a second copy of that configuration would be free
// to drift — the defect this whole workstream exists to remove. Widget CAPABILITIES
// are unaffected by the simpler layout; only free-form rearranging is, and a
// two-widget modal has nothing to rearrange. Lifting renderGrid out into a shared
// board is the follow-up.

export default function BreadthDrillBoard({ board, onBoardChange, onPopOut }) {
  const { widgets, split } = board
  const wrapRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const replaceWidget = useCallback((id, next) => {
    onBoardChange(b => ({
      ...b,
      widgets: b.widgets.map(w => (w.id === id ? next : w)),
    }))
  }, [onBoardChange])

  const patchOpts = useCallback((id, opts) => {
    onBoardChange(b => ({
      ...b,
      widgets: b.widgets.map(w => (w.id === id ? { ...w, opts } : w)),
    }))
  }, [onBoardChange])

  const patchColor = useCallback((id, color) => {
    onBoardChange(b => ({
      ...b,
      widgets: b.widgets.map(w => (w.id === id ? { ...w, color } : w)),
    }))
  }, [onBoardChange])

  // ── Split drag ──────────────────────────────────────────────────────────────
  // Pointer events + setPointerCapture so a fast drag that leaves the divider
  // keeps tracking, and a release outside the window still ends the drag.
  const onDividerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (e) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      onBoardChange(b => ({ ...b, split: clampSplit(e.clientX - rect.left) }))
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, onBoardChange])

  const listWidget = widgets.find(w => w.id === LIST_WIDGET_ID)
  const chartWidget = widgets.find(w => w.id !== LIST_WIDGET_ID)

  const host = (w) => (
    <WidgetHost
      widget={w}
      // ⛔ NO onRemove: the modal closes as a unit, and WidgetHeader renders no
      // dead ✕ when the handler is absent.
      onColorChange={(c) => patchColor(w.id, c)}
      onOptsChange={(opts) => patchOpts(w.id, opts)}
      onReplaceWidget={replaceWidget}
      onPopOut={onPopOut ? () => onPopOut(w.id) : undefined}
    />
  )

  return (
    <div className={styles.board} ref={wrapRef}>
      <div className={styles.pane} style={{ width: split, flex: '0 0 auto' }}>
        {listWidget && host(listWidget)}
      </div>
      <div
        className={`${styles.divider}${dragging ? ' ' + styles.dividerActive : ''}`}
        onPointerDown={onDividerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize list panel"
        title="Drag to resize"
      />
      <div className={`${styles.pane} ${styles.paneGrow}`}>
        {chartWidget && host(chartWidget)}
      </div>
    </div>
  )
}
