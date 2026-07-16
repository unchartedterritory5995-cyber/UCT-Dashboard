import { useEffect, useRef, useState } from 'react'

// Debounced POST /api/screener/scan whenever the spec changes. A null spec
// skips fetching. Filtering uses the nightly snapshot (live prices overlay
// the result rows for display only).
export default function useScreenerScan(spec, { debounce = 300 } = {}) {
  const [result, setResult] = useState(null)
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef()
  const seq = useRef(0) // guards against out-of-order responses
  const key = spec ? JSON.stringify(spec) : null

  useEffect(() => {
    if (!key) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current
      setLoading(true)
      setError(null)
      try {
        const r = await fetch('/api/screener/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        })
        if (mySeq !== seq.current) return // a newer request superseded this one
        if (!r.ok) {
          let detail = `scan ${r.status}`
          try { detail = (await r.json())?.detail || detail } catch { /* keep status text */ }
          throw new Error(detail)
        }
        const json = await r.json()
        if (mySeq !== seq.current) return
        setResult(json)
      } catch (e) {
        if (mySeq === seq.current) setError(e)
      } finally {
        if (mySeq === seq.current) setLoading(false)
      }
    }, debounce)
    return () => clearTimeout(timer.current)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { result, isLoading, error }
}
