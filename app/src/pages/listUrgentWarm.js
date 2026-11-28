// ⛔ (review of #3024) A LIST'S URGENT NEXT ROWS ARE ITS OWN. Six embedded <Watchlists> (WatchlistWidget, the scanner's
// results, a list subscription, the period sort, ETF holdings, a breadth drill) warm their next rows through the store's
// one urgent map (data/barStore/prefetch `urgentCtl`). Each list is an OWNER there: a row it passed, or a key family it no
// longer reads (Latest, a date change, a chart leaving the timeframe), is given up for that list only, and a key is
// aborted only when no list still wants it.
//
//   const st = createListUrgentWarm()                       // once per list (a ref)
//   dropUrgentFamilies(st, variants, warm)                  // the families this list stopped reading: aborted (its own)
//   sendUrgentNext(st, variants, urgentNext, warm)          // its next rows, urgent, per variant, as this list
//
// `warm`: { prefetchBars, abortUrgentFamily } (utils/barsWarm in the app; a real store's facade in the rails).

/** One list's urgent-warm state: its owner token and the key families (variants) it read last. */
export function createListUrgentWarm() {
  return { owner: Symbol('list-urgent'), variants: new Map() }
}

/** The families `st` read last that `variants` no longer has: their in-flight urgent rows go (this list's only). */
export function dropUrgentFamilies(st, variants, warm) {
  const ids = new Set(variants.map((v) => v.id))
  for (const [vid, v] of st.variants) {
    if (!ids.has(vid)) { try { warm.abortUrgentFamily(v.tf, v.viewWindow ?? null, st.owner) } catch { /* a warm */ } }
  }
  st.variants = new Map(variants.map((v) => [v.id, v]))
}

/** This list's next rows, urgent, on every variant it reads (a window at the date where the variant has one). */
export function sendUrgentNext(st, variants, urgentNext, warm) {
  for (const { tf, viewWindow } of variants) {
    warm.prefetchBars(urgentNext, tf, { urgent: true, owner: st.owner, ...(viewWindow ? { viewWindow } : {}) })
  }
}
