// app/src/data/deviceStore/live.js — TODAY's bars on the device, to the last closed minute.
//
// The seed (engine.js) holds every symbol's newest bars as of the LAST CLOSED session. During the
// session that copy is behind, so a never-opened symbol's intraday chart could not paint from it.
// The universe minute frames (lib/minuteFrames: the edge's /api/hist/live1m feed, decoded and
// rolled up to 1/5/15/30/60/D on the chart's own bucket helpers) fill the gap: this module is the
// SINK of that rollup and the overlay the engine's read appends to the seed's window.
//
// ⭐ ONLY WHAT THE SEED HOLDS, THE WAY THE SEED HOLDS IT. Kept: symbols the seed holds (`nameOf`, which
// also maps the feed's spelling, 'BRK.B', onto the seed's, 'BRK-B'), the
// seed's timeframes (1 5 15 30 60 D; the '60e' clock grid is not seeded), and for intraday only
// REGULAR-SESSION buckets (barTime.isRthBar on the bucket start: the seed is the regular-session
// view, and on '60' that drops the 09:00 pre-market stub). A bucket still forming is kept too, as
// the newest bar (the reducer makes it the developing bar of a local copy).
//
// ⭐ EXACT, OR NOT USED. The overlay is appended to a read only while it can vouch for every bar it
// holds. It cannot after: a bucket the rollup marked PARTIAL (it spans minutes this device lacks) or
// STALE (a correction it could not settle), or a GAP since the day began. A gap is worse than a
// partial bucket: a bucket made ONLY of missing minutes is never emitted at all, so the series would
// silently skip it. A gap inside the regular session makes every intraday series and D unusable; one
// outside it (pre-market / after-hours) only D (its volume counts every minute of the day). Unusable
// means the read returns the seed alone: behind, so the chart asks the server, exactly as before.
// liveFeed.js re-syncs from the day file when the device merely MISSED frames that exist.
//
// ⭐ JOINED ONLY ACROSS ONE NIGHT. A symbol's overlay is appended only when its seed window ends at
// the session right before the overlay's day (the seed entry's `asof`); a seed built after today's
// close already holds today (the overlay is not used), and an older seed would leave a whole session
// missing between the two (never joined).

import { isRthBar } from '../../components/chart/barTime'
import { isHolidayISO } from '../../utils/marketSession'
import { STORED_TFS } from './tfs'

const _TFS = new Set(STORED_TFS)
/** Per-timeframe slot capacity: regular-session buckets in one day (a half day holds fewer). */
export const LIVE_CAP = Object.freeze({ 1: 390, 5: 78, 15: 26, 30: 13, 60: 7, D: 1 })
const COLS = ['t', 'o', 'h', 'l', 'c', 'v']

/** The trading session before ISO date `day` ('YYYY-MM-DD'): weekdays, NYSE full holidays skipped. */
export function prevSessionISO(day) {
  const d = new Date(`${day}T12:00:00Z`)
  for (let i = 0; i < 14; i++) {
    d.setUTCDate(d.getUTCDate() - 1)
    const wd = d.getUTCDay()
    const iso = d.toISOString().slice(0, 10)
    if (wd !== 0 && wd !== 6 && !isHolidayISO(iso)) return iso
  }
  return null
}

/** YYYYMMDD number → 'YYYY-MM-DD'. */
export const isoOfYmd = (n) => `${Math.floor(n / 10000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`

function newSeries(tf) {
  const cap = LIVE_CAP[tf]
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
  let lastMinute = null          // unix minute of the newest frame applied
  let gapRth = false             // a gap overlapping the regular session since the day began
  let gapAny = false             // any gap since the day began
  const series = new Map()       // `${tf}|${SYM}` → series
  const stats = { upserts: 0, kept: 0, gaps: 0, stale: 0, resets: 0 }

  const keyOf = (sym, tf) => `${tf}|${sym}`

  function _put(sym, tf, bar) {
    const k = keyOf(sym, tf)
    let s = series.get(k)
    if (!s) { s = newSeries(tf); series.set(k, s) }
    const t = bar.t
    const T = s.cols.t
    // bars arrive in time order almost always: check the end first, then search
    let i = s.n
    if (s.n && T[s.n - 1] >= t) {
      let lo = 0, hi = s.n
      while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m }
      i = lo
    }
    if (i < s.n && T[i] === t) {
      // same bucket: replace (the rollup re-emits a bucket each time it changes)
    } else {
      if (s.n === s.cap) grow(s)
      for (const k2 of COLS) s.cols[k2].copyWithin(i + 1, i, s.n)
      s.n++
    }
    s.cols.t[i] = t; s.cols.o[i] = bar.o; s.cols.h[i] = bar.h; s.cols.l[i] = bar.l; s.cols.c[i] = bar.c; s.cols.v[i] = bar.v
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
      if (!s) { s = newSeries(tf); series.set(keyOf(name, tf), s) }
      s.bad = true
    },
    gap(info) {
      stats.gaps++
      gapAny = true
      // minutes are unix minutes; an RTH overlap is decided on the ET minute of day of each end
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
      if (Number.isFinite(info?.minute)) lastMinute = info.minute
    },
  }

  return {
    sink,
    /**
     * Today's bars of (sym, tf) when the overlay can vouch for them AND they continue a seed window
     * that ends at `seedAsof` ('YYYY-MM-DD'), else null. Columns are COPIES (the caller may keep or
     * transfer them).
     */
    read(sym, tf, seedAsof) {
      if (!day || !_TFS.has(tf) || seedAsof !== prevSessionISO(day)) return null
      if (gapRth || (tf === 'D' && gapAny)) return null
      const s = series.get(keyOf(sym, tf))
      if (!s || !s.n || s.bad) return null
      const out = {}
      for (const k of COLS) out[k] = s.cols[k].slice(0, s.n)
      return out
    },
    /** The day held and the newest minute applied (unix minute), for diagnostics and freshness. */
    state: () => ({ day, lastMinute, gapRth, gapAny, series: series.size, ...stats }),
    /** Drop everything (a re-sync replays the day into a clean overlay). */
    clear() { day = null; lastMinute = null; gapRth = false; gapAny = false; series.clear() },
    get day() { return day },
  }
}
