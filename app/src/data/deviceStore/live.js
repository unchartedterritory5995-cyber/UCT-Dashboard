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
// comes from the live stream or the server's answer, as for any other local copy...
// ⭐ ...or, with forming.js on (intraday: ON), from here: the ONE bucket after the last complete one, MARKED
// `forming`. "In progress" is relative to `through`, not the clock: just after a bucket's end, before its last
// minute's frame has landed, it is still the forming bucket here, so the marker travels to the store (source.js
// `formingT`), which files it as the developing bar whatever the clock says, never as a closed bar (review of
// #2537, M1).
// ⛔ D FROM MINUTES IS NEVER A COMPLETE DAY (review of #2537, H2). The rollup's D bucket ends at 20:00 ET, but a
// day rolled up from minutes is not the official daily row (its volume, its open and close), so it is never handed
// out as a complete bar: at most as today's FORMING bar while the regular session is open (forming.js
// DEVICE_FORMING_DAILY, off). Today's official row comes from the server's own row below, or the next seed.
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
// ⭐ THE SERVER'S OWN DAY ROW AFTER THE CLOSE (forming.js DEVICE_DAILY_SERVER_ROW). When the frames carry it
// (codec FLAG_DAILY) and the consumer vouches that this device holds every row (`dailyOk`: it applied the
// epoch's full set and every frame since), today's D bar IS that row: O/H/L/C/V exactly as received (the server's
// check compares the raw row with the served D bar, so no rounding here), `forming: 'D'` until the 20:00 end of
// the D bucket (W / M then form from it, engine.js). Minute gaps and a bad D rollup do not touch it: it is not
// built from minutes. Without a row, or without `dailyOk`, the rollup path decides exactly as before.
//
// ⭐ JOINED ONLY ACROSS ONE NIGHT. A symbol's overlay is appended only when its seed window ends at the
// session right before the overlay's day (the seed entry's `asof`); a seed built after today's close
// already holds today (the overlay is not used), and an older seed would leave a whole session missing
// between the two (never joined).

