//
// The §4.4 / §7 settle debounce. Arrow-key stepping across a 40-name day is
// exactly the banned per-card fetch-storm class: the modal's own
// AbortController covers only the modal's own fetches, NOT the child SWR hooks
// each section owns. So sections key off the SETTLED symbol, and only the
// live-price poll follows the raw one.
//
// The FIRST symbol settles immediately — opening a modal must never cost 200ms
// of deliberate latency; the debounce exists for CHANGES, not for mounts.
import { useEffect, useRef, useState } from 'react'

export const SETTLE_MS = 200

export default function useSettledSym(sym, delay = SETTLE_MS) {
  const [settled, setSettled] = useState(sym)
  const settledRef = useRef(sym)
  settledRef.current = settled

  useEffect(() => {
    if (sym === settledRef.current) return undefined
    const t = setTimeout(() => setSettled(sym), delay)
    return () => clearTimeout(t)
  }, [sym, delay])

  return { settled, stepping: sym !== settled }
}
