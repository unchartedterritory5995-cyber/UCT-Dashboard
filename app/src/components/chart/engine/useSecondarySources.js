// app/src/components/chart/engine/useSecondarySources.js
//
// ─── THE CHART'S HALF OF THE SECONDARY-SYMBOL SEAM ──────────────────────────
//
// ⭐⭐ `binder.sync` IS SYNCHRONOUS AND BARS ARRIVE LATER, so somebody has to
// stand between them. `secondaryBars.js` owns the cache and the request — this
// hook owns the React half: which symbols this chart needs, asking for them once,
// and re-rendering when one lands so the next paint can bind it.
//
// ⛔⛔ THE MAP IDENTITY IS STABLE WHEN NOTHING CHANGED, AND THAT IS THE WHOLE
// DESIGN CONSTRAINT. `updateChart` is a `useCallback` whose dependency array this
// map joins; a fresh Map on every render would change that callback's identity on
// every render and repaint the chart continuously. So the state transition below
// returns the PREVIOUS object unless a symbol's entry actually changed — the same
// object-identity discipline `barFieldFor` and `projectionFor` use one layer down,
// for the same reason.
//
// ⛔ AND IT READS THE NORMALISED INSTANCE LIST, NOT `cs.indicatorInstances`. The
// raw blob still contains the records `normalizeInstances` dropped and the
// definitions the engine is not allowed to draw; fetching for those would be
// network traffic for series that will never be bound.
import { useEffect, useState } from 'react'
import { symbolsNeeded } from './sourceRef'
import { ensureAll, subscribe } from './secondaryBars'

/** Do two maps hold the same entry OBJECT for the same symbols? */
function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [sym, entry] of a) {
    // Identity, not deep equality: `cachedBars` hands back the stored object, so
    // an unchanged symbol is the very same reference and a changed one is not.
    if (b.get(sym) !== entry) return false
  }
  return true
}

/**
 * Bars for every canonical symbol this chart's instances name.
 *
 * @param {object[]} instances  the NORMALISED engine instances (read from a ref)
 * @param {function} defOf      definition lookup
 * @param {string}   tf         the chart's resolved timeframe
 * @param {number}   barCount   the chart's own history depth
 * @param {function} fetcher    the chart's fetcher, so aborts on symbol flip apply
 * @param {*}        revalidate any value that should re-check the needed set
 * @returns {Map<string,{bars,status}>|null} null when this chart needs none
 */
export function useSecondarySources(instances, defOf, tf, barCount, fetcher, revalidate) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    const symbols = symbolsNeeded(instances ? instances() : null, defOf)
    const key = `${symbols.join(',')}|${tf}|${barCount}`
    let alive = true

    const apply = () => {
      if (!alive) return
      // ⭐ THE ZERO-COST PATH, AND IT IS THE COMMON ONE. A chart with no symbol
      // source produces no key, no request and no cache entry — the same
      // null-key-means-no-traffic idiom `compareSwrUrl` and
      // `useSignatureIndicators` already use. It returns the SHARED empty state,
      // so "needs nothing" is one stable identity rather than a new object.
      const map = symbols.length ? ensureAll(symbols, tf, barCount, fetcher) : null
      setState((prev) => {
        if (!map) return prev.map === null ? prev : EMPTY
        return prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }
      })
    }

    apply()
    if (!symbols.length) return () => { alive = false }
    // ⚠️ SUBSCRIBE, DO NOT POLL. `ensureAll` fires the request; the notification
    // is what tells this chart a response landed, and re-reading the cache is
    // cheap because the fetch is already deduped per URL.
    const unsub = subscribe(apply)
    return () => { alive = false; unsub() }
  }, [instances, defOf, tf, barCount, fetcher, revalidate])

  return state.map
}

/** One shared empty state, so "this chart needs nothing" is a stable identity. */
const EMPTY = Object.freeze({ key: '', map: null })

export default useSecondarySources
