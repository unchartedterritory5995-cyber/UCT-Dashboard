import { useEffect, useState } from 'react'

/**
 * Returns `true` while the page body scroll is locked — i.e. a modal, sheet, or
 * drawer is open (they set `document.body.style.overflow = 'hidden'`). Floating
 * overlays (the voice orb, the feedback button) use this to hide themselves so
 * they never cover a modal's bottom CTA ("Done", "View Chart", etc.) on mobile.
 *
 * Watches the body `style` attribute via MutationObserver so it reacts the
 * instant any overlay locks/unlocks scroll, regardless of which component did it.
 */
export default function useScrollLocked() {
  const [locked, setLocked] = useState(
    typeof document !== 'undefined' && document.body.style.overflow === 'hidden'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const read = () => setLocked(document.body.style.overflow === 'hidden')
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => obs.disconnect()
  }, [])

  return locked
}
