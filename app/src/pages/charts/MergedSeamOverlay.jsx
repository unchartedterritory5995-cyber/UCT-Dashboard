// Draggable seam handles for merged mode — the TC2000 "grab the divider between
// two widgets and drag to resize both" behavior. Rendered as an absolutely-
// positioned layer over the (margin-0) merged grid; only the thin seam bars are
// interactive, so the widgets between them stay fully usable. Each drag snaps to
// whole grid columns/rows and grows one side while shrinking the neighbor, so the
// board never gaps or overlaps (all math in the pure mergedSeams module).
//
// ⚡ SMOOTH DRAG — the gesture writes the affected widgets' pixel geometry STRAIGHT
// TO THE DOM (never setState per move), and commits to React state only on
// pointer-UP. A per-move setState re-reconciled BOTH heavy charts every frame, so
// the seam visibly lagged the cursor and stepped. Now the two panes (and the seam
// bar) follow the pointer at native speed — the same technique that keeps a widget
// drag smooth (see FloatingWidgetPanel) — and lightweight-charts just re-fits at
// the new size. In merged mode the grid margin is 0, so a widget's box is exactly
// {x·colWidth, y·rowHeight, w·colWidth, h·rowHeight}, matching the seam-bar space.
//
// All gesture logic lives INSIDE onPointerDown with per-gesture window listeners
// (no refs read/written during render) so the react-hooks/refs guard stays green.

import { useCallback, useMemo, useState } from 'react'
import { computeSeams, applyVerticalDrag, applyHorizontalDrag } from './mergedSeams'
import styles from './ChartsWorkspace.module.css'

const HANDLE_PX = 8   // hit-area thickness of a seam bar (visual line is thinner)

export default function MergedSeamOverlay({
  widgets, cols, rows, colWidth, rowHeight,
  minWFor, minHFor, onResize,   // onResize(nextWidgets, commit:boolean)
}) {
  const seams = useMemo(() => computeSeams(widgets, cols, rows), [widgets, cols, rows])
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((s, type, e) => {
    e.preventDefault()
    e.stopPropagation()
    const line = type === 'v' ? s.c : s.r
    const startClient = type === 'v' ? e.clientX : e.clientY
    const barEl = e.currentTarget
    // Grab the grid-item DOM elements on both sides of this seam so the move handler
    // can resize them directly. transition:none kills RGL's ease (every frame would
    // otherwise animate → lag).
    const ids = type === 'v' ? [...(s.leftIds || []), ...(s.rightIds || [])]
                             : [...(s.topIds || []), ...(s.bottomIds || [])]
    const elMap = new Map()
    for (const id of ids) {
      const inner = document.querySelector(`[data-widget-id="${id}"]`)
      const el = inner ? (inner.closest('.react-grid-item') || inner.parentElement) : null
      if (el) { el.style.transition = 'none'; elMap.set(id, el) }
    }
    let lastApplied = 0

    const move = (ev) => {
      let res, boundary
      if (type === 'v') {
        const deltaCols = (ev.clientX - startClient) / colWidth
        res = applyVerticalDrag(widgets, line, deltaCols, minWFor)
        boundary = (line + res.applied) * colWidth
      } else {
        const deltaRows = (ev.clientY - startClient) / rowHeight
        res = applyHorizontalDrag(widgets, line, deltaRows, minHFor)
        boundary = (line + res.applied) * rowHeight
      }
      lastApplied = res.applied
      // Resize the affected widget containers directly — no React render this frame.
      for (const w of res.widgets) {
        const el = elMap.get(w.id)
        if (!el) continue
        el.style.left = `${w.x * colWidth}px`
        el.style.top = `${w.y * rowHeight}px`
        el.style.width = `${w.w * colWidth}px`
        el.style.height = `${w.h * rowHeight}px`
      }
      // Carry the seam bar itself with the cursor.
      if (barEl) {
        if (type === 'v') barEl.style.left = `${boundary - HANDLE_PX / 2}px`
        else barEl.style.top = `${boundary - HANDLE_PX / 2}px`
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      for (const el of elMap.values()) { el.style.transition = '' }  // hand geometry back to RGL
      // Snap to whole columns/rows for a clean, valid saved layout — a ≤½-cell
      // settle at the very end, never a jump during the drag.
      const intDelta = Math.round(lastApplied || 0)
      const final = type === 'v'
        ? applyVerticalDrag(widgets, line, intDelta, minWFor).widgets
        : applyHorizontalDrag(widgets, line, intDelta, minHFor).widgets
      onResize(final, true)   // persist once, on release → React/RGL re-own the boxes
      setDragging(false)
      try { document.body.style.cursor = '' } catch { /* SSR */ }
    }

    setDragging(true)
    // Keep the resize cursor for the whole gesture even off the thin bar.
    try { document.body.style.cursor = type === 'v' ? 'col-resize' : 'row-resize' } catch { /* SSR */ }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [widgets, colWidth, rowHeight, minWFor, minHFor, onResize])

  if (!colWidth || !rowHeight) return null

  return (
    <div className={`${styles.seamOverlay} ${dragging ? styles.seamOverlayDragging : ''}`}>
      {seams.vertical.map(s => (
        <div
          key={s.key}
          className={styles.seamV}
          style={{
            left: s.c * colWidth - HANDLE_PX / 2,
            top: s.y0 * rowHeight,
            height: (s.y1 - s.y0) * rowHeight,
            width: HANDLE_PX,
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize columns"
          onPointerDown={(e) => onPointerDown(s, 'v', e)}
        />
      ))}
      {seams.horizontal.map(s => (
        <div
          key={s.key}
          className={styles.seamH}
          style={{
            top: s.r * rowHeight - HANDLE_PX / 2,
            left: s.x0 * colWidth,
            width: (s.x1 - s.x0) * colWidth,
            height: HANDLE_PX,
          }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize rows"
          onPointerDown={(e) => onPointerDown(s, 'h', e)}
        />
      ))}
    </div>
  )
}
