// ── THE WARMERS, FROM THE SAME SOURCE THE CHART READS (2026-11-17) ──────────────────────────
// Every list, grid and screener that warms bars ahead of a symbol switch imports its warmers from
// here. Under BARSTORE (chart/barStoreSwitch.js) they are the store's facade
// (data/barStore/prefetch.js); otherwise the legacy module (utils/prefetchBars.js). Same names,
// same arities (the facade's own contract, prefetch.facade.test.js).
//
// ⛔ WHY (measured on production 2026-11-16, flip proof, 60m, 10 flips through a watchlist):
// with BARSTORE on, the watchlist still warmed through the LEGACY module, which fills the legacy
// caches under the legacy freshness rules and never puts a server answer in the store. The flip
// handoff (hooks/useSymbolHandoff.js) prepares through the STORE, which paints a held server
// answer at once and judges a local copy by the view's paint rule. So rows the list had "warmed"
// were refused at the flip and waited on their own request: first candles 118-229 ms on 3 of 10
// flips (UVXY, FNGD, SSG) against <= 45 ms on every daily flip, whose source and warmer agree.
//
// ⛔ NO IMPORT OF THE FACADE FROM HERE. The facade REGISTERS its warmers (STORE_WARMERS_KEY on
// globalThis) when it loads under BARSTORE — it loads with every chart (useSymbolHandoff). An
// import edge from the page chunks that warm (Watchlists, screener, drill lists…) made the
// bundler split the facade out of the chart chunk into a shared one, and every chunk that loads
// the chart — the app's entry chunk among them — grew a preload entry: Notebook first open +454 B
// over a budget already at its line (tools/notebook_perf_budgets.py). With the registry there is
// no new edge: zero bytes on first open. Before a chart has loaded (no registry yet) a warm goes
// to the legacy module, exactly as before this change; a warm is never load-bearing.
import * as legacy from './prefetchBars'

/** Where the facade registers itself (data/barStore/prefetch.js, under BARSTORE only). */
export const STORE_WARMERS_KEY = '__uctStoreWarmers'

export const WARMER_NAMES = Object.freeze([
  'prefetchBars', 'prefetchBar', 'prefetchBarsToIDB', 'prefetchAllTimeframes',
  'prefetchListAllTimeframes', 'prefetchGridWarm', 'warmMemFromIDB', 'prewarmVisibleList',
  'prefetchListDeep', 'prefetchReplayTimeframes', 'prefetchBarOnIntent',
])

/** The warmer module in force right now: the store's, once registered; else the legacy one. */
export function warmers() {
  const g = typeof globalThis !== 'undefined' ? globalThis[STORE_WARMERS_KEY] : null
  return g || legacy
}

export function prefetchBars(...a) { return warmers().prefetchBars(...a) }
export function prefetchBar(...a) { return warmers().prefetchBar(...a) }
export function prefetchBarsToIDB(...a) { return warmers().prefetchBarsToIDB(...a) }
export function prefetchAllTimeframes(...a) { return warmers().prefetchAllTimeframes(...a) }
export function prefetchListAllTimeframes(...a) { return warmers().prefetchListAllTimeframes(...a) }
export function prefetchGridWarm(...a) { return warmers().prefetchGridWarm(...a) }
export function warmMemFromIDB(...a) { return warmers().warmMemFromIDB(...a) }
export function prewarmVisibleList(...a) { return warmers().prewarmVisibleList(...a) }
export function prefetchListDeep(...a) { return warmers().prefetchListDeep(...a) }
export function prefetchReplayTimeframes(...a) { return warmers().prefetchReplayTimeframes(...a) }
export function prefetchBarOnIntent(...a) { return warmers().prefetchBarOnIntent(...a) }

/**
 * A list's hold on the rows around its selection (store only: `createNeighborHold` in the
 * facade pins them against the registry's LRU so the flip finds them in memory). The store's
 * hold is created on the first `set` after the facade has registered; until then, and on the
 * legacy path (whose caches have no LRU to pin against), it does nothing.
 */
export function createNeighborHold() {
  let inner = null
  return {
    set(syms, tf, opts) {
      if (!inner) {
        let make
        try { make = warmers().createNeighborHold } catch { make = undefined }   // a strict mock throws on a missing name
        if (typeof make !== 'function') return
        inner = make()
      }
      inner.set(syms, tf, opts)
    },
    clear() { inner?.clear() },
  }
}
