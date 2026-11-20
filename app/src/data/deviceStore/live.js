// app/src/data/deviceStore/live.js — TODAY's bars on the device, to the last COMPLETE minute.
//
// The seed (engine.js) holds every symbol's newest bars as of the LAST CLOSED session. During the
// session that copy is behind, so a never-opened symbol's intraday chart could not paint from it.
// The universe minute frames (lib/minuteFrames: the edge's /api/hist/live1m feed, decoded and
// rolled up to 1/5/15/30/60/D on the chart's own bucket helpers) fill the gap: this module is the
// SINK of that rollup and the overlay the engine's read appends to the seed's window.
//
// ⭐ ONLY WHAT THE SEED HOLDS, THE WAY THE SEED HOLDS IT. Kept: symbols the seed holds (`nameOf`, which
// also maps the feed's spelling, 'BRK.B', onto the seed's, 'BRK-B'; liveFeed also filters the rollup
// itself with it), the seed's timeframes (1 5 15 30 60 D; the '60e' clock grid is not seeded), and
// for intraday only REGULAR-SESSION buckets (barTime.isRthBar on the bucket start: the seed is the
// regular-session view, and on '60' that drops the 09:00 pre-market stub).
//
// ⭐⭐ COMPLETE BUCKETS ONLY, AND A STAMP SAYING HOW FAR (review of #2189). A read returns only buckets
// whose LAST minute has landed: a minute's frame arrives ~7-10 s after the minute ends, and the chart
// treats a bucket whose end has passed as CLOSED, so an unfinished bucket would paint as a closed bar
// the server then rewrites. With it goes `through`: the unix second up to which the copy is complete
// (the end of the newest minute applied). The handoff paints a device copy only while `through` is
// recent (prefetch.devicePaints), and the store records it as the copy's saved time. The forming bucket
// comes from the live stream or the server's answer, as for any other local copy. D completes at the
// end of the 04:00-20:00 day (rollup.bucketOf: its volume counts every minute).
//
// ⭐ EXACT, OR NOT USED. The overlay is appended to a read only while it can vouch for every bar it
// holds. It cannot after: a bucket the rollup marked PARTIAL (it spans minutes this device lacks) or
// STALE (a correction it could not settle), or a GAP since the day began. A gap is worse than a
// partial bucket: a bucket made ONLY of missing minutes is never emitted at all, so the series would
// silently skip it. A gap inside the regular session makes every intraday series and D unusable; one
// outside it (pre-market / after-hours) only D. Unusable means the read returns the seed alone: behind,
// so the chart asks the server, exactly as before. liveFeed.js re-syncs from the day file when the
// device merely MISSED frames that exist.
//
// ⭐ JOINED ONLY ACROSS ONE NIGHT. A symbol's overlay is appended only when its seed window ends at the
// session right before the overlay's day (the seed entry's `asof`); a seed built after today's close
// already holds today (the overlay is not used), and an older seed would leave a whole session missing
// between the two (never joined).

import { isRthBar } from '../../components/chart/barTime'
import { bucketOf } from '../../lib/minuteFrames/rollup'
import { serverPrice } from './price'
import { prevSessionISO } from './sessions'
import { STORED_TFS } from './tfs'

const _TFS = new Set(STORED_TFS)
/** A series starts this small and doubles: a symbol that trades a few minutes costs a few bars. */
export const LIVE_INITIAL_CAP = 8
const COLS = ['t', 'o', 'h', 'l', 'c', 'v']

export { prevSessionISO, nextSessionISO, isoOfYmd } from './sessions'

/** Exclusive end (unix s) of the `tf` bucket that starts at `t` (D: `t` is 00:00 UTC of its ET date). */
export function bucketEndOf(t, tf) {
  return tf === 'D' ? bucketOf(t + 43200, 'D')[1] : bucketOf(t, tf)[1]
}

function newSeries() {
  const cap = LIVE_INITIAL_CAP
  return { n: 0, cap, cols: Object.fromEntries(COLS.map((k) => [k, new Float64Array(cap)])), bad: false }
}

function grow(s) {
  const cap = s.cap * 2
  for (const k of COLS) { const a = new Float64Array(cap); a.set(s.cols[k].subarray(0, s.n)); s.cols[k] = a }
  s.cap = cap
}

/**
 * @param {object} [o]
 * @param {(sym:string) => string|null} [o.nameOf]  the seed's name for a feed symbol, or null when the
 *   seed does not hold it (only those are kept)
 */
