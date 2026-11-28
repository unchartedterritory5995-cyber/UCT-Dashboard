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
import { lakeTargetBars, etDateOf } from '../../utils/historyPrepend'
import { etMidnightEpoch } from '../historyLake/adjust'

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

/** The lake series of a BarStore key, or null when the lake does not carry it. A windowed (`@to=`) key carries its
 *  window's end `to` (epoch s: 23:59:59 ET of the window's ET date, the origin's `to=` cutoff); a plain key `to: null`. */
export function lakeSeriesOfKey(key) {
  const p = parseKey(key)
  if (!p || !isIntradayTf(p.tf)) return null
  const extended = p.cacheTf === '60e'
  const to = p.window ? windowEndOf(p.window.to) : null
  if (p.window && to == null) return null
  const dayStart = p.window ? etMidnightEpoch(etDateOf(p.window.to)) : null
  return { sym: p.sym, tf: p.tf, extended, series: seriesFor(p.tf, { extended }), to, dayStart }
}

/** ⭐ THE ORIGIN'S `to=` CUTOFF (api/services/bars_fetch `_get_bars_to_response`: `to_key` = 23:59:59 America/New_York
 *  of the `to` date) for a window whose `to` is `toUnix` (its ET date, network.barsUrl `etDateOf`). Null when unknown. */
