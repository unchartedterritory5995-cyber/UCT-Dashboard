import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PopoutWindow from './PopoutWindow'
import PopoutShell from './PopoutShell'

/**
 * A whole workspace board living in its own window.
 *
 * It takes a SNAPSHOT of the widgets at pop-out time and owns them from then
 * on, which is what makes a popped board independent: opening a different
 * layout, or rearranging the now-blank main tab, can't reach in and disturb a
 * board sitting on another monitor. Closing the window hands its widgets back
 * so the caller can dock them into the main grid.
 *
 * The grid itself is supplied by the caller via `renderGrid` rather than rebuilt
 * here — the workspace owns the RGL configuration (column count, row height,
 * breakpoints, viewport lock), and a second copy of that config would be free to
 * drift out of sync with the main board.
 */
export default function PoppedLayout({ theme, title, initialWidgets, onClose, onBlocked, renderGrid, computeRowHeight, initialRowHeight, merged = false }) {
  const [widgets, setWidgets] = useState(initialWidgets)

  // This board is viewport-locked to ITS window, not the one it came from, so it
  // measures its own body. Without this a board dragged onto a taller monitor
  // would keep the main tab's row height and leave the bottom rows empty.
  // Seeded from the opener's row height so the very first paint is sane, then
  // corrected to this window's own size. It must never start empty — a board
  // that renders nothing until a measure lands would stay blank entirely wherever
  // ResizeObserver is missing.
  // Callback ref (not useRef): fires when the popoutBody actually attaches to the
  // popped document, which happens a beat AFTER this component mounts (PopoutWindow
  // creates the container asynchronously). A plain-ref effect ran too early — the
  // node was null and it bailed, so the width was never measured.
  const [bodyEl, setBodyEl] = useState(null)
  const [rowHeight, setRowHeight] = useState(initialRowHeight)
  const [gridWidth, setGridWidth] = useState(0)
  useEffect(() => {
    const el = bodyEl
    const win = el?.ownerDocument?.defaultView
    if (!el || !win) return
    const measure = () => {
      // Measure the BODY, not the window. `win.innerHeight` includes chrome the
      // body doesn't get, and the merged/unmerged padding difference lives on this
      // element — reading it directly is what keeps the shared row-height math and
      // the real DOM in agreement (a mismatch clips the bottom widget's date axis).
      // clientHeight/clientWidth include padding, which is exactly what
      // computeRowHeight expects (it subtracts the padding itself).
      const w = el.clientWidth || win.innerWidth
      const h = el.clientHeight || win.innerHeight
      const pad = merged ? 0 : 6
      if (w > 200) {
        setGridWidth(w - pad * 2)
        setRowHeight(computeRowHeight(h))
      }
    }
    measure()
    win.addEventListener('resize', measure)
    let ro
    try { ro = new win.ResizeObserver(measure); ro.observe(el) } catch { /* no RO in popup realm */ }
    const timers = [100, 400, 1000].map(ms => win.setTimeout(measure, ms))
    return () => {
      try {
        win.removeEventListener('resize', measure)
        timers.forEach(t => win.clearTimeout(t))
      } catch { /* window gone */ }
      if (ro) ro.disconnect()
    }
  }, [bodyEl, computeRowHeight, merged])

  // onClose needs the widgets as they stand when the window actually closes, not
  // as they were when the handler was created.
  const widgetsRef = useRef(widgets)
  useEffect(() => { widgetsRef.current = widgets }, [widgets])

  const handlers = useMemo(() => ({
    onLayoutChange: (rglLayout) => setWidgets(prev => {
      const byId = Object.fromEntries(rglLayout.map(l => [l.i, l]))
      return prev.map(w => {
        const l = byId[w.id]
        return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w
      })
    }),
    onRemove: (id) => setWidgets(prev => prev.filter(w => w.id !== id)),
    onColorChange: (id, color) => setWidgets(prev => prev.map(w => (w.id === id ? { ...w, color } : w))),
    onOptsChange: (id, opts) => setWidgets(prev => prev.map(w => (w.id === id ? { ...w, opts } : w))),
    // Popping a single widget out of an already-popped board would need a third
    // owner for that widget's state; the window itself is already the unit of
    // "move this to another monitor", so the control is left off in here.
    onPopOut: null,
  }), [])

  const handleClose = useCallback(() => {
    onClose(widgetsRef.current)
  }, [onClose])

  // Blocked is NOT just a close: the board has already been lifted off the main
  // tab at this point, so it has to be handed back AND the user told why nothing
  // appeared — otherwise their layout silently vanishes and reappears.
  const handleBlocked = useCallback(() => {
    (onBlocked || onClose)(widgetsRef.current)
  }, [onBlocked, onClose])

  // Open at the full screen size so the grid (WidthProvider measures the container
  // on mount) fills the monitor immediately — the window opened at 1400px before,
  // leaving blank space on a wider screen, and WidthProvider doesn't re-measure a
  // cross-document node on maximize. Capped so an ultrawide doesn't get absurd.
  const scr = typeof window !== 'undefined' ? window.screen : null
  const winW = scr?.availWidth ? Math.min(scr.availWidth, 3440) : 1400
  const winH = scr?.availHeight ? Math.min(scr.availHeight, 1440) : 900

  return (
    <PopoutWindow
      title={title}
      width={winW}
      height={winH}
      onClose={handleClose}
      onBlocked={handleBlocked}
    >
      <PopoutShell theme={theme} bodyRef={setBodyEl} merged={merged}>
        {renderGrid(widgets, handlers, rowHeight, gridWidth)}
      </PopoutShell>
    </PopoutWindow>
  )
}
