// app/src/lib/barBudget.js
//
// ─── ⭐⭐ ONE PAGE BUDGET FOR EVERY PER-SYMBOL BAR CACHE (2026-11-27, the heap check) ─────────────────────────────────────
//
// The chart page keeps a symbol's bars in four places, each with a bound of its own and none aware of the others:
//
//   registry   the bar store's decoded rows (data/barStore/registry.js; one object per bar, rev/src/fin riding along)
//   adapter    the chart's legacy copy of them ({t,o,h,l,c,v}, D/W/M t a label: data/barStore/adapter.js)
//   mem        the saved copy persist writes in front of IndexedDB (utils/barsMemCache.js; a third object per bar)
//   derived    what the chart derives per row ahead of a press (components/chart/neighborFrames.js)
//
// ⛔ MEASURED (production build df6d39a8b6, V8's sampling heap profile after a forced GC, a 1m + 15m board after 50
// watchlist presses): 336.6 MB retained, ~90% of it bars kept per VISITED symbol: the registry's decoded rows 133.7 MB
// (its bound was 2,500,000 bars: it never bound on that board), the adapter's legacy copies 68 MB (two memos of
// 600,000 bars each over the SAME copies: either one kept them alive), persist's saved copies 44 MB (500,000 rows), the
// derived rows ~39 MB (inside their own 1,000,000 budget). Every symbol pressed stayed in all four.
//
// The bounds now come from ONE page budget, split into the shares below, sized from what the board actually needs warm:
//
//   • what is on screen, the double buffer's shadow, the list's prepared and kept rows: PINNED in the registry (a
//     subscriber or a hold), never counted out by any budget;
//   • the RECENT_SYMBOLS most recently shown symbols: the registry evicts them LAST (registry.js `_evict`), so arrowing
//     back is a held key, not a reload;
//   • everything else goes least recently used first, and an entry the registry drops takes the adapter's slot for its
//     key with it (`noteKeyEvicted`): no cache keeps alive what the store let go. The mem cache is the tier BEHIND the
//     registry (a dropped key re-hydrates from it, then from IndexedDB): its own small share, LRU.
//
// ARITHMETIC (1m + 15m board; a 1m key holds up to 20,000 bars, a 15m key 20,000-32,000 with the lake): on screen 2 keys
// (~45k bars), the shadow 2 (~45k), the next rows' deep loads 4 (~90k), the list's kept rows ahead (60 x ~1.1k = 66k),
// the dwell's other timeframes of the row rested on (~150k, first out once it is left), and RECENT_SYMBOLS = 6 symbols
// x 2 keys (~270k): ~670k. REGISTRY share 800k keeps all of it with room. The adapter copies only what a chart or a
// preparer reads (on screen, shadow, prepared, the derived cache's ten rows): ADAPTER share 400k (was effectively 2 x
// 600k). The mem cache in front of IndexedDB: MEM share 200k (was 500k; the warm working set of +-6 x 5 timeframes x
// ~600 rows plus two deep keys is 148k). The derived share is unchanged (neighborFrames' own arithmetic, 1M).
// In bytes (Chrome, pointer compression): a store bar ~90-100 B, a legacy or saved copy ~70 B, a derived element ~40 B.
//
// The touch tier (<= 1024 px or a coarse pointer: one chart, a phone's memory) keeps less.
//
// ⛔ WHAT THE ADAPTER'S SHARE COUNTS: the bar objects its copies MADE. A slot whose rows ARE the store's own objects (an
// intraday key whose bars carry nothing the legacy shape drops) weighs 0: the registry already counts them. So the
// adapter's share bounds the D/W/M label copies, the copies of rows that carry rev/src/fin, and nothing twice.
//
// ⭐⭐ BY BYTES, AND THE DAILY BASES STAY (2026-11-27, owner: instant full loads at any zoom or date; D/W/M load the
// whole daily history since listing in one request, intraday the view's actual range). A bar costs the same bytes in
// every timeframe (one object per bar: BYTES_PER_BAR), so the shares are bounds in bytes too (`shareBytes`, the ledger's
// `bytes`), and what costs is the intraday arrays (20,000-50,000 bars a key) while a symbol's WHOLE daily history is a few
// thousand to ~12,000 bars. So every cache lets the intraday arrays go first (`isDailyTf`): the registry's order is
// the dwell's intraday warms of a symbol no chart shows, every other idle intraday entry, the idle daily entries, the
// recently shown symbols' intraday entries, and LAST the recent symbols' daily bases; the adapter's slots and the mem
// cache's entries likewise drop their oldest INTRADAY slot first and a daily one only when none is left. A recently
// visited symbol is never made cold by an older one's: it is evicted only after every non-recent entry is gone.
//
// ⛔ A LEAF: it imports styles/breakpoints.js only, so the registry, the adapter, the mem cache and neighborFrames can all
// read it without pulling each other into a chunk.

