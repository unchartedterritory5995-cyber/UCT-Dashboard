import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The /charts chart widget's symbol menu: a small ▾ right after the company name that
// opens a dropdown of the symbol's context actions (leveraged-ETF switcher, ETF holdings).
// Owner 11-11: shown inline these crowded the title row.
//
// The dropdown is portaled to the button's own document (works in popped-out windows) and
// positioned `fixed`, because the header is overflow-hidden. Its CONTENT stays mounted while
// closed (just hidden): the View Holdings control owns the holdings panel it opens (and the
// UCT Agent's holdings door), so unmounting it on close would close that panel too.
export default function SymbolActionsMenu({ children, styles, themeVars = null, label = 'More for this symbol' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [target, setTarget] = useState(null)
  const btnRef = useRef(null)
  // Portal target = the button's own document (a popped-out window has its own body).
  const setBtn = (el) => {
    btnRef.current = el
    const body = el?.ownerDocument?.body || null
    if (body && body !== target) setTarget(body)
  }

  useLayoutEffect(() => {
    const btn = btnRef.current
    if (!open || !btn) return undefined
    const win = btn.ownerDocument.defaultView || window
    const place = () => {
      const r = btn.getBoundingClientRect()
      const W = 300
      setPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left - 10, win.innerWidth - W - 8))) })
    }
    place()
    win.addEventListener('resize', place)
    win.addEventListener('scroll', place, true)
    return () => { win.removeEventListener('resize', place); win.removeEventListener('scroll', place, true) }
  }, [open])

  // Close on an outside click or Escape. Clicks inside the dropdown — or inside a menu /
  // panel one of its controls portals out (the leveraged-ETF list is role="menu") — stay.
  useEffect(() => {
    if (!open) return undefined
    const doc = btnRef.current?.ownerDocument || document
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-symbol-actions-menu], [role="menu"], [role="dialog"]')) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button
        ref={setBtn}
        type="button"
        className={`${styles.symbolActionsCaret} charts-no-drag`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-guide="chart.symbolActions"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="7" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {target && createPortal(
        <div
          data-symbol-actions-menu=""
          className={styles.symbolActionsMenu}
          role="group"
          aria-label={label}
          hidden={!open || !pos}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ...(themeVars || {}) }}
        >
          {children}
        </div>,
        target,
      )}
    </>
  )
}
