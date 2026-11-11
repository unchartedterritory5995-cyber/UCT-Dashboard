import { useEffect, useRef, useState } from 'react'
import { sessionState } from '../../../lib/marketClock/marketClock'

// Debounced POST /api/screener/scan whenever the spec changes. A null spec
// skips fetching. Filtering reads the server's live overlay during the session
// (`live_tier`, the price-anchored columns recomputed every sweep) over the
// nightly snapshot.
//
// LIVE REFRESH (2026-11-10, owner: "people should be able to see the lists and scans
// move in real time"). With `refreshMs` set, the CURRENT spec is asked again every
// `refreshMs` while `isLive()` says so (the regular session, tab visible), so a
// ticker enters or leaves the list without the member touching anything. A refresh
// is QUIET: no loading state (the rows stay on screen and are swapped in place),
// and a failed refresh keeps the answer already shown instead of raising an error
// over a list that was fine a moment ago. It never fires while a request is in
// flight or while an edit is waiting on the debounce: that request owns the screen,
// and only for page 1 (see the interval below).
// ⛔ The server recomputes its overlay about once a minute (a sweep takes 20-60 s on
// production), so refreshing faster than ~15 s buys nothing and costs a scan query
// per member per tick.
//
// `answeredSpec` is the spec object the current `result` was asked for (the same
// reference the caller passed), so a caller can tell an answer for an earlier spec
// from one for the spec it holds now.
//
// `leading` (opt-in, default off, so ScannerShell keeps its exact behaviour): fire at
// once when no request is waiting on the debounce, then debounce only the rapid edits
// that follow inside the window. A first load or a deliberate screen switch then
// costs no 300 ms wait.
//
// REVISITS ARE INSTANT (2026-10-17). Each mount keeps the last page-1 answers it received, by
// spec. Coming back to a screen shows its last answer at once, with the spec the caller holds
// now (so `answeredSpec` is the caller's current object), and asks again only if that answer
// is more than ANSWER_FRESH_MS old -- the fresh answer then replaces it as usual. Before, every
// switch back waited ~230 ms (measured on production) for an answer the page already had.
export const ANSWER_FRESH_MS = 15_000
const ANSWER_KEEP_MS = 10 * 60_000
const ANSWER_MAX = 24
export { LIVE_REFRESH_MS } from './liveRefresh'

// Is a live refresh due right now? The regular session on the real NYSE calendar, with the tab visible
// (a hidden tab refreshing is a scan query nobody sees).
// ⛔ NEVER UNDER VITEST: a refresh that reads the wall clock makes every test that renders a screen a
// function of the HOUR it runs in (extra fetches during 9:30-16:00 ET only). The refresh's own tests
// inject `isLive`.
export function defaultIsLive(now = new Date()) {
  if (import.meta.env?.MODE === 'test') return false
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  try { return !!sessionState(now).isOpen } catch { return false }
}

