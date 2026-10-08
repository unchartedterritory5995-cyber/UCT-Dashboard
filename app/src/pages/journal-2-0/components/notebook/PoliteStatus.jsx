// PoliteStatus -- a screen-reader-only status that is actually announced (lane FIN-A11Y,
// review R4: M-3 and the "mounted together with their text" note in M-16).
//
// A `role="status"` element that MOUNTS already holding its text is often not announced:
// a live region is announced when its content CHANGES, and several screen readers
// (VoiceOver above all) do not treat the first paint as a change. This mounts the region
// EMPTY and fills it a moment later, and when `text` changes it changes the same element.
//
// It is for words that are ALSO on screen (so it is hidden from sight with `.sr-only`) or
// for a result that has no visible home. It never takes focus.
import { useEffect, useState } from 'react'

const SETTLE_MS = 60

export default function PoliteStatus({ text, ...rest }) {
  const [said, setSaid] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSaid(text || ''), SETTLE_MS)
    return () => clearTimeout(t)
  }, [text])
  return <span className="sr-only" role="status" {...rest}>{said}</span>
}
