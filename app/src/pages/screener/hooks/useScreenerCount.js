import { useEffect, useRef, useState } from 'react'

// PACKET-AB CP1 (fingerprint bc19457cf) -- debounced POST /api/screener/count
// whenever the spec changes. Mirrors useScreenerScan.js's own shape (debounce +
// a seq ref guarding out-of-order responses) but posts to the cheap, count-only
// endpoint instead of the full scan, with a materially shorter debounce so the
// count is felt as the fast signal relative to the heavier /scan call already
// in flight for the same spec. Returns {count, empty, isLoading, error}.
export default function useScreenerCount(spec, { debounce = 120 } = {}) {
  const [count, setCount] = useState(null)
  const [empty, setEmpty] = useState(null)
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
        const r = await fetch('/api/screener/count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        })
        if (mySeq !== seq.current) return // a newer request superseded this one
        if (!r.ok) {
          let detail = `count ${r.status}`
          try { detail = (await r.json())?.detail || detail } catch { /* keep status text */ }
          throw new Error(detail)
        }
        const json = await r.json()
        if (mySeq !== seq.current) return
        setCount(json.count)
        setEmpty(json.empty)
      } catch (e) {
        if (mySeq === seq.current) setError(e)
      } finally {
        if (mySeq === seq.current) setLoading(false)
      }
    }, debounce)
    return () => clearTimeout(timer.current)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { count, empty, isLoading, error }
}
