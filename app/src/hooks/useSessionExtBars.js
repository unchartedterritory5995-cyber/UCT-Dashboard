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
export default function useSessionExtBars(sym, session, active) {
  const [agg, setAgg] = useState(null)

  useEffect(() => {
    // Reset immediately so a prior symbol's aggregate never briefly applies to a
    // new symbol; the fetch below repopulates when active. One extra render on
    // sym/session/active transitions only — not a hot path.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgg(null)
    if (!active || !sym || (session !== 'pre' && session !== 'post')) return undefined
    let cancelled = false
    const run = async () => {
      try {
        const r = await fetch(`/api/bars/${encodeURIComponent(sym)}?tf=5&bars=300`)
        if (!r.ok) return
        const payload = await r.json()
        if (cancelled) return   // sym/session change cancels via cleanup below
        setAgg(aggregateExtBars(payload?.bars || [], { session, todayEt: todayEtStr() }))
      } catch { /* keep the last good aggregate on transient failures */ }
    }
    run()
    const id = setInterval(run, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [sym, session, active])

  return agg
}
