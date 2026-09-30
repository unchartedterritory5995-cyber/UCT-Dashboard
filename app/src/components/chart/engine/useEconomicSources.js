// app/src/components/chart/engine/useEconomicSources.js
//
// ─── THE CHART'S HALF OF THE ECONOMIC OVERLAY SEAM ──────────────────────────
//
// ⭐⭐ `useFundamentalSources`' TWIN. `binder.sync` is synchronous and economic
// series arrive later; this hook decides which `econ:<SYMBOL>` series the chart's
// instances name, asks once each (`economicSeries` dedupes and caches), and
// re-renders when something lands. The binder then projects each onto the host
// bars — any timeframe, intraday included — through `economicColumn`: release-date
// placement, strict intraday (no look-ahead), per-frequency max age (honest gaps),
// period-monotone carry. Its own price scale comes from the ordinary pane/scale
// placement of the instance.
//
// ⛔ THE MAP IDENTITY IS STABLE WHEN NOTHING CHANGED: it joins `updateChart`'s
// dependency array, and a fresh object per render would repaint continuously.
//
// ⛔ A CHART WITH NO `econ:` SOURCE COSTS NOTHING: no catalogue request, no series
// request, the shared empty state — every stock chart, byte for byte.
import { useEffect, useState } from 'react'
import { parseSource, sourceInputsOf } from './sourceRef'
import { ensureAllEconomicSeries, subscribeEconomic } from './economicSeries'

function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/** The `econ:` symbols the instances name (deduped, in first-seen order). */
export function economicSymbolsOf(instances, defOf) {
  const out = []
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst) continue
    const def = defOf ? defOf(inst.defId) : null
    for (const [, value] of sourceInputsOf(def, inst)) {
      const p = parseSource(value)
      if (p && p.kind === 'economic' && !out.includes(p.symbol)) out.push(p.symbol)
    }
  }
  return out
}

/**
 * @param {function} instances  () => the stored engine instances
 * @param {function} defOf      definition lookup
 * @param {*}        revalidate any value that should re-check the needed set
 * @returns {Map<string, object>|null}  symbol -> series entry; null when none needed
 */
export function useEconomicSources(instances, defOf, revalidate) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    let alive = true
    const symbols = economicSymbolsOf(instances ? instances() : null, defOf)
    const apply = () => {
      if (!alive) return
      if (!symbols.length) {
        setState((prev) => (prev.map === null ? prev : EMPTY))
        return
      }
      const key = symbols.join('|')
      const map = ensureAllEconomicSeries(symbols)
      setState((prev) => (prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }))
    }
    apply()
    if (!symbols.length) return () => { alive = false }
    const unsub = subscribeEconomic(apply)
    return () => { alive = false; unsub() }
  }, [instances, defOf, revalidate])

  return state.map
}

const EMPTY = Object.freeze({ key: '', map: null })

export default useEconomicSources
