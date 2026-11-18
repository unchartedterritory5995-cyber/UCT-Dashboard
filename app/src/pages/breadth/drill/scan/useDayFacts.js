import { useEffect, useMemo, useState } from 'react'
import { memPeek } from '../../../../utils/barsMemCache'
import { prepareForDisplay as legacyPrepare } from '../../../../utils/prefetchBars'
import { prepareForDisplay as storePrepare, peekBars } from '../../../../data/barStore/prefetch'
import { BARSTORE } from '../../../../components/chart/barStoreSwitch'
import { dayFacts } from './scanDeckModel'

// P3-S1: read and prepare through the chart's own bar source (chart/barStoreSwitch.js). Under
// BARSTORE the store's held set comes first (`peekBars`), the mem cache second.
const prepareForDisplay = BARSTORE ? storePrepare : legacyPrepare
const dailyBars = (sym) => (BARSTORE ? (peekBars(sym, 'D') || memPeek(sym, 'D')) : memPeek(sym, 'D'))

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
  const cached = useMemo(() => (sym ? dayFacts(dailyBars(sym), date || null) : null), [sym, date])
  const [loaded, setLoaded] = useState({ key: null, facts: null })

  useEffect(() => {
    if (!sym || cached) return undefined
    let cancelled = false
    // Aborted when the row is left: the store's prepare then cancels its request.
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    prepareForDisplay(sym, 'D', { signal: ctl?.signal ?? null })
      .then(() => { if (!cancelled) setLoaded({ key, facts: dayFacts(dailyBars(sym), date || null) }) })
      .catch(() => {})
    return () => { cancelled = true; try { ctl?.abort() } catch { /* ignore */ } }
  }, [sym, date, key, cached])

  return cached || (loaded.key === key ? loaded.facts : null)
}
