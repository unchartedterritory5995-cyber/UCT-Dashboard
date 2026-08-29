// app/src/components/chart/BoardsToolButton.jsx — the Drawing Boards toolbar button.
//
// Renders as a normal drawing-tool button (the toolbar passes its own scoped
// button classes so it is visually IDENTICAL to the trendline/fib/etc. buttons) and
// opens TracingsPanel (the board manager) in a portal below it. Self-contained:
// ChartToolbar drops it in at the end of the drawing tools.
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import TracingsPanel from './TracingsPanel'

// Stacked sheets glyph, drawn in the exact style of the toolbar's other tool icons
// (16 viewBox, 14px, currentColor stroke, 1.3 weight) so it sits flush with them.
const BoardsIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2.5" width="9.5" height="9.5" rx="1.4" />
    <rect x="2.5" y="4.5" width="9.5" height="9.5" rx="1.4" />
  </svg>
)

export default function BoardsToolButton({ btnClassName = '', activeClassName = '', currentSym = null }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  // Position the panel just below the button, kept on-screen (panel ~288px wide).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - 300)
    setPos({ left: Math.max(6, left), top: Math.round(r.bottom + 6) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${btnClassName} ${open ? activeClassName : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Drawing Boards"
        aria-label="Drawing Boards"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BoardsIcon />
      </button>

      {open && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', zIndex: 4000, left: pos.left, top: pos.top }}>
          <TracingsPanel currentSym={currentSym} onClose={() => setOpen(false)} />
        </div>,
        document.body,
      )}
    </>
  )
}
