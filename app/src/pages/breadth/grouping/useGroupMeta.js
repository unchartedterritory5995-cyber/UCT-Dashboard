import { useState, useEffect } from 'react'

// Fetches { industries, sectors } maps for a list of tickers from the
// universe industry map. Non-blocking on the server; we do one delayed retry
// to pull in cold-cache backfills. Shared by every grouped breadth surface.
//
//   tickers — array of ticker strings (stable reference preferred)
// Returns { industries: {T:ind|null}, sectors: {T:sec|null} }
export default function useGroupMeta(tickers) {
  const [meta, setMeta] = useState({ industries: {}, sectors: {} })

  useEffect(() => {
    if (!tickers || !tickers.length) return
    let cancelled = false
    const syms = tickers.filter(Boolean)
    const fetchMeta = () => fetch('/api/breadth/industries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: syms }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d) return false
        setMeta(prev => ({
          industries: { ...prev.industries, ...(d.industries || {}) },
          sectors: { ...prev.sectors, ...(d.sectors || {}) },
        }))
        // any industry still missing? (cold-cache straggler being warmed)
        return Object.values(d.industries || {}).some(v => !v)
      })
      .catch(() => false)
    fetchMeta().then(hadMisses => {
      if (cancelled || !hadMisses) return
      setTimeout(() => { if (!cancelled) fetchMeta() }, 2500)
    })
    return () => { cancelled = true }
  }, [tickers])

  return meta
}