import { isRthBar } from '../../components/chart/barTime'
import { bucketOf } from '../../lib/minuteFrames/rollup'
import { serverPrice } from './price'
import { DEVICE_FORMING_INTRADAY, DEVICE_FORMING_DAILY, DEVICE_DAILY_SERVER_ROW } from './forming'
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
 * @param {boolean} [o.formingIntraday]  hand out the 5/15/30/60 bucket in progress (forming.js; default its constant)
 * @param {boolean} [o.formingDaily]     hand out today's forming D bar (forming.js; default its constant)
 * @param {boolean} [o.dailyServerRow]   today's D bar from the server's own row after the close (forming.js
 *   DEVICE_DAILY_SERVER_ROW; the frames' DAILY section, consumer.js)
 */
export function createLiveOverlay({ nameOf = (sym) => sym, formingIntraday = DEVICE_FORMING_INTRADAY,
  formingDaily = DEVICE_FORMING_DAILY, dailyServerRow = DEVICE_DAILY_SERVER_ROW } = {}) {
  let day = null                 // 'YYYY-MM-DD' of the bars held
  let lastMinute = null          // unix minute of the newest frame applied (its minute is complete)
  let gapRth = false             // a gap overlapping the regular session since the day began
  let gapAny = false             // any gap since the day began
  let avAll = true               // every frame applied today carried the accumulated day volume (FLAG_AV)
  const series = new Map()       // `${tf}|${SYM}` → series
  const dailyRows = new Map()    // SYM (the seed's name) → { o, h, l, c, v }: the server's day row (FLAG_DAILY)
  let dailyOk = false            // the consumer vouches: those rows are the server's current ones
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
      avAll = true
      series.clear()
      dailyRows.clear()
      dailyOk = false
    },
    /** The server's day rows from a frame's DAILY section (consumer.js): a full set replaces, changes merge. */
    daily(info) {
      if (!dailyServerRow || !info || (day && info.day && info.day !== day)) return
      if (info.full) dailyRows.clear()
      for (const r of info.rows || []) {
        const name = nameOf(r.sym)
        if (name) dailyRows.set(name, { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })
      }
    },
    frameDone(info) {
      if (info?.day && info.day !== day) day = info.day
      if (Number.isFinite(info?.minute) && (lastMinute == null || info.minute > lastMinute)) lastMinute = info.minute
      // ⛔ fail closed: a frame that does not SAY it carried the day volume did not (consumer.js passes withAv)
      if (info?.withAv !== true) avAll = false
      dailyOk = info?.dailyOk === true
    },
  }

  // (1m never forms: its bar is complete once its minute's frame is applied, so no 1m bucket is ever in progress)
  const formingFor = (tf) => (tf === 'D' ? formingDaily : formingIntraday)

  // The ONE decision behind read() and why(): the answer and, when there is none, the rule that refused.
  function _read(sym, tf, seedAsof) {
    if (!day || lastMinute == null) return { res: null, why: 'no-day' }
    if (!_TFS.has(tf)) return { res: null, why: 'tf' }
    if (seedAsof !== prevSessionISO(day)) return { res: null, why: 'other-session' }
    const through = (lastMinute + 1) * 60
    // the server's own day row after the close (see the header): ahead of every minute-built rule
    if (tf === 'D' && dailyServerRow && dailyOk && dailyRows.has(sym)) {
      const r = dailyRows.get(sym)
      const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 1000
      const cols = { t: Float64Array.of(t), o: Float64Array.of(r.o), h: Float64Array.of(r.h), l: Float64Array.of(r.l),
        c: Float64Array.of(r.c), v: Float64Array.of(r.v) }
      return { res: through < bucketEndOf(t, 'D') ? { cols, through, forming: 'D' } : { cols, through }, why: 'ok' }
    }
    if (gapRth || (tf === 'D' && gapAny)) return { res: null, why: 'gap' }
    const s = series.get(keyOf(sym, tf))
    if (s?.bad) return { res: null, why: 'bad-series' }
    if (!s || !s.n) return { res: { cols: null, through }, why: 'ok' }
    let n = s.n
    // not finished: never handed out... ⛔ and a D bar built from MINUTES is never finished (review of #2537, H2). Its
    // bucket ends at 20:00 ET, and after the last frame it used to be appended as a COMPLETE row: its volume a sum of
    // minutes (or the vendor's accumulated volume), its O/H/L/C from regular-session minutes, never the official
    // daily row, yet stamped complete through 20:00, fresh, and painted by the daily switch. Today's official row
    // comes from the server, from the server's own day row above, or from the next seed.
    while (n > 0 && (tf === 'D' || bucketEndOf(s.cols.t[n - 1], tf) > through)) n--
    // ⭐ ...unless TODAY'S FORMING BAR is on for this timeframe (forming.js): then the ONE bucket after the last
    // complete one, as far as today's minutes go (the rollup's bucket in progress), MARKED `forming` (the store files
    // it as the developing bar whatever the clock says: source.js formingT, M1). D only when every frame of the day
    // carried the accumulated day volume, so its volume is the vendor's and not a sum of minutes, and ONLY WHILE THE
    // REGULAR SESSION IS OPEN (the newest minute applied is a regular-session minute: a half day closes at 13:00).
    // After the close it is no longer forming and it is not the official row either: nothing (H2).
    let forming = null
    if (n === s.n - 1 && formingFor(tf)) {
      if (tf !== 'D') forming = 'intraday'
      else if (avAll && s.cols.v[n] > 0 && isRthBar(lastMinute * 60)) forming = 'D'
    }
    const m = forming ? n + 1 : n
    if (!m) return { res: { cols: null, through }, why: 'ok' }
    const cols = {}
    for (const k of COLS) cols[k] = s.cols[k].slice(0, m)
    return { res: forming ? { cols, through, forming } : { cols, through }, why: 'ok' }
  }

  return {
    sink,
    /**
     * Today's COMPLETE bars of (sym, tf), when the overlay can vouch for them AND they continue a seed
     * window that ends at `seedAsof` ('YYYY-MM-DD'): `{ cols | null, through }`, where `through` is the
     * unix second the copy is complete up to and `cols` null when the symbol has no complete bar yet
     * (pre-market, no trade). Null when the overlay cannot vouch. Columns are COPIES.
     */
    read: (sym, tf, seedAsof) => _read(sym, tf, seedAsof).res,
    /** Diagnostics: 'ok', or the rule that made read() answer null: no-day | tf | other-session | gap | bad-series. */
    why: (sym, tf, seedAsof) => _read(sym, tf, seedAsof).why,
    /** The day held and the newest minute applied (unix minute), for diagnostics and freshness. */
    state: () => ({ day, lastMinute, gapRth, gapAny, series: series.size, dailyRows: dailyRows.size, dailyOk, ...stats }),
    /** Drop everything (a re-sync replays the day into a clean overlay). */
    clear() { day = null; lastMinute = null; gapRth = false; gapAny = false; avAll = true; series.clear(); dailyRows.clear(); dailyOk = false },
    get day() { return day },
  }
}
