import { useState, useEffect } from 'react'

// Fetches { industries, sectors, themes } maps for a list of tickers.
// industries/sectors come from the universe industry map (Finviz-seeded,
// with cold-cache stragglers backfilled server-side — hence the one delayed
// retry). themes comes from the local UCT theme taxonomy DB (fully seeded,
// static — no cold-cache concept, so no retry). Non-blocking on the server.
// Shared by every grouped breadth surface.
//
//   tickers — array of ticker strings (stable reference preferred)
// Returns { industries: {T:ind|null}, sectors: {T:sec|null}, themes: {T:theme|null} }
export default function useGroupMeta(tickers) {
  const [meta, setMeta] = useState({ industries: {}, sectors: {}, themes: {} })

  useEffect(() => {
    if (!tickers || !tickers.length) return
    let cancelled = false
    const syms = tickers.filter(Boolean)

    const fetchIndustries = () => fetch('/api/breadth/industries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: syms }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d) return false
        setMeta(prev => ({
          ...prev,
          industries: { ...prev.industries, ...(d.industries || {}) },
          sectors: { ...prev.sectors, ...(d.sectors || {}) },
        }))
        // any industry still missing? (cold-cache straggler being warmed)
        return Object.values(d.industries || {}).some(v => !v)
      })
      .catch(() => false)

    fetchIndustries().then(hadMisses => {
      if (cancelled || !hadMisses) return
      setTimeout(() => { if (!cancelled) fetchIndustries() }, 2500)
    })

    fetch('/api/breadth/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: syms }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d) return
        setMeta(prev => ({ ...prev, themes: { ...prev.themes, ...(d.themes || {}) } }))
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [tickers])

  return meta
}
