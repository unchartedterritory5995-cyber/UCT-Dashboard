import { useRef, useCallback } from 'react'

/* useLongPress — unified long-press (touch) + right-click (desktop) handler.
 *
 * One binding serves both inputs: spread the returned props onto any element.
 * Long-press fires after `ms` if the pointer hasn't moved past `moveTolerance`
 * (so it never fires mid-scroll). Right-click fires immediately.
 *
 *   const lp = useLongPress((e) => openMenu(e))
 *   <div {...lp}>…</div>
 *
 * The handler receives the originating event; read clientX/clientY for anchor.
 */
export default function useLongPress(handler, { ms = 450, moveTolerance = 10 } = {}) {
  const timer = useRef(null)
  const start = useRef({ x: 0, y: 0 })
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const onPointerDown = useCallback((e) => {
    // Only long-press for touch/pen; mouse uses native contextmenu (right-click)
    if (e.pointerType === 'mouse') return
    firedRef.current = false
    start.current = { x: e.clientX, y: e.clientY }
    const ev = e
    clear()
    timer.current = setTimeout(() => {
      firedRef.current = true
      try { navigator.vibrate?.(10) } catch { /* noop */ }
      handler?.(ev)
    }, ms)
  }, [handler, ms, clear])

  const onPointerMove = useCallback((e) => {
    if (!timer.current) return
    const dx = Math.abs(e.clientX - start.current.x)
    const dy = Math.abs(e.clientY - start.current.y)
    if (dx > moveTolerance || dy > moveTolerance) clear()
  }, [moveTolerance, clear])

  const onPointerUp = useCallback(() => clear(), [clear])
  const onPointerCancel = useCallback(() => clear(), [clear])

  const onContextMenu = useCallback((e) => {
    // Desktop right-click — fire immediately
    handler?.(e)
  }, [handler])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu }
}