export function createLiveOverlay({ nameOf = (sym) => sym } = {}) {
  let day = null                 // 'YYYY-MM-DD' of the bars held
  let lastMinute = null          // unix minute of the newest frame applied (its minute is complete)
  let gapRth = false             // a gap overlapping the regular session since the day began
  let gapAny = false             // any gap since the day began
  const series = new Map()       // `${tf}|${SYM}` → series
  const stats = { upserts: 0, kept: 0, gaps: 0, stale: 0, resets: 0 }

  const keyOf = (sym, tf) => `${tf}|${sym}`

  function _put(sym, tf, bar) {
    const k = keyOf(sym, tf)
    let s = series.get(k)
    if (!s) { s = newSeries(); series.set(k, s) }
    const t = bar.t
    const T = s.cols.t
    // bars arrive in time order almost always: check the end first, then search
    let i = s.n
    if (s.n && T[s.n - 1] >= t) {
      let lo = 0, hi = s.n
      while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m }
      i = lo
    }
    if (!(i < s.n && T[i] === t)) {
      if (s.n === s.cap) grow(s)
      for (const k2 of COLS) s.cols[k2].copyWithin(i + 1, i, s.n)
      s.n++
    }
    // ⭐ Prices at the SERVER's grain (price.js: Python's round(x, 4), what /api/bars stores), so a bar painted
    // from here is bit-identical to the server's. Rounding is monotone, so rounding the bucket's O/H/L/C equals
    // rounding every minute first: a max stays a max, a first stays a first. Volume is stored as received.
    s.cols.t[i] = t; s.cols.o[i] = serverPrice(bar.o); s.cols.h[i] = serverPrice(bar.h); s.cols.l[i] = serverPrice(bar.l); s.cols.c[i] = serverPrice(bar.c); s.cols.v[i] = bar.v
    if (bar.partial) s.bad = true
    stats.kept++
  }

  /** The rollup's sink (lib/minuteFrames/rollup.js header). */
  const sink = {
    upsert(sym, tf, bar) {
      stats.upserts++
      if (!_TFS.has(tf)) return
      if (tf !== 'D' && !isRthBar(bar.t)) return
      const name = nameOf(sym)
      if (name) _put(name, tf, bar)
    },
    stale(sym, tf) {
      if (!_TFS.has(tf)) return
      const name = nameOf(sym)
      if (!name) return
      stats.stale++
      let s = series.get(keyOf(name, tf))
      if (!s) { s = newSeries(); series.set(keyOf(name, tf), s) }
      s.bad = true
    },
    gap(info) {
      stats.gaps++
      gapAny = true
      // minutes are unix minutes; an RTH overlap is decided on the ET minute of day of each one
      const from = info?.fromMinute, to = info?.toMinute
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let m = from; m <= to; m++) if (isRthBar(m * 60)) { gapRth = true; break }
      } else gapRth = true
    },
    reset(info) {
      stats.resets++
      day = info?.day ?? null
      lastMinute = null
      gapRth = false
      gapAny = false
      series.clear()
    },
    frameDone(info) {
      if (info?.day && info.day !== day) day = info.day
      if (Number.isFinite(info?.minute) && (lastMinute == null || info.minute > lastMinute)) lastMinute = info.minute
    },
  }

  return {
    sink,
    /**
     * Today's COMPLETE bars of (sym, tf), when the overlay can vouch for them AND they continue a seed
     * window that ends at `seedAsof` ('YYYY-MM-DD'): `{ cols | null, through }`, where `through` is the
     * unix second the copy is complete up to and `cols` null when the symbol has no complete bar yet
     * (pre-market, no trade). Null when the overlay cannot vouch. Columns are COPIES.
     */
    read(sym, tf, seedAsof) {
      if (!day || lastMinute == null || !_TFS.has(tf) || seedAsof !== prevSessionISO(day)) return null
      if (gapRth || (tf === 'D' && gapAny)) return null
      const through = (lastMinute + 1) * 60
      const s = series.get(keyOf(sym, tf))
      if (s?.bad) return null
      if (!s || !s.n) return { cols: null, through }
      let n = s.n
      while (n > 0 && bucketEndOf(s.cols.t[n - 1], tf) > through) n--   // not finished: never handed out
      if (!n) return { cols: null, through }
      const cols = {}
      for (const k of COLS) cols[k] = s.cols[k].slice(0, n)
      return { cols, through }
    },
    /** The day held and the newest minute applied (unix minute), for diagnostics and freshness. */
    state: () => ({ day, lastMinute, gapRth, gapAny, series: series.size, ...stats }),
    /** Drop everything (a re-sync replays the day into a clean overlay). */
    clear() { day = null; lastMinute = null; gapRth = false; gapAny = false; series.clear() },
    get day() { return day },
  }
}
