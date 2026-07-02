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
  // The value currently ON SCREEN — a new tween interrupting an in-flight one
  // starts from here (not from the previous TARGET, which would visibly jump).
  const shownRef = useRef(value)
  const firstRef = useRef(true)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!Number.isFinite(value)) {
      shownRef.current = value
      setDisplay(value)
      return undefined
    }
    if (firstRef.current || !Number.isFinite(shownRef.current) || reduceMotion()) {
      firstRef.current = false
      shownRef.current = value
      setDisplay(value)
      return undefined
    }
    const from = shownRef.current
    if (from === value) return undefined
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const cur = t >= 1 ? value : from + (value - from) * ease(t)
      shownRef.current = cur
      setDisplay(cur)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  return display
}
