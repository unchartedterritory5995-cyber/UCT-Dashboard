// Draggable seam handles for merged mode — the TC2000 "grab the divider between
// two widgets and drag to resize both" behavior. Rendered as an absolutely-
// positioned layer over the (margin-0) merged grid; only the thin seam bars are
// interactive, so the widgets between them stay fully usable. Each drag snaps to
// whole grid columns/rows and grows one side while shrinking the neighbor, so the
// board never gaps or overlaps (all math in the pure mergedSeams module).
//
// Drag mechanics: the layout updates live as you drag (preview), which MOVES the
// dragged seam bar to the new boundary and remounts it (its React key is the
// boundary column/row). So we CANNOT rely on the bar element for move/up — a
// pointer capture on it would die on the first remount. Instead we attach ONE
// stable pair of window listeners on pointer-down (via latest-logic refs, immune
// to re-render) and drive everything off a drag snapshot. The bar visibly follows
// the cursor because it re-renders at the new boundary each column step.

import { useCallback, useMemo, useRef, useState } from 'react'
import { computeSeams, applyVerticalDrag, applyHorizontalDrag } from './mergedSeams'
import styles from './ChartsWorkspace.module.css'

const HANDLE_PX = 8   // hit-area thickness of a seam bar (visual line is thinner)

export default function MergedSeamOverlay({
  widgets, cols, rows, colWidth, rowHeight,
  minWFor, minHFor, onResize,   // onResize(nextWidgets, commit:boolean)
}) {
  const seams = useMemo(() => computeSeams(widgets, cols, rows), [widgets, cols, rows])
  const [dragging, setDragging] = useState(false)
  // Snapshot the layout + pointer origin at drag start; each move computes an
  // ABSOLUTE delta from that base (never compounds frame-to-frame).
  const dragRef = useRef(null)

  // Latest move/up logic in refs so the two STABLE window listeners below always
  // call current closures (correct colWidth/onResize) without re-subscribing —
  // and survive the dragged bar remounting when the layout previews.
  const moveLogic = useRef(null)
  const upLogic = useRef(null)
  // Preview uses a FRACTIONAL column/row delta (no rounding) so the drag is
  // pixel-smooth instead of jumping grid-cell to grid-cell; we remember the
  // clamped fractional delta and snap it to a clean integer only on release.
  moveLogic.current = (e) => {
    const d = dragRef.current
    if (!d) return
    let res
    if (d.type === 'v') {
      const deltaCols = (e.clientX - d.startClient) / colWidth
      res = applyVerticalDrag(d.baseWidgets, d.line, deltaCols, minWFor)
    } else {
      const deltaRows = (e.clientY - d.startClient) / rowHeight
      res = applyHorizontalDrag(d.baseWidgets, d.line, deltaRows, minHFor)
    }
    d.lastApplied = res.applied
    onResize(res.widgets, false)
  }
  upLogic.current = () => {
    const d = dragRef.current
    if (d) {
      // Snap to whole columns/rows for a clean, valid saved layout — a ≤½-cell
      // settle at the very end, never a jump during the drag.
      const intDelta = Math.round(d.lastApplied || 0)
      const final = d.type === 'v'
        ? applyVerticalDrag(d.baseWidgets, d.line, intDelta, minWFor).widgets
        : applyHorizontalDrag(d.baseWidgets, d.line, intDelta, minHFor).widgets
      onResize(final, true)   // persist once, on release
    }
    finishDrag()
  }

  // Stable listener identities (created once) that delegate to the latest logic.
  const winMoveRef = useRef(null)
  const winUpRef = useRef(null)
  if (!winMoveRef.current) winMoveRef.current = (e) => moveLogic.current?.(e)
  if (!winUpRef.current) winUpRef.current = (e) => upLogic.current?.(e)

  const finishDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
    window.removeEventListener('pointermove', winMoveRef.current)
    window.removeEventListener('pointerup', winUpRef.current)
    try { document.body.style.cursor = '' } catch { /* SSR */ }
  }, [])

  const onPointerDown = useCallback((type, line, e) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      type, line,
      startClient: type === 'v' ? e.clientX : e.clientY,
      baseWidgets: widgets,
      lastWidgets: widgets,
    }
    setDragging(true)
    // Keep the resize cursor for the whole gesture even when the pointer strays
    // off the thin bar (the bar snaps in column steps and may momentarily lag).
    try { document.body.style.cursor = type === 'v' ? 'col-resize' : 'row-resize' } catch { /* SSR */ }
    window.addEventListener('pointermove', winMoveRef.current)
    window.addEventListener('pointerup', winUpRef.current)
  }, [widgets])

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
          onPointerDown={(e) => onPointerDown('v', s.c, e)}
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
          onPointerDown={(e) => onPointerDown('h', s.r, e)}
        />
      ))}
    </div>
  )
}
