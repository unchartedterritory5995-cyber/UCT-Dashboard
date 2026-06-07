import { useRef, useState, useCallback } from 'react'
import { impact } from './haptics'

/* useSwipeAction — horizontal swipe-to-reveal/trigger on a row (touch only).
 * Returns a live `offset` (px, for a translateX transform) and pointer props to
 * spread on the row. Crossing `threshold` on release fires the matching
 * callback. Swipe is an accelerator — always keep a visible fallback (kebab).
 *
 *   const { offset, props } = useSwipeAction({ onSwipeLeft: () => flag() })
 *   <div {...props} style={{ transform: `translateX(${offset}px)` }} />
 */
export default function useSwipeAction({ onSwipeLeft, onSwipeRight, threshold = 60, max = 96 } = {}) {
  const startX = useRef(0)
  const draggingRef = useRef(false)
  const [offset, setOffset] = useState(0)

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse') return // touch/pen only
    draggingRef.current = true
    startX.current = e.clientX
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!draggingRef.current) return
    const dx = e.clientX - startX.current
    // clamp and lightly resist past max
    const clamped = Math.max(-max, Math.min(max, dx))
    setOffset(clamped)
  }, [max])

  const finish = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setOffset((dx) => {
      if (dx <= -threshold) { impact(); onSwipeLeft?.() }
      else if (dx >= threshold) { impact(); onSwipeRight?.() }
      return 0
    })
  }, [threshold, onSwipeLeft, onSwipeRight])

  return {
    offset,
    props: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  }
}
