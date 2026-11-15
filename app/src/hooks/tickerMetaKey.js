// The name-and-sector read (GET /api/ticker-meta/{sym}): its ONE key. `useTickerMeta` asks under
// it; a chart also derives its rest gate from it (components/chart/restedReaders.js). The key
// lives beside the hook, not in it: many suites replace the hook with a default-only double.

/** The SWR key for a symbol. Null for none. */
export const tickerMetaKey = (sym) => (sym ? `/api/ticker-meta/${encodeURIComponent(sym)}` : null)
