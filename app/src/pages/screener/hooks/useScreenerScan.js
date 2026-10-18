import { useEffect, useRef, useState } from 'react'

// Debounced POST /api/screener/scan whenever the spec changes. A null spec
// skips fetching. Filtering uses the nightly snapshot (live prices overlay
// the result rows for display only).
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
export default function useScreenerScan(spec, { debounce = 300, leading = false } = {}) {
  const [answer, setAnswer] = useState({ result: null, spec: null })
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef()
  const seq = useRef(0) // guards against out-of-order responses
  const firedKey = useRef(null)
  const trailing = useRef(false) // leading mode: the pending timer will fire a request
  const kept = useRef(new Map()) // key -> { result, at }: this mount's page-1 answers
  const key = spec ? JSON.stringify(spec) : null

  const run = async (asked, askedKey) => {
    firedKey.current = askedKey
    const mySeq = ++seq.current
    setLoading(true)
    setError(null)
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
    } catch (e) {
      if (mySeq === seq.current) setError(e)
    } finally {
      if (mySeq === seq.current) setLoading(false)
    }
  }

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
