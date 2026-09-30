// app/src/components/chart/engine/listingSeed.js
//
// ─── ⭐⭐ C12w — "DOES THIS SERIES START AT THE SYMBOL'S FIRST-EVER BAR?" ──────
//
// Ruling R-W (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`, "Rulings,
// 2026-09-29"): a translated Pine `var` keeps its bounded 250-bar window — and
// withholds what reads it inside the warm-up — EXCEPT on a series proven to start
// at the symbol's first-ever bar. There our bar 0 is TradingView's bar 0, and a
// state seeded there is exact (`interpret.js::listingPass`).
//
// This is the chart's half of that proof, and the ONLY producer of the fact on a
// member's chart. It answers `true` in exactly one case: a DAILY series whose
// first bar is dated ON the symbol's official listing day (`list_date`, from
// `/api/ticker-ipo/{sym}` — Massive/Polygon reference data, the provider the bars
// come from; `useTickerIpo`).
//
// ⭐ WHY THIS FACT AND NOT "THE FETCH CAME BACK SHORT". A short answer is also what
// a store that was never deep-filled, a delta response, a replay window, a
// provider's lookback ceiling or a still-running backfill look like — and every
// one of those would seed a `var` somewhere in the middle of the symbol's life and
// call it exact. A daily bar dated on the listing day has no earlier session to
// miss, however it was fetched.
//
// ⭐ WHY IT READS THE BARS THE ENGINE IS HANDED. The chart splices cached history
// under fresh bars, merges deltas and backfills on pan, so "what the last fetch
// asked for" and "what bar 0 is" drift apart. Comparing THE FIRST BAR OF THE
// ARRAY THE BINDER RECEIVES with the listing date cannot drift: pan, splice or
// cache, the answer is about the series actually computed on.
//
// ⛔ EXACT, NEVER "WITHIN A FEW DAYS". The IPO badge (`StockChart`'s `ipoEvent`)
// tolerates five calendar days because it only labels a candle. Here a series
// whose first bar is one session after the listing is exactly the case the
// ruling refuses: it is not the vendor's bar 0.
// ⛔ DAILY ONLY. A weekly bar's key and an intraday series' start are not the
// listing day (intraday history is capped by the provider's lookback, not by the
// listing), and no capture has measured either. Anything else answers `false` —
// the bounded window, exactly as before.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param {object} args
 * @param {Array<{t: string|number}>} args.bars  the series the engine computes on
 * @param {string} args.tf                       the chart's resolved timeframe code
 * @param {string|null|undefined} args.listDate  the symbol's official listing day
 * @returns {boolean} `true` only when bar 0 is the listing-day daily bar
 */
export function historyFromListingOf({ bars, tf, listDate } = {}) {
  if (tf !== 'D') return false
  if (typeof listDate !== 'string') return false
  const day = listDate.trim()
  if (!ISO_DATE.test(day)) return false
  if (!Array.isArray(bars) || !bars.length) return false
  const t = bars[0] && bars[0].t
  // A daily bar is keyed by its ISO date (`/api/bars` serves `t` as `YYYY-MM-DD`).
  // A number here is not a daily key, and guessing a calendar date from it is
  // how a series gets called something it is not.
  if (typeof t !== 'string' || !ISO_DATE.test(t.slice(0, 10))) return false
  return t.slice(0, 10) === day
}