export function windowEndOf(toUnix) {
  const iso = etDateOf(toUnix)
  if (!iso) return null
  const next = new Date(`${iso}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  try { return etMidnightEpoch(next.toISOString().slice(0, 10)) - 1 } catch { return null }   // (a DST day is 23 or 25 h)
}

/**
 * @param {{ source?: ReturnType<typeof createHistorySource> }} o
 */
export function createHistoryFeed({ source = createHistorySource(), now = () => Date.now() } = {}) {
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
  // `signal` (PR 1.2's date warm: a newer text gives the older date up): an aborted prime asks nothing more and is
  // forgotten, so the same key primes again when it is asked again
  function prime(key, { pieces = PRIME_PIECES, bars: wantBars, signal = null } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || primed.has(key) || signal?.aborted) return
    signal?.addEventListener?.('abort', () => primed.delete(key), { once: true })
    // a window warms the pieces its own read takes (windowBars: the newest WINDOW_PRIME_BARS before its end)
    const bars = wantBars ?? (ls.to != null ? WINDOW_PRIME_BARS : lakeTargetBars(ls.tf))
    primed.add(key)
    if (primed.size > PRIME_MAX_KEYS) primed.delete(primed.values().next().value)
    Promise.resolve().then(() => source.loadIndex(ls.sym)).then((index) => {
      if (!index || !source.warmPieces || signal?.aborted || !windowInLake(index, ls)) return undefined
      return source.warmPieces(ls.sym, ls.series, ls.to != null ? windowPieces(index, ls, bars) : depthPieces(index, ls.series, pieces, bars), signal ? { signal } : undefined)
    }).catch(() => {})
  }

  async function olderBars(key, beforeT, { bars: want = 2000, signal, yieldTask } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || !Number.isFinite(beforeT)) return { bars: [], exhausted: true }
    const index = await source.loadIndex(ls.sym, { signal })
    if (!index) return { bars: [], exhausted: true }
    return barsBefore(ls, index, beforeT, want, signal, yieldTask)
  }

  /** The newest `want` bars strictly older than `beforeT` (plus the one AT it, the seam bar), from the newest pieces. */
  async function barsBefore(ls, index, beforeT, want, signal, yieldTask) {
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
    const got = await source.loadBars(ls.sym, ls.tf, { from: pick[0].first, to: beforeT, extended: ls.extended, signal, ...(yieldTask !== undefined ? { yieldTask } : {}) })
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

  /**
   * ⭐⭐ A CHART AT A PAST DATE READS THE LAKE (2026-11-28, zero-network plan PR 1.1; owner: charts "in 2006"). An intraday
   * chart anchored at a date reads the WINDOW key (`@to=`, chart/viewWindow), and every such key went to the origin's
   * `/api/bars?to=` (95-130 ms server-cold; a store miss is a vendor replay, seconds) although the lake at the edge holds
   * the same history, 2003-09 to its last published session. This answers that read from the lake, exactly as the origin
   * would: the newest `want` bars at or before the origin's cutoff (23:59:59 ET of the window's date), oldest first, in the
   * lake's split-adjusted basis (historyLake/adjust.js: the present basis, the origin's), a bar with a non-positive price
   * dropped as the origin's serve does (bars_fetch `_fmt_sqlite_bars`).
   *
   * Resolves `{ bars, through }` (`through`: the lake's newest bar of the series), or NULL when the origin must answer:
   *   - the lake has no index or no such series for the symbol;
   *   - ⛔ THE LAKE HAS NOT REACHED THE WINDOW'S DAY (its newest bar is older than that ET day's midnight). The lake is
   *     published a session behind (a holiday or a missed daily build: more); a window it does not hold whole is the origin's;
   *   - nothing at or before the cutoff (before the listing, or before 2003-09).
   * Rejects as the source does (an error, an abort): the caller falls back on anything but an abort.
   */
  // `newest` (review of #2986, residual): also read the series' NEWEST session (`newest`: its bars), beside the window, so
  // the caller can check the lake's basis against the present key it holds. `splitsStale`: the index's `splits_as_of`
  // lags its newest bar by more than LAKE_SPLITS_STALE_DAYS (a split table that stopped being stamped).
  async function windowBars(key, { bars: want, signal, yieldTask, newest = false } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || ls.to == null || !(want > 0)) return null
    // (the index promise is shared with every reader of the symbol: an abort of this read must not reject theirs)
    const index = await source.loadIndex(ls.sym)
    if (signal?.aborted) throw signal.reason ?? new DOMException('The load was aborted', 'AbortError')
    if (!index) return null
    const through = lakeThrough(index, ls.series)
    if (through == null || !(through >= ls.dayStart)) return null
    const newestP = newest ? newestSession(ls, index, through, signal).catch(() => null) : null
    const bars = await windowRows(ls, index, want, signal, yieldTask)
    if (!bars.length) return null
    const asOf = typeof index.splits_as_of === 'string' ? Date.parse(`${index.splits_as_of}T00:00:00Z`) / 1000 : NaN
    // (review of #2986, F-C) measured against the wall clock too: a lake whose publishing stopped stalls its newest bar
    // AND its stamp together, and through - asOf alone would never see it
    const splitsStale = Number.isFinite(asOf) && Math.max(through, now() / 1000) - asOf > LAKE_SPLITS_STALE_DAYS * 86400
    const out = { bars, through, splitsStale }
    // (F-A) the newest-session read is bounded like the window's wait: no answer in time, no check (the other checks stand)
    if (newestP) {
      let t = null
      const cap = new Promise((resolve) => { t = setTimeout(() => resolve(null), NEWEST_SESSION_MAX_MS) })
      out.newest = (await Promise.race([newestP, cap])) || null
      clearTimeout(t)
    }
    return out
  }
  /** The bars of the series' newest day in the lake (the last piece's tail), or null. */
  async function newestSession(ls, index, through, signal) {
    const all = periodsFor(index, ls.series, {})
    if (!all.length) return null
    const from = Math.max(all[all.length - 1].first, through - 86400)
    const got = await source.loadBars(ls.sym, ls.tf, { from, to: through, extended: ls.extended, signal })
    if (!got || !got.t.length) return null
    const out = []
    for (let k = 0; k < got.t.length; k++) out.push({ t: got.t[k], o: got.o[k], h: got.h[k], l: got.l[k], c: got.c[k], v: got.v[k] })
    return out
  }

  /** ⛔ EXACTLY the newest `want` bars at or before `ls.to` (the origin's count, not scroll-back's "about that many"). The
   *  piece the cutoff falls in holds only part of its bars before it: estimated by its share of the piece's span, and when
   *  the read comes up short with older pieces left, the deficit is read from them (oldest pieces first, prepended). */
  async function windowRows(ls, index, want, signal, yieldTask) {
    const periods = periodsFor(index, ls.series, { to: ls.to })
    const ok = (b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0   // the origin's serve drops a non-positive price
    let rows = []
    let i = periods.length - 1
    for (let pass = 0; pass < 8 && i >= 0 && rows.length < want; pass++) {
      const pick = []
      let have = rows.length
      for (; i >= 0 && have < want; i--) { pick.unshift(periods[i]); have += barsAtOrBefore(periods[i], ls.to) }
      const to = rows.length ? rows[0].t - 1 : ls.to
      const got = await source.loadBars(ls.sym, ls.tf, { from: pick[0].first, to, extended: ls.extended, signal, ...(yieldTask !== undefined ? { yieldTask } : {}) })
      if (signal?.aborted) throw signal.reason ?? new DOMException('The load was aborted', 'AbortError')
      if (!got || !got.t.length) break
      const { t, o, h, l, c, v } = got
      const more = []
      for (let k = 0; k < t.length; k++) {
        if (t[k] > to) break
        const b = { t: t[k], o: o[k], h: h[k], l: l[k], c: c[k], v: v[k] }
        if (ok(b)) more.push(b)
      }
      rows = more.concat(rows)
    }
    return rows.length > want ? rows.slice(rows.length - want) : rows
  }
  /** Does the lake hold `sym` at all (its index exists)? A 404 is "no such ticker": the typed warm's
   *  second authority when the daily pack does not know a real ticker. Never rejects. */
  function hasSymbol(sym) {
    return Promise.resolve().then(() => source.loadIndex(sym)).then((i) => !!i).catch(() => false)
  }
  // ⭐ THE EDGE WARM (2026-11-18). Owner's standard: a ticker opened on 1h, zoomed out, shows its whole
  // history at once. Measured live (cold ticker, 1h): index ~130 ms, then 8 pieces 300-950 ms because
  // nothing in that data center had read them yet; once the edge holds them all 8 land in ~70 ms, so the
  // whole depth joins inside the open's wait (LAKE_JOIN_WAIT_MS) and paints once. This loads the index
  // into the page (kept for its life: the open skips that hop too) and HEADs the pieces of the chart's
  // whole depth (the same pieces `prime` would fetch), so the edge keeps them; no body comes back.
  // Resolves the pieces asked (0 when the lake has nothing, or the key was warmed on this page), or
  // EDGE_WARM_REFUSED (-1) when the edge refused the member (401/403). Never rejects.
  // The warm's signal never reaches loadIndex: that promise is shared with a chart's own read, which an
  // aborted warm must not reject (review of #1880).
  const edgeWarmed = new Set()
  function edgeWarm(key, { signal } = {}) {
    const ls = lakeSeriesOfKey(key)
    if (!ls || !ls.series || !source.warmEdge || edgeWarmed.has(key) || signal?.aborted) return Promise.resolve(0)
    edgeWarmed.add(key)
    if (edgeWarmed.size > EDGE_WARM_MAX_KEYS) edgeWarmed.delete(edgeWarmed.values().next().value)
    return Promise.resolve().then(() => source.loadIndex(ls.sym)).then((index) => {
      if (!index || signal?.aborted || !windowInLake(index, ls)) return 0
      return source.warmEdge(ls.sym, ls.series, ls.to != null ? windowPieces(index, ls, WINDOW_PRIME_BARS) : depthPieces(index, ls.series, PRIME_PIECES, lakeTargetBars(ls.tf)), { signal })
    }).catch((err) => {
      edgeWarmed.delete(key)
      return err?.status === 401 || err?.status === 403 ? -1 : 0
    })
  }
  return { olderBars, windowBars, prime, hasSymbol, edgeWarm }
}

/** The newest bar time the lake holds for `series` (null: none). */
function lakeThrough(index, series) {
  let through = null
  for (const e of periodsFor(index, series, {})) if (through == null || e.last > through) through = e.last
  return through
}
/** Does the lake hold the window of `ls` (always true for a plain key)? Its day reached: windowBars' rule. */
function windowInLake(index, ls) {
  if (ls.to == null) return true
  const through = lakeThrough(index, ls.series)
  return through != null && through >= ls.dayStart
}

/** How many of piece `e`'s bars lie at or before `to`: all of them, or (the piece the cutoff falls in) its share of the
 *  piece's span, an estimate a short read corrects (`windowRows`' next pass). */
function barsAtOrBefore(e, to) {
  if (e.last <= to) return e.bars
  const span = e.last - e.first
  return span > 0 ? Math.floor(e.bars * (to - e.first) / span) : 0
}
/** The pieces window read `ls` takes first for `want` bars (its prime and edge warm warm exactly these), oldest first. */
function windowPieces(index, ls, want) {
  const periods = periodsFor(index, ls.series, { to: ls.to })
  const pick = []
  let have = 0
  for (let i = periods.length - 1; i >= 0 && have < want; i--) { pick.unshift(periods[i]); have += barsAtOrBefore(periods[i], ls.to) }
  return pick
}

/** The newest pieces of `series` holding at least `bars` bars (and at least `pieces` pieces), oldest first. */
function depthPieces(index, series, pieces, bars) {
  const all = periodsFor(index, series, {})
  let have = 0
  let from = all.length
  while (from > 0 && (all.length - from < pieces || have < bars)) { from--; have += all[from].bars || 0 }
  return all.slice(from)
}

/** Bars a window's prime and edge warm reach back (its read asks the chart's first-paint count, or a warm's 4,000). */
export const WINDOW_PRIME_BARS = 4000

/** Keys `edgeWarm` remembers per page. */
export const EDGE_WARM_MAX_KEYS = 2000

/** Pieces `prime` warms per key: the newest two hold the first lake window of every series (a month
 *  of 1m, a quarter of 5m, a year of 15-60m each, against a ~6,000-bar window). */
export const PRIME_PIECES = 2
/** Keys `prime` remembers (a page that opens more starts forgetting the oldest). */
export const PRIME_MAX_KEYS = 500
/** (review of #2986) A lake index whose `splits_as_of` lags its newest bar by more than this many days has a stale split
 *  table: its windows are the origin's. */
export const LAKE_SPLITS_STALE_DAYS = 7
/** (review of #2986, F-A) The newest-session read beside a window waits at most this long. */
export const NEWEST_SESSION_MAX_MS = 800
