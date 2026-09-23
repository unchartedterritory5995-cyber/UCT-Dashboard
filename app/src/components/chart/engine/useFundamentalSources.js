// app/src/components/chart/engine/useFundamentalSources.js
//
// ─── THE CHART'S HALF OF THE FUNDAMENTALS SEAM ──────────────────────────────
//
// ⭐⭐ `useSecondarySources`' TWIN, ON PURPOSE. `binder.sync` is synchronous and
// fundamental series arrive later; this hook decides which (symbol, series) the
// chart's instances need, asks once, and re-renders when something lands.
//
// ⛔ THE MAP IDENTITY IS STABLE WHEN NOTHING CHANGED -- the same constraint and
// the same reason as its twin: the map joins `updateChart`'s dependency array,
// and a fresh object per render would repaint the chart continuously.
//
// ⛔ A CHART WITH NO `fund:` SOURCE COSTS NOTHING: no catalogue request, no
// series request, the shared empty state.
import { useEffect, useState } from 'react'
import { parseSource, sourceInputsOf } from './sourceRef'
import { fundamentalsNeeded } from './fundamentalSource'
import { ensureAllFundamentals, fundamentalsCatalog, subscribe } from './fundamentalSeries'

function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

function parsedFundamentals(instances, defOf) {
  const out = []
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst) continue
    const def = defOf ? defOf(inst.defId) : null
    for (const [, value] of sourceInputsOf(def, inst)) {
      const p = parseSource(value)
      if (p && p.kind === 'fundamental') out.push(p)
    }
  }
  return out
}

/**
 * @param {function} instances  () => the NORMALISED engine instances
 * @param {function} defOf      definition lookup
 * @param {string}   symbol     the charted symbol (what `fund:<metric>` follows)
 * @param {*}        revalidate any value that should re-check the needed set
 * @returns {Map<string, object>|null}  symbol -> series entry; null when none needed
 */
export function useFundamentalSources(instances, defOf, symbol, revalidate) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    let alive = true
    const parsed = parsedFundamentals(instances ? instances() : null, defOf)
    const apply = () => {
      if (!alive) return
      if (!parsed.length) {
        setState((prev) => (prev.map === null ? prev : EMPTY))
        return
      }
      fundamentalsCatalog()                       // ensure the catalogue is on its way
      const needed = fundamentalsNeeded(parsed, symbol)
      const key = Object.entries(needed).map(([s, ids]) => `${s}:${[...ids].sort().join('+')}`).sort().join('|')
      const map = ensureAllFundamentals(needed)
      setState((prev) => (prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }))
    }
    apply()
    if (!parsed.length) return () => { alive = false }
    const unsub = subscribe(apply)
    return () => { alive = false; unsub() }
  }, [instances, defOf, symbol, revalidate])

  return state.map
}

const EMPTY = Object.freeze({ key: '', map: null })

export default useFundamentalSources
