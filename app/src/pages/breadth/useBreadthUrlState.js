/**
 * The Breadth tab's half of the URL contract (spec §5). All of the *rules* live
 * in the pure `breadthUrlState.js`; this is only the React/router plumbing.
 *
 * ⛔ NO BARE `window.history.replaceState`, for the reason
 * `pages/calendar/useEarningsModalRoute.js` states at the top of the file: this
 * app routes with React Router, and a raw history write desyncs the router's
 * copy of the query, so the next router-driven write silently reinstates the
 * params it thought were current. Writes go through `setSearchParams(…, {
 * replace: true })`, which IS a `replaceState` — one history entry, no back-
 * button spam — and keeps the router's location in step.
 *
 * ⭐ AND EVERY WRITE IS A MERGE. `mergeParams` is imported from that same
 * calendar module rather than re-typed here: it is the repo's one author of
 * "copy the current params and apply a patch (null deletes)", and a second copy
 * is how an unrelated key gets dropped by whichever surface writes last.
 *
 * READ ONCE, WRITE MANY — deliberately asymmetric. `initial` is parsed on the
 * first render and never re-read, so the params this hook writes cannot loop
 * back in as new input. That is what the spec asks for ("read on mount"), and
 * it is also the only shape in which a debounced writer is safe: a live read
 * would turn every settled write into a state change, and the scrubber would
 * fight its own URL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ BROWSER BACK DOES NOT RE-APPLY THE LINK, AND THAT IS A DECISION.
 *
 * It reads at first like an omission — a shareable-link feature where Back does
 * nothing is a surprise — so here is the reasoning, in the file that owns it.
 *
 *  1. **There is nothing to go back TO.** Every write above is `replace: true`,
 *     so scrubbing, switching a lens and opening Compare create no history
 *     entries at all. Back therefore leaves the Breadth page, which is what a
 *     reader who never "navigated" expects, and it is pinned by the "REPLACES
 *     — one history entry" rail in this hook's test.
 *  2. **The alternative is the loop this hook exists to avoid.** Making Back
 *     re-apply means reading the query LIVE, and a live read beside a debounced
 *     writer turns each settled write back into input: the cursor would fight
 *     its own URL 300ms after every step of playback. Half-fixing it — a
 *     `popstate` listener that re-parses only on a real pop — is a SECOND
 *     authority on "what does the link say", beside `initial`, and this repo's
 *     most repeated defect is two authorities over one value.
 *  3. **Pushing an entry per state change is worse than either.** Sixteen
 *     sessions a second of playback would bury whatever the reader was on
 *     before under a hundred entries of the same page.
 *
 * The link is an ENTRY condition for a page visit (see the block in
 * `pages/Breadth.jsx` that spends it), and Back is how you leave the visit.
 * Changing that is a product decision, not a bug fix: the rail named
 * "the link is an ENTRY condition" in this hook's test fails if `initial` ever
 * starts tracking the query, so the next person to try it has to say so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mergeParams } from '../calendar/useEarningsModalRoute'
import { parseBreadthParams, serializeBreadthParams } from './breadthUrlState'

// Long enough that a 16-sessions-per-second playback run collapses to a single
// write when it stops, short enough that a copied link is never behind.
export const URL_WRITE_DEBOUNCE_MS = 300

export default function useBreadthUrlState({
  dayChoices, enabled = true, debounceMs = URL_WRITE_DEBOUNCE_MS,
} = {}) {
  const [params, setParams] = useSearchParams()

  // Parsed on the first render only — see READ ONCE above. A lazy `useState`
  // initializer, not a memo: a memo is allowed to recompute, and this must not.
  const [initial] = useState(() => parseBreadthParams(params, { dayChoices }))

  const timer = useRef(null)
  const pendingRef = useRef(null)

  const write = useCallback((state) => {
    if (!enabled) return
    pendingRef.current = serializeBreadthParams(state)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const patch = pendingRef.current
      pendingRef.current = null
      if (!patch) return
      setParams(prev => mergeParams(prev, patch), { replace: true })
    }, debounceMs)
  }, [enabled, debounceMs, setParams])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return useMemo(() => ({ initial, write }), [initial, write])
}
