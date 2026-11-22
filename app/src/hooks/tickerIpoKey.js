// The listing-date read (GET /api/ticker-ipo/{sym}): its ONE key. `useTickerIpo` asks under it;
// a chart also derives its rest gate from it (components/chart/restedReaders.js). The key lives
// beside the hook, not in it: many suites replace the hook with a default-only double.

/** The SWR key for a symbol. Null for none. */
export const tickerIpoKey = (sym) => (sym ? `/api/ticker-ipo/${encodeURIComponent(sym)}` : null)
