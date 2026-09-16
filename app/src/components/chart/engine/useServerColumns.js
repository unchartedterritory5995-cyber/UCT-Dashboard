// app/src/components/chart/engine/useServerColumns.js
//
// ─── THE CHART'S HALF OF THE SERVER-COLUMN LANE ─────────────────────────────
//
// ⭐⭐ THE SIBLING OF `useSecondarySources`, AND DELIBERATELY THE SAME SHAPE.
// `binder.sync` is SYNCHRONOUS and a server column arrives later, so somebody has
// to stand between them. `serverCompute.js` owns the cache and the request — this
// hook owns the React half: noticing that an entry landed and letting the next
// paint bind it.
//
// ⚰️ MEASURED ON PRODUCTION 2026-09-16: `serverCompute.subscribe` was exported,
// documented ("Notified whenever an entry lands, so a host can repaint") and
// **imported by nobody**. The lane fetched, parsed, cached and notified into an
// empty Set. So the RS line drew only if some UNRELATED repaint happened to
// follow — constantly on a live intraday chart, possibly never on a quiet daily
// one. The mechanism was built; the half that consumes it was not.
//
// ⛔ A GENERATION COUNTER, NOT THE DATA. `computeFor` reads the cache itself and
// must keep doing so — it is the only caller that knows which (def, sym, tf,
// inputs) each instance needs. Handing the columns out here would be a second
// reader of one cache and a second chance to disagree with the binder. All this
// hook has to say is "something landed, ask again".
//
// ⚠️ AND IT DOES NOT FILTER BY KEY. `_notify` only ever fires for a fetch THIS
// LANE made — `primeServerColumns` (the three Signature overlays, which ride
// SWR and own their own re-render) deliberately does not notify — and those
// fetches are deduped per key and cached forever after. So a notify already
// means "a server column this app actually asked for just arrived", and
// filtering would buy nothing while adding a way to drop a repaint that mattered.
import { useEffect, useState } from 'react'
import { subscribe } from './serverCompute'

/**
 * A number that changes when a server-lane column lands.
 *
 * Feed it to whatever dependency array drives the repaint — the same thing
 * `secondarySources` and `userDefsGeneration` already do in `updateChart`.
 *
 * @returns {number} monotonically increasing; the VALUE is meaningless, only the
 *                   change is.
 */
export function useServerColumns() {
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    // ⛔ `alive` GUARDS THE TEARDOWN WINDOW. `_notify` runs in a promise's
    // `finally`, so it can fire between React deciding to unmount and this
    // cleanup running; a `setState` there is the classic leak warning, and on a
    // widget the user just closed it is work nobody will see.
    let alive = true
    const unsub = subscribe(() => { if (alive) setGeneration((n) => n + 1) })
    // ⭐ SUBSCRIBE ONCE PER MOUNT, NOT PER SYMBOL OR TIMEFRAME. Nothing about the
    // notification is chart-specific, so re-subscribing on every `sym`/`tf`
    // change would churn the Set for no gain — and an empty dependency array is
    // what makes "one mount, one listener, one removal" provable.
    return () => { alive = false; unsub() }
  }, [])
  return generation
}

export default useServerColumns
