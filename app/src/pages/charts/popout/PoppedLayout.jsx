import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
export default function PoppedLayout({ theme, title, initialWidgets, onClose, onBlocked, renderGrid, computeRowHeight, initialRowHeight }) {
  const [widgets, setWidgets] = useState(initialWidgets)

  // This board is viewport-locked to ITS window, not the one it came from, so it
  // measures its own body. Without this a board dragged onto a taller monitor
  // would keep the main tab's row height and leave the bottom rows empty.
  // Seeded from the opener's row height so the very first paint is sane, then
  // corrected to this window's own size. It must never start empty — a board
  // that renders nothing until a measure lands would stay blank entirely wherever
  // ResizeObserver is missing.
  const bodyRef = useRef(null)
  const [rowHeight, setRowHeight] = useState(initialRowHeight)
  const [gridWidth, setGridWidth] = useState(0)
  // Layout effect so the measured width lands BEFORE first paint (no 0-width flash).
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const win = el.ownerDocument.defaultView   // the POPPED window
    // popoutBody has 6px padding on each side; the grid gets the content width.
    const measure = () => {
      setRowHeight(computeRowHeight(el.clientHeight))
      setGridWidth(Math.max(0, el.clientWidth - 12))
    }
    measure()
    // Track resize in the POPPED window's OWN realm. A ResizeObserver created in
    // the opener does NOT reliably fire for nodes living in another document, so
    // the grid stayed frozen at the window's opening size and left blank space
    // when the user maximized it. The popped window's resize event + its own
    // ResizeObserver both fire correctly for its nodes.
    if (!win) return
    win.addEventListener('resize', measure)
    let ro
    if (typeof win.ResizeObserver !== 'undefined') {
      ro = new win.ResizeObserver(measure)
      ro.observe(el)
    }
    return () => {
      try { win.removeEventListener('resize', measure) } catch { /* window gone */ }
      if (ro) ro.disconnect()
    }
  }, [computeRowHeight])

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

  return (
    <PopoutWindow
      title={title}
      width={1400}
      height={900}
      onClose={handleClose}
      onBlocked={handleBlocked}
    >
      <PopoutShell theme={theme} bodyRef={bodyRef}>
        {renderGrid(widgets, handlers, rowHeight, gridWidth)}
      </PopoutShell>
    </PopoutWindow>
  )
}