export default function useScreenerScan(spec, { debounce = 300, leading = false, refreshMs = 0,
                                               isLive = defaultIsLive } = {}) {
  const [answer, setAnswer] = useState({ result: null, spec: null })
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef()
  const seq = useRef(0) // guards against out-of-order responses
  const firedKey = useRef(null)
  const trailing = useRef(false) // leading mode: the pending timer will fire a request
  const kept = useRef(new Map()) // key -> { result, at }: this mount's page-1 answers
  const inFlight = useRef(0)
  const specRef = useRef(spec) // the caller's CURRENT object, so `answeredSpec` stays its reference
  specRef.current = spec
  const isLiveRef = useRef(isLive)
  isLiveRef.current = isLive
  const key = spec ? JSON.stringify(spec) : null

  const run = async (asked, askedKey, { quiet = false } = {}) => {
    firedKey.current = askedKey
    const mySeq = ++seq.current
    inFlight.current += 1
    if (!quiet) {
      setLoading(true)
      setError(null)
    }
    try {
      const r = await fetch('/api/screener/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asked),
      })
      if (mySeq !== seq.current) return // a newer request superseded this one
      if (!r.ok) {
        let detail = `scan ${r.status}`
        try { detail = (await r.json())?.detail || detail } catch { /* keep status text */ }
        // `status` is what the shell words the failure from; `detail` stays on the error for
        // logs only (it is server text, not member copy -- shell/scanErrorText.js).
        const err = new Error(typeof detail === 'string' ? detail : `scan ${r.status}`)
        err.status = r.status
        throw err
      }
      const json = await r.json()
      if (json && (json.page == null || json.page === 1)) {
        kept.current.delete(askedKey)
        kept.current.set(askedKey, { result: json, at: Date.now() })
        while (kept.current.size > ANSWER_MAX) kept.current.delete(kept.current.keys().next().value)
      }
      if (mySeq !== seq.current) return
      setAnswer({ result: json, spec: asked })
      if (quiet) setError(null) // a refresh that succeeded clears an earlier failure
    } catch (e) {
      if (mySeq === seq.current && !quiet) setError(e)
    } finally {
      inFlight.current -= 1
      if (mySeq === seq.current && !quiet) setLoading(false)
    }
  }

  useEffect(() => {
    if (!key || !(refreshMs > 0)) return undefined
    const id = setInterval(() => {
      if (inFlight.current > 0) return // a request owns the screen
      // ⛔ PAGE 1 ONLY. Both screens ACCUMULATE pages (a later page appends tickers not yet listed and
      // marks paging exhausted when it adds none), so re-asking page 3 would never drop a ticker that
      // left and would stop load-more. A member scrolled past page 1 keeps the list they are reading.
      if ((specRef.current?.page ?? 1) > 1) return
      // An edit waiting on the debounce: `firedKey` still names the spec before it (and in leading mode
      // `trailing` says a queued edit will fire). That request is the next answer, not this refresh.
      if (trailing.current || firedKey.current !== key) return
      if (!isLiveRef.current()) return
      run(specRef.current, key, { quiet: true })
    }, refreshMs)
    return () => clearInterval(id)
  }, [key, refreshMs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key) {
      // Leading mode keeps its timer across key changes, so a queued edit is dropped here.
      if (leading) { clearTimeout(timer.current); timer.current = null; trailing.current = false }
      return undefined
    }
    const hit = kept.current.get(key)
    const age = hit ? Date.now() - hit.at : Infinity
    if (age < ANSWER_KEEP_MS) {
      ++seq.current // an answer still in flight for an earlier spec no longer replaces this one
      setAnswer({ result: hit.result, spec })
      setLoading(false)
      if (age < ANSWER_FRESH_MS) {
        clearTimeout(timer.current)
        if (leading) { timer.current = null; trailing.current = false }
        firedKey.current = key
        return undefined
      }
    }
    if (!leading) {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => run(spec, key), debounce)
      return () => clearTimeout(timer.current)
    }
    // The quiet window: a timer is pending for `debounce` ms after each fire. With none
    // pending this edit fires now; inside the window it waits, and the last edit wins.
    const quiet = () => {
      trailing.current = false
      timer.current = setTimeout(() => { timer.current = null }, debounce)
    }
    if (key === firedKey.current) {
      // Back to the spec already on the wire (or a re-run of this effect): nothing new to
      // ask, and a queued edit it replaced must not fire.
      if (trailing.current) { clearTimeout(timer.current); quiet() }
      return undefined
    }
    if (timer.current == null) {
      run(spec, key)
      quiet()
    } else {
      clearTimeout(timer.current)
      trailing.current = true
      timer.current = setTimeout(() => { run(spec, key); quiet() }, debounce)
    }
    return undefined
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leading mode keeps its quiet window across key changes, so it is cleared only here.
  useEffect(() => () => clearTimeout(timer.current), [])

  return { result: answer.result, answeredSpec: answer.spec, isLoading, error }
}
