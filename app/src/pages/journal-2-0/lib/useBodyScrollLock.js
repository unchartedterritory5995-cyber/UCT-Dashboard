// Lock the page's scroll while a modal dialog is open, exactly as `components/mobile/Sheet.jsx`
// does, and put it back as it was on close.
//
// ⛔ This is not only about scrolling. `document.body.style.overflow === 'hidden'` is the ONE
// signal the app's floating buttons read to get out of the way of an open sheet or dialog
// (`hooks/useScrollLocked.js`; the voice orb and the feedback button both return null on it).
// A hand-rolled dialog that does not lock leaves them drawn on top of it: on a phone the voice
// orb sat on the "Delete this note?" button and took its tap (finish program, lane FE2, P1).
// Every Notebook dialog that is not a `Sheet` calls this.
import { useEffect } from 'react'

export default function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [active])
}
