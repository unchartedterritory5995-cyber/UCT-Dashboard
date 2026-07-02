/**
 * Tween a numeric value toward its latest target (Robinhood-style "the
 * number slides, it doesn't jump"). One rAF loop per hook instance,
 * cancelled on change/unmount.
 *
 * - First render: no tween (snap) — page loads shouldn't animate.
 * - prefers-reduced-motion: always snap.
 * - Non-finite targets (null/undefined/NaN) pass through untouched so
 *   callers keep their own dash-rendering rules.
 */
import { useEffect, useRef, useState } from 'react'

const reduceMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ease-out cubic — fast start, gentle landing
const ease = (t) => 1 - (1 - t) ** 3

export default function useAnimatedNumber(value, { duration = 350 } = {}) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const firstRef = useRef(true)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!Number.isFinite(value)) {
      fromRef.current = value
      setDisplay(value)
      return undefined
    }
    if (firstRef.current || !Number.isFinite(fromRef.current) || reduceMotion()) {
      firstRef.current = false
      fromRef.current = value
      setDisplay(value)
      return undefined
    }
    const from = fromRef.current
    if (from === value) return undefined
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const cur = from + (value - from) * ease(t)
      setDisplay(t >= 1 ? value : cur)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      fromRef.current = value
    }
  }, [value, duration])

  return display
}
