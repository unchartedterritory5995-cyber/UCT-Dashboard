import { useEffect, useState } from 'react'
import { aggregateExtBars } from '../components/chart/sessionPreview'

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
 * Inert (returns null, fetches nothing) unless `active` and a pre/post session.
 *
 * @param {string}  sym
 * @param {('pre'|'post'|null)} session
 * @param {boolean} active
 * @returns {{open,high,low,close,volume}|null}
 */
export default function useSessionExtBars(sym, session, active, anchorDate) {
  // Tag the aggregate with the symbol it was computed for. The reset-on-sym-change
  // in the effect below runs one render LATE (effects fire after render), so on the
  // first render after a ticker switch `filteredBars` is already the new symbol's
  // bars while `agg` still holds the prior symbol's aggregate — applying it would
  // paint a candle at the wrong price (the "pre-market bar shoots to the bottom
  // then snaps back" glitch when flipping tickers). Gating the return on a matching
  // sym closes that window synchronously, without waiting for the reset effect.
  const [state, setState] = useState({ sym: null, agg: null })

  useEffect(() => {
    // Reset immediately so a prior symbol's aggregate never briefly applies to a
    // new symbol; the fetch below repopulates when active. One extra render on
    // sym/session/active transitions only — not a hot path.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ sym, agg: null })
    if (!active || !sym || (session !== 'pre' && session !== 'post')) return undefined
    let cancelled = false
    const run = async () => {
      try {
        const r = await fetch(`/api/bars/${encodeURIComponent(sym)}?tf=5&bars=300`)
        if (!r.ok) return
        const payload = await r.json()
        if (cancelled) return   // sym/session change cancels via cleanup below
        // Anchor to the trading day the extended data belongs to (overnight →
        // the just-closed day), falling back to today for the live 4pm–8pm window.
        setState({ sym, agg: aggregateExtBars(payload?.bars || [], { session, todayEt: anchorDate || todayEtStr() }) })
      } catch { /* keep the last good aggregate on transient failures */ }
    }
    run()
    const id = setInterval(run, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [sym, session, active, anchorDate])

  // Only surface the aggregate when it belongs to the CURRENT symbol — guards the
  // one-render gap between a sym switch and the reset effect above.
  return state.sym === sym ? state.agg : null
}
