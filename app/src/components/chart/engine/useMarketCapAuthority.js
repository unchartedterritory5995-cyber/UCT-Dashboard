// app/src/components/chart/engine/useMarketCapAuthority.js
//
// ─── `useFundamentalSources`' TWIN FOR THE MARKET CAP AUTHORITY ─────────────
//
// Returns Map(symbol -> authority points) while the server authority is ON
// (marketCapAuthorityStore.js), else null -- and null is what keeps the binder
// on the unchanged legacy path. ⛔ A chart with no `fund:...market_cap` source
// returns null and makes no request.
//
// ⛔ THE MAP IDENTITY IS STABLE WHEN NOTHING CHANGED (it joins `updateChart`'s
// dependency array); a snapshot is taken only when an entry actually changed.
import { useEffect, useState } from 'react'
import { parseSource, sourceInputsOf } from './sourceRef'
import { marketCapAuthority } from './marketCapAuthorityStore'

function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

export function marketCapSymbols(instances, defOf, chartSymbol) {
  const out = new Set()
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst) continue
    const def = defOf ? defOf(inst.defId) : null
    for (const [, value] of sourceInputsOf(def, inst)) {
      const p = parseSource(value)
      if (p && p.kind === 'fundamental' && String(p.metric) === 'market_cap') {
        const s = String(p.symbol || chartSymbol || '').toUpperCase()
        if (s) out.add(s)
      }
    }
  }
  return [...out].sort()
}

export function useMarketCapAuthority(instances, defOf, symbol, revalidate, store = marketCapAuthority) {
  const [map, setMap] = useState(null)

  useEffect(() => {
    let alive = true
    const syms = marketCapSymbols(instances ? instances() : null, defOf, symbol)
    if (!syms.length) {
      setMap((prev) => (prev === null ? prev : null))
      return () => { alive = false }
    }
    const s = store()
    const apply = () => {
      if (!alive) return
      const live = s.ensureMarketCap(syms)
      if (!live) { setMap((prev) => (prev === null ? prev : null)); return }
      const next = new Map(syms.filter((k) => live.has(k)).map((k) => [k, live.get(k)]))
      setMap((prev) => (sameEntries(prev, next) ? prev : next))
    }
    apply()
    const unsub = s.subscribe(apply)
    return () => { alive = false; unsub() }
  }, [instances, defOf, symbol, revalidate, store])

  return map
}

export default useMarketCapAuthority
