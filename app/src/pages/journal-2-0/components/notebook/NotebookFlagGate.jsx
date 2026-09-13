import { useEffect, useState } from 'react'
import { notebookFlagsReady } from '../../lib/offline/notebookFlags'

/**
 * Wave K — the first-render gate. Shape A, and it is the only admissible shape.
 *
 * ⛔⛔ WHY A GATE AND NOT A REACTIVE FLAG. The alternative was a reactive flag
 * whose pre-payload value is the compile-time constant. That constant is `true`.
 * So if the server says `false`, the reactive shape renders the Notebook with
 * the wave ON, then turns it off when the payload lands — and in that window the
 * durable layer can open the account's IndexedDB, take the sync Web Lock, and
 * write a working copy.
 *
 * That is not a wrong frame. It is a WRITE, and **§21** forbids exactly this:
 * switching the wave off must write NOTHING. The gate is what makes §21 true
 * across the moment the answer arrives, and `K-R4` is the rail that proves it.
 *
 * ⛔ IT GATES THE NOTEBOOK ONLY. No other route waits on anything. The Notebook
 * is already lazy-loaded and already shows a loading state, so the cost is
 * bounded by `CONFIG_TIMEOUT_MS` and paid on one surface.
 *
 * ⛔ THE TIMEOUT IS NOT A FAILURE PATH — IT IS THE FAILURE PATH'S DEADLINE. When
 * it fires, the children render and `offlineEnabled()` falls back to the
 * compile-time constant, which is precisely the behaviour before Wave K. A
 * member whose auth payload is slow gets the Notebook they had yesterday, not a
 * spinner that never ends.
 */
export const CONFIG_TIMEOUT_MS = 3000

export default function NotebookFlagGate({ children, fallback = null, timeoutMs = CONFIG_TIMEOUT_MS }) {
  // ⛔ Seeded from the CURRENT latch state, not from `false`. On every render
  // after the first payload — a tab switch, a re-mount — the flags are already
  // latched and the gate must not flash a loading state at a member whose
  // answer has been known for minutes.
  const [ready, setReady] = useState(() => notebookFlagsReady())
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (ready) return undefined
    let alive = true
    // ⛔ POLLED, NOT SUBSCRIBED, and deliberately. The latch is module state fed
    // from `AuthContext`'s four auth paths; giving it an event emitter would
    // make it a second thing to keep in sync with the latch itself, for a value
    // that resolves once and never moves. 50 ms for at most `timeoutMs`.
    const iv = setInterval(() => {
      if (!alive) return
      if (notebookFlagsReady()) { setReady(true); clearInterval(iv) }
    }, 50)
    const to = setTimeout(() => { if (alive) setTimedOut(true) }, timeoutMs)
    return () => { alive = false; clearInterval(iv); clearTimeout(to) }
  }, [ready, timeoutMs])

  // ⛔⛔ NOTHING RENDERS UNTIL ONE OF THE TWO IS TRUE. Not the editor, not the
  // drain, not a hidden mount that "just reads" — every one of those is a
  // component that can reach the store.
  if (!ready && !timedOut) return fallback
  return children
}
