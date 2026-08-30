/**
 * The scrubber's playback vocabulary, in one place so the control and the
 * interval it drives cannot end up with two answers.
 *
 * ⭐ `usePrefersReducedMotion` is the SINGLE reader of the media query, and both
 * the play button (which disables itself) and the interval (which refuses to
 * start) consult it. A disabled button on its own is a UI gate, and a UI gate
 * alone is the shape of guard this repo keeps finding inert — so the refusal
 * lives at the mechanism as well as at the control, off one value.
 */
import { useEffect, useState } from 'react'

export const SPEEDS = [4, 8, 16]
export const DEFAULT_SPEED = 8

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

// One sentence, said in two places (the disabled control's title and the
// visible note). Typed twice it would drift the first time either is reworded.
export const REDUCED_MOTION_NOTE =
  'Autoplay is off because your system asks for reduced motion. Scrubbing still works.'

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !!window.matchMedia(REDUCED_MOTION_QUERY).matches
  ))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (e) => setReduce(!!e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduce
}
