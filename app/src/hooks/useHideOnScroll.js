import { useEffect, useRef, useState } from 'react'

/**
 * Returns `true` while the user is actively scrolling DOWN through content, so
 * floating overlays (the voice orb, the feedback button) can tuck themselves
 * out of the way instead of covering what you're reading.
 *
 * Flips back to `false` on scroll up, when near the top, or shortly after
 * scrolling stops. Listens in the capture phase so it also catches inner
 * scroll containers (not just the window), and tracks each scroller's last
 * position independently.
 */
export default function useHideOnScroll({ threshold = 8, topGuard = 72, idleMs = 1400 } = {}) {
  const [hidden, setHidden] = useState(false)
  const positions = useRef(new WeakMap())
  const idleTimer = useRef(0)

  useEffect(() => {
    const seen = positions.current
    const onScroll = (e) => {
      const t = e.target
      const isDoc =
        t === document ||
        t === window ||
        t === document.documentElement ||
        t === document.body
      const top = isDoc
        ? window.scrollY || document.documentElement.scrollTop || 0
        : t.scrollTop || 0
      const prev = seen.get(t) ?? 0
      const dy = top - prev
      seen.set(t, top)

      // Always reappear shortly after scrolling stops.
      clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setHidden(false), idleMs)

      if (top <= topGuard) { setHidden(false); return }
      if (Math.abs(dy) < threshold) return
      setHidden(dy > 0) // scrolling down → hide; up → show
    }

    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true, passive: true })
      clearTimeout(idleTimer.current)
    }
  }, [threshold, topGuard, idleMs])

  return hidden
}
