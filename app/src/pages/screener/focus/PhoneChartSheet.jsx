// PhoneChartSheet — the Focus layout's chart on a phone (spec 2026-10-16 s3): the selected stock's
// ChartPane full screen, over the list it came from. One header strip: "Back to list", then the
// up and down step buttons. A swipe steps stocks ONLY on that strip: the chart below it owns its
// own vertical drags (the price axis scales on one), so a gesture there must never step.
//
// It holds no selection of its own. The caller passes the row and the step callbacks, which move
// the list's useFocusSelection, so the sheet and the list are one authority.
import { useRef } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import styles from './FocusScreener.module.css'

// A deliberate swipe: at least this far, and mostly vertical (|dy| > 2·|dx|). Up = next stock.
export const SWIPE_MIN_PX = 60
// Movement before the strip takes the pointer. ⛔ Capturing on PRESS retargets the click that
// follows to the strip (Chromium sends a captured pointer's click to the capturing element), so
// "Back to list" and the step buttons did nothing for a mouse click (measured on production
// 2026-10-17 at 390 px: a touch tap stepped, a click did not). Capture only once it is a drag.
export const DRAG_SLOP_PX = 10

export default function PhoneChartSheet({ open, onClose, row, onPrev, onNext, canPrev, canNext, children }) {
  const start = useRef(null)
  const last = useRef(null)
  const captured = useRef(false)
  const down = e => {
    start.current = { x: e.clientX, y: e.clientY }
    last.current = start.current
    captured.current = false
  }
  const move = e => {
    if (!start.current) return
    last.current = { x: e.clientX, y: e.clientY }
    if (!captured.current && Math.abs(e.clientY - start.current.y) > DRAG_SLOP_PX) {
      captured.current = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
  }
  const up = e => {
    const s = start.current
    start.current = null
    if (!s) return
    const end = Number.isFinite(e.clientY) ? { x: e.clientX, y: e.clientY } : last.current
    const dy = end.y - s.y
    const dx = end.x - s.x
    if (Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) <= 2 * Math.abs(dx)) return
    if (dy < 0) { if (canNext) onNext() } else if (canPrev) onPrev()
  }
  const cancel = () => { start.current = null }
  return (
    <Sheet open={open && !!row} onClose={onClose} variant="fullscreen" ariaLabel={row?.ticker}
      className={styles.phoneSheet} bodyClassName={styles.phoneSheetBody}>
      <div className={styles.phoneSheetStrip} data-testid="phone-sheet-strip"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
        <button type="button" className={styles.phoneSheetBack} onClick={onClose}>
          <span aria-hidden="true">‹</span> Back to list
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.phoneSheetStep} aria-label="Previous stock" disabled={!canPrev} onClick={onPrev}>
          <span aria-hidden="true">↑</span>
        </button>
        <button type="button" className={styles.phoneSheetStep} aria-label="Next stock" disabled={!canNext} onClick={onNext}>
          <span aria-hidden="true">↓</span>
        </button>
      </div>
      {children}
    </Sheet>
  )
}