import { MQ } from '../styles/breakpoints'

export const BAR_BUDGET_DESKTOP = Object.freeze({
  registry: 800_000, adapter: 400_000, mem: 200_000, derived: 1_000_000, recentSymbols: 6,
})
export const BAR_BUDGET_TOUCH = Object.freeze({
  registry: 250_000, adapter: 120_000, mem: 80_000, derived: 200_000, recentSymbols: 3,
})

/** Estimated bytes one bar costs in each cache (Chrome, pointer compression: every non-Smi number is its own 12 B
 *  HeapNumber, and a unix-seconds `t` (~1.7e9) is past the 31-bit Smi range, so it is boxed too). A store bar
 *  {t,o,h,l,c,v,rev,src,fin} ~120 B; a legacy or saved copy {t,o,h,l,c,v} 12 B header + 6 x 4 B fields + 6 x 12 B boxes +
 *  its array slot ~110 B; a derived element (a point {time,value} or a reference) ~40 B (review of #2935, L2).
 *  ⛔ ESTIMATES FOR THE LEDGER ONLY (`barsHeld().bytes`, `shareBytes`): every cache EVICTS BY BARS, so a wrong weight
 *  misreports, never mis-evicts. Calibrate against a heap snapshot's retained size per cache. */
export const BYTES_PER_BAR = Object.freeze({ registry: 120, adapter: 110, mem: 110, derived: 40 })
/** A cache's share in bytes (its bar share x what a bar costs there). */
export function shareBytes(name, shares = barBudget()) { return (shares[name] || 0) * (BYTES_PER_BAR[name] || 0) }
/** D / W / M: a symbol's daily-class base (small: kept before any intraday array). */
export function isDailyTf(tf) { return tf === 'D' || tf === 'W' || tf === 'M' }

/** The page's shares for a tier. */
export function barBudgetFor({ touch = false } = {}) { return touch ? BAR_BUDGET_TOUCH : BAR_BUDGET_DESKTOP }

let _touch = null
/** Is this page on the touch tier (<= 1024 px or a coarse pointer)? Read once (the tier a page loads on). */
export function touchTier() {
  if (_touch !== null) return _touch
  try {
    _touch = typeof matchMedia === 'function' && (matchMedia(MQ.touchDown).matches || matchMedia(MQ.coarsePointer).matches)
  } catch { _touch = false }
  return _touch
}
/** This page's shares (the tier it loaded on). */
export function barBudget() { return barBudgetFor({ touch: touchTier() }) }
/** Tests: force the tier (null re-reads it). */
export function __setTouchTierForTests(v) { _touch = v === null || v === undefined ? null : !!v }

// ─── an entry the registry dropped: every cache keyed by it lets it go ────────────────────────────────────────────────
const _evictSubs = new Set()
/** `cb(key)` whenever a registry drops the entry of `key`. Returns the unsubscribe. */
export function onKeyEvicted(cb) { _evictSubs.add(cb); return () => { _evictSubs.delete(cb) } }
/** A registry dropped the entry of `key` (its LRU or its budget). */
export function noteKeyEvicted(key) {
  for (const cb of [..._evictSubs]) { try { cb(key) } catch { /* a cache's failure never blocks the others */ } }
}

// ─── what every cache holds, for the rig and the rails ────────────────────────────────────────────────────────────────
const _holders = new Map()   // name -> () => { bars, entries, budget }
/** A cache names itself and how to read what it holds now (`held() -> { bars, entries, budget }`). */
export function registerBarHolder(name, held) {
  if (!name || typeof held !== 'function') return
  _holders.set(name, held)
  _expose()
}
/** What each cache holds now, and the sums: `{ total, bytes, byCache: { name: { bars, bytes, entries, budget } } }`
 *  (`bytes`: the bars x BYTES_PER_BAR estimate, the page's retained-heap share of bar data). */
export function barsHeld() {
  const byCache = {}
  let total = 0, bytes = 0
  for (const [name, held] of _holders) {
    let h = null
    try { h = held() } catch { h = null }
    if (!h) continue
    const b = (Number(h.bars) || 0) * (BYTES_PER_BAR[name] || 0)
    byCache[name] = { ...h, bytes: b }
    total += Number(h.bars) || 0
    bytes += b
  }
  return { total, bytes, byCache, budget: barBudget() }
}
function _expose() {
  try { if (typeof window !== 'undefined') window.__uctBarBudget = barsHeld } catch { /* no window */ }
}
