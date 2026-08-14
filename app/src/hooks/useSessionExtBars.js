import { useEffect, useState } from 'react'
import { aggregateExtBars } from '../components/chart/sessionPreview'
import { idbGet } from '../utils/barsIDB'

// Today's ET calendar date ("YYYY-MM-DD").
function todayEtStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/**
 * Fetch today's extended-hours OHLCV aggregate for the "Include pre/post-market"
 * daily-candle preview (Charts workspace). Pulls a small slice of 5-min bars
 * (which /api/bars serves across the full 4:00am–8:00pm ET span) and folds the
 * in-window prints into a single { open, high, low, close, volume }.
 *
 * Inert (fetches nothing) unless `active` and a pre/post session.
 *
 * Returns { agg, ready }. `ready` distinguishes "the fetch for THIS symbol hasn't
 * landed yet" from "it landed and there are no extended-hours prints" — both of
 * which are agg == null. The caller MUST NOT paint a session candle until ready:
 * the live ext PRICE arrives from a warm shared cache almost instantly while this
 * aggregate is a per-symbol network fetch (~1s), and applySessionCandle seeded from
 * a price alone collapses to o=h=l=c — a flat doji at the live price that visibly
 * morphs into the real body/wicks when the aggregate lands. `ready` only goes false
 * for the FIRST fetch of a (sym, session, anchorDate); the 30s refresh never flips
 * it back, or the candle would blink out twice a minute.
 *
 * @param {string}  sym
 * @param {('pre'|'post'|null)} session
 * @param {boolean} active
 * @returns {{agg: {open,high,low,close,volume}|null, ready: boolean}}
 */
export default function useSessionExtBars(sym, session, active, anchorDate) {
  // Tag the aggregate with the symbol it was computed for. The reset-on-sym-change
  // in the effect below runs one render LATE (effects fire after render), so on the
  // first render after a ticker switch `filteredBars` is already the new symbol's
  // bars while `agg` still holds the prior symbol's aggregate — applying it would
  // paint a candle at the wrong price (the "pre-market bar shoots to the bottom
  // then snaps back" glitch when flipping tickers). Gating the return on a matching
  // sym closes that window synchronously, without waiting for the reset effect.
  const [state, setState] = useState({ sym: null, agg: null, ready: false })

  useEffect(() => {
    // Reset immediately so a prior symbol's aggregate never briefly applies to a
    // new symbol; the fetch below repopulates when active. One extra render on
    // sym/session/active transitions only — not a hot path.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ sym, agg: null, ready: false })
    if (!active || !sym || (session !== 'pre' && session !== 'post')) return undefined
    let cancelled = false
    // A settled fetch marks ready even when it yields nothing, so a symbol with no
    // extended-hours prints (or a failing endpoint) doesn't wedge the caller waiting
    // forever. Keeps the last good aggregate on transient failures.
    const settle = (agg) => {
      if (cancelled) return
      setState(s => (s.sym === sym ? { sym, agg: agg !== undefined ? agg : s.agg, ready: true } : s))
    }
    const aggFrom = (bars) => aggregateExtBars(bars || [], { session, todayEt: anchorDate || todayEtStr() })
    const run = async () => {
      try {
        const r = await fetch(`/api/bars/${encodeURIComponent(sym)}?tf=5&bars=300`)
        if (!r.ok) { settle(undefined); return }
        const payload = await r.json()
        if (cancelled) return   // sym/session change cancels via cleanup below
        // Anchor to the trading day the extended data belongs to (overnight →
        // the just-closed day), falling back to today for the live 4pm–8pm window.
        settle(aggFrom(payload?.bars))
      } catch { settle(undefined) }
    }
    // FAST PATH: paint from the WARM 5m IDB cache before the ~1s network round-trip.
    // The workspace warms all TFs into IDB on symbol selection (prefetchAllTimeframes
    // includes '5'), and /api/bars?tf=5 already carries pre/post-market prints — so on
    // a revisit / once the warm lands, the real aggregate is computable in ~10ms and
    // the pre-market candle appears instantly instead of after the fetch.
    // Safety: idbGet already rejects stale/cold/gapped 5m (newest-bar-age, logic
    // version, interior gaps), and we settle ONLY on a NON-NULL aggregate. A cold or
    // prior-day cache yields null here (aggregateExtBars finds no bars for TODAY's
    // session) → we do NOT settle, and fall through to the network exactly as before.
    // This means the fast path can never trigger the flat-doji morph the ready-gate
    // exists to prevent — it fires only when the true OHLC is already known.
    const fastWarm = async () => {
      try {
        const entry = await idbGet(sym, '5')
        if (cancelled || !entry?.bars?.length) return
        const agg = aggFrom(entry.bars)
        if (agg) settle(agg)   // instant, complete candle; run() still refines below
      } catch { /* fall through to the network fetch */ }
    }
    fastWarm()
    run()
    const id = setInterval(run, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [sym, session, active, anchorDate])

  // Only surface the aggregate when it belongs to the CURRENT symbol — guards the
  // one-render gap between a sym switch and the reset effect above.
  return state.sym === sym ? { agg: state.agg, ready: state.ready } : { agg: null, ready: false }
}
