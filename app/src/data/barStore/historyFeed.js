// Older intraday bars for the BarStore, from the history lake at the edge (/api/hist,
// data/historyLake/source.js). network.js asks it first on every scroll-back of an intraday key
// and falls back to the server's /api/bars window when it has nothing (or the join disagrees).
//
//   olderBars(key, beforeT, { bars, signal }) -> { bars: [{t,o,h,l,c,v}], exhausted }
//
// `bars` holds the newest `want` bars strictly older than `beforeT`, oldest first, plus the bar AT
// `beforeT` when the lake has it, so the caller's seam rule (utils/historyPrepend.prependOlder:
// a >2% close mismatch at the join refuses the window) can compare the two series. `exhausted`
// means the lake holds nothing older than `beforeT` for this series.
//
// ⭐ ON BY DEFAULT FOR THE APP'S STORE since 2026-11-17 (index.js getBarStore): the edge route
// (`uctintelligence.com/api/hist/*` on bars-edge-router), its R2 bucket (`hist/`, 2003-09 to 2026-11-13,
// 36,676 symbols) and the member's entitlement cookie on Path=/api/hist (#1635) are live. Per browser,
// `localStorage['uct.historyLake']` = '0' turns it off and '1' forces it on. A store built directly
// (createBarStore, every suite) keeps the old default, OFF unless '1': a suite asks for the lake by name.
import { createHistorySource, periodsFor, seriesFor } from '../historyLake/source'
import { parseKey, isIntradayTf } from './types'
import { lakeTargetBars } from '../../utils/historyPrepend'

export const HISTORY_LAKE_KEY = 'uct.historyLake'

/** The per-browser switch ('1' on, '0' off) or, when it is unset or unreadable, `byDefault`. */
export function historyLakeEnabled({ byDefault = false } = {}) {
  let v = null
  try { v = typeof localStorage !== 'undefined' ? localStorage.getItem(HISTORY_LAKE_KEY) : null } catch { v = null }
  if (v === '1') return true
  if (v === '0') return false
  return !!byDefault
}

/** The app's store defaults the lake ON; the test runner's default store does not (`mode` 'test'). */
export function lakeOnByDefault(mode) {
  let m = mode
  if (m === undefined) { try { m = import.meta.env.MODE } catch { m = undefined } }
  return m !== 'test'
}

/** The history feed the APP's store is built with (index.js getBarStore): a feed unless this browser
 *  says '0' (or, in the test runner, unless a suite says '1'); null otherwise. */
export function appHistoryFeed(mode, make = createHistoryFeed) {
  return historyLakeEnabled({ byDefault: lakeOnByDefault(mode) }) ? make() : null
}

/** The lake series of a BarStore key, or null when the lake does not carry it. */
export function lakeSeriesOfKey(key) {
  const p = parseKey(key)
  if (!p || p.window || !isIntradayTf(p.tf)) return null
  return { sym: p.sym, tf: p.tf, extended: p.cacheTf === '60e', series: seriesFor(p.tf, { extended: p.cacheTf === '60e' }) }
}

/**
 * @param {{ source?: ReturnType<typeof createHistorySource> }} o
 */
export function createHistoryFeed({ source = createHistorySource() } = {}) {
  // ⭐ PRIMED AT OPEN (2026-11-17). The first lake window of a chart is asked when its first server
  // answer lands (network `_noteAnswered`: it needs the oldest bar's time), so on a symbol this page
  // had not opened the deep history arrived a whole edge round trip after the first paint (index, then
  // pieces: ~150-400 ms). `prime` starts that round trip AT the open, in parallel with the server's:
  // the index (kept for the page's life) and the series' newest pieces into the browser's HTTP cache,
  // the very URLs the window then reads. Once per key per page; a few hundred keys at most.
  const primed = new Set()
  // ⭐ ENOUGH PIECES FOR THE WHOLE FIRST PAINT (2026-11-17): the handoff now loads the chart's whole
  // depth (historyPrepend.lakeTargetBars) at Enter, so the prime warms the newest pieces until they hold
  // that many bars (at least PRIME_PIECES), not just the newest two.
  function prime(key, { pieces = PRIME_PIECES, bars: wantBars } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || primed.has(key)) return
    const bars = wantBars ?? lakeTargetBars(ls.tf)
    primed.add(key)
    if (primed.size > PRIME_MAX_KEYS) primed.delete(primed.values().next().value)
    Promise.resolve().then(() => source.loadIndex(ls.sym)).then((index) => {
      if (!index || !source.warmPieces) return undefined
      const all = periodsFor(index, ls.series, {})
      let have = 0
      let from = all.length
      while (from > 0 && (all.length - from < pieces || have < bars)) { from--; have += all[from].bars || 0 }
      return source.warmPieces(ls.sym, ls.series, all.slice(from))
    }).catch(() => {})
  }

  async function olderBars(key, beforeT, { bars: want = 2000, signal } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || !Number.isFinite(beforeT)) return { bars: [], exhausted: true }
    const index = await source.loadIndex(ls.sym, { signal })
    if (!index) return { bars: [], exhausted: true }
    const periods = periodsFor(index, ls.series, { to: beforeT })
    // Newest first, take pieces until they hold `want` bars older than beforeT. A piece that
    // reaches beforeT holds only part of its bars before it: counted as half, so a short count
    // asks one piece too many rather than one too few.
    const pick = []
    let have = 0
    for (let i = periods.length - 1; i >= 0 && have < want; i--) {
      const e = periods[i]
      if (e.first >= beforeT) { if (e.first === beforeT) pick.unshift(e); continue }   // the seam bar only
      pick.unshift(e)
      have += e.last < beforeT ? e.bars : Math.ceil(e.bars / 2)
    }
    if (!pick.some((e) => e.first < beforeT)) return { bars: [], exhausted: true }
    const got = await source.loadBars(ls.sym, ls.tf, { from: pick[0].first, to: beforeT, extended: ls.extended, signal })
    if (!got || !got.t.length) return { bars: [], exhausted: true }
    const { t, o, h, l, c, v } = got
    // the last index with t <= beforeT, and the first of the newest `want` strictly older
    let end = t.length
    while (end > 0 && t[end - 1] > beforeT) end--
    const seam = end > 0 && t[end - 1] === beforeT ? 1 : 0
    const start = Math.max(0, end - seam - want)
    const rows = []
    for (let i = start; i < end; i++) rows.push({ t: t[i], o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] })
    return { bars: rows, exhausted: false }
  }
  /** Does the lake hold `sym` at all (its index exists)? A 404 is "no such ticker": the typed warm's
   *  second authority when the daily pack does not know a real ticker. Never rejects. */
  function hasSymbol(sym) {
    return Promise.resolve().then(() => source.loadIndex(sym)).then((i) => !!i).catch(() => false)
  }
  return { olderBars, prime, hasSymbol }
}

/** Pieces `prime` warms per key: the newest two hold the first lake window of every series (a month
 *  of 1m, a quarter of 5m, a year of 15-60m each, against a ~6,000-bar window). */
export const PRIME_PIECES = 2
/** Keys `prime` remembers (a page that opens more starts forgetting the oldest). */
export const PRIME_MAX_KEYS = 500
