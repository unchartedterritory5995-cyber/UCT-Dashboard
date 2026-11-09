import { useEffect, useMemo, useState } from 'react'
import { memPeek } from '../../../../utils/barsMemCache'
import { prepareForDisplay } from '../../../../utils/prefetchBars'
import { dayFacts } from './scanDeckModel'

/**
 * DCR, gap, ADR(20) and $ volume for ONE stock on the drill's day, from the same
 * daily bars its chart reads. A recorded drill pins its quotes to the snapshot,
 * so these cannot come from the live quote feed; the bar for that date is the
 * truthful source. `date` null = a live drill = the newest bar.
 *
 * Reads the in-memory cache first (the chart has usually just loaded it), and
 * otherwise asks the same warm path the chart uses — never a second fetcher.
 */
export default function useDayFacts(sym, date) {
  const key = sym ? `${sym}|${date || 'live'}` : null
  // A pure read of the memory cache; `memPeek` does not reorder the LRU.
  const cached = useMemo(() => (sym ? dayFacts(memPeek(sym, 'D'), date || null) : null), [sym, date])
  const [loaded, setLoaded] = useState({ key: null, facts: null })

  useEffect(() => {
    if (!sym || cached) return undefined
    let cancelled = false
    prepareForDisplay(sym, 'D')
      .then(() => { if (!cancelled) setLoaded({ key, facts: dayFacts(memPeek(sym, 'D'), date || null) }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sym, date, key, cached])

  return cached || (loaded.key === key ? loaded.facts : null)
}
