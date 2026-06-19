import { useEffect, useRef, useState } from 'react'

// Debounced POST /api/screener/scan whenever the spec changes. A null spec
// skips fetching. Filtering uses the nightly snapshot (live prices overlay
// the result rows for display only).
export default function useScreenerScan(spec, { debounce = 300 } = {}) {
  const [result, setResult] = useState(null)
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef()
  const key = spec ? JSON.stringify(spec) : null

  useEffect(() => {
    if (!key) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await fetch('/api/screener/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        })
        if (!r.ok) throw new Error(`scan ${r.status}`)
        setResult(await r.json())
      } catch (e) {
        setError(e)
      } finally {
        setLoading(false)
      }
    }, debounce)
    return () => clearTimeout(timer.current)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { result, isLoading, error }
}
