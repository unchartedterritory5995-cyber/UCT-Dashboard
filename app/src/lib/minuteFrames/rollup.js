// app/src/lib/minuteFrames/rollup.js — rolls the universe's closed 1m bars into every timeframe
// a chart shows, with the SAME bucketing the charts and the server use, and hands each changed
// bar to a pluggable sink (the device store's append API, later; `createMemorySink` today).
//
// THE BUCKETS ARE NOT RE-ENCODED HERE. They come from the chart's own helpers:
//   1, 5, 15, 30   barTime.bucketStartUnix (a floor; identical on both 60m grids)
//   60             the SESSION grid (09:30, 10:30 ... 15:30 half bar; the 09:00 pre-market stub
//                  ends at 09:30; half-day aware): bucketStartUnix / liveBuckets.bucketEndUnix
//                  with grid 'session' == server bar_rollup.tv_bucket_bounds(t, '60', 'rth')
//   60e            the CLOCK grid (04:00 ... 19:00) == tv_bucket_bounds(t, '60', 'eth'); the
//                  store's cache key for the extended view (barTime.seriesCacheTf)
//   D              the ET date (store `t` = barStore/types.dateLabelToUnix of the label). Open,
//                  high, low and close from REGULAR-SESSION minutes only (barTime.isRthBar, the
//                  TradingView daily candle the charts draw; liveFeed.foldMinute uses the same
//                  rule); volume per `dailyVolume` (below).
// tests/fixtures/minute_frames/rollup_day.json holds the SERVER's buckets for sample days
// (written by tests/test_minute_frames.py from bar_rollup) and rollup.test.js must match it.
//
// EXACT, OR SAID SO. A minute is merged into its bucket exactly (open from its earliest minute,
// close from its latest, high/low max/min, volume summed), late minutes included. A REPLACE
// (the vendor corrected a minute already applied) is exact when the old minute is still held
// (`recentMinutes`) and was not the bucket's only high or low; otherwise the bucket is reported
// to the sink as STALE (its value can no longer be vouched for). Minutes the device never got
// (a gap, an incomplete frame) mark every bucket that spans them PARTIAL.
//
// SINK (all methods but `upsert` optional):
//   upsert(sym, tf, bar, final)  bar = { t, o, h, l, c, v, partial? }  t = unix seconds of the
//                                bucket start (D: UTC midnight of the ET date, as the store keys
//                                D); final = the bucket is closed. Same (sym, tf, t) = replace.
//   stale(sym, tf, t)            the rollup can no longer vouch for that bucket
//   gap(info)                    { day, fromMinute, toMinute, reason }: minutes this device lacks
//   reset({ day })               a new trading day starts (the consumer calls it)

import { bucketStartUnix, isRthBar, etDateLabel, etMinuteOfDay } from '../../components/chart/barTime'
import { bucketEndUnix } from '../../components/chart/liveBuckets'
import { KIND_REPLACE } from './codec'

export const ROLLUP_TFS = Object.freeze(['1', '5', '15', '30', '60', '60e', 'D'])
const SESSION_END_MIN = 20 * 60

function dateLabelToUnix(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 1000
}

/** [start, end) unix seconds of the `tf` bucket holding the minute that starts at `t`. D: the
 *  ET date's store key and the end of that date's 04:00-20:00 session. */
export function bucketOf(t, tf) {
  if (tf === '1') return [t, t + 60]
  if (tf === '60' || tf === '60e') {
    const grid = tf === '60' ? 'session' : 'clock'
    return [bucketStartUnix(t, 60, { grid }), bucketEndUnix(t, 60, { grid })]
  }
  if (tf === 'D') {
    // The session end (20:00 ET) of t's ET date. Wall-clock arithmetic is exact here: no US
    // session minute (04:00-20:00) shares a day with a DST switch's hour (02:00).
    return [dateLabelToUnix(etDateLabel(t)), t - etMinuteOfDay(t) * 60 - (t % 60) + SESSION_END_MIN * 60]
  }
  const n = Number(tf)
  const start = bucketStartUnix(t, n)
  return [start, start + n * 60]
}

function newAgg(t, end) {
  return { t, end, o: NaN, h: -Infinity, l: Infinity, c: NaN, v: 0, first: Infinity, last: -Infinity,
    final: false, partial: false, stale: false }
}

/**
 * @param {object} opts
 * @param {object} opts.sink                see the header
 * @param {string[]} [opts.tfs]             timeframes to keep (default ROLLUP_TFS)
 * @param {'auto'|'av'|'all'|'rth'} [opts.dailyVolume]  D volume: the vendor's accumulated day
 *        volume when frames carry it ('av'), the sum of every 04:00-20:00 minute ('all': what
 *        the vendor's daily bar counts), or regular-session minutes only ('rth'). 'auto' = av
 *        when present, else all.
 * @param {number} [opts.recentMinutes]     minutes of each symbol kept to settle corrections
 * @param {(sym:string) => boolean} [opts.accept]  symbols to roll up (default: every one). A symbol it
 *        refuses holds no state at all here, and reaches the sink not at all: the device store
 *        keeps only the symbols its seed holds, so the other several thousand cost nothing.
 * @param {boolean} [opts.forgetRefused]  after each frame, drop everything held for a symbol `accept`
 *        now refuses (default false: a symbol once accepted is kept until `reset`, as the device
 *        store's fixed seed needs). For a reader whose wanted symbols CHANGE through the day (the
 *        page's minute feed follows the bar store's held keys): without it every symbol ever wanted
 *        keeps its minutes and buckets until the day ends. Wanted again, a symbol starts from nothing.
 */
export function createMinuteRollup({ sink, tfs = ROLLUP_TFS, dailyVolume = 'auto', recentMinutes = 15, accept = null, forgetRefused = false } = {}) {
  if (!sink || typeof sink.upsert !== 'function') throw new Error('rollup needs a sink with upsert()')
  const higher = tfs.filter((tf) => tf !== '1')
  const emit1 = tfs.includes('1')
  /** sym -> { recent: Map<minute, [o,h,l,c,v,av]>, b: { tf: { cur, prev } } } */
  const syms = new Map()
  /** tf -> Map<end, Set<sym>> of open (not final) current buckets */
  const open = new Map(higher.map((tf) => [tf, new Map()]))
  /** [fromMinute, toMinute] ranges this device lacks, for the current day */
  let gaps = []
  const stats = { minutes: 0, repeats: 0, replaced: 0, late: 0, stale: 0, closed: 0 }

  const gapOverlaps = (start, end) => gaps.some(([a, b]) => a * 60 < end && (b + 1) * 60 > start)

  function stateOf(sym) {
    let s = syms.get(sym)
    if (!s) { s = { recent: new Map(), b: {} }; syms.set(sym, s) }
    return s
  }

  function emit(sym, tf, a) {
    if (tf === 'D' && !Number.isFinite(a.o)) return          // no regular-session minute yet
    const bar = { t: a.t, o: a.o, h: a.h, l: a.l, c: a.c, v: a.v }
    if (a.partial) bar.partial = true
    sink.upsert(sym, tf, bar, a.final)
  }

  function markOpen(tf, sym, a) {
    const m = open.get(tf)
    let set = m.get(a.end)
    if (!set) { set = new Set(); m.set(a.end, set) }
    set.add(sym)
  }

  function unmarkOpen(tf, sym, a) {
    const set = open.get(tf).get(a.end)
    if (set) { set.delete(sym); if (!set.size) open.get(tf).delete(a.end) }
  }

  /** The bucket aggregate for (sym, tf) holding minute-start `t`, creating it when it is newer
   *  than the current one. Null when it is older than the two held (too late to merge). */
  function aggFor(sym, s, tf, t) {
    const [start, end] = bucketOf(t, tf)
    let slot = s.b[tf]
    if (!slot) { slot = { cur: null, prev: null }; s.b[tf] = slot }
    if (slot.cur && slot.cur.t === start) return slot.cur
    if (slot.prev && slot.prev.t === start) return slot.prev
    if (!slot.cur || start > slot.cur.t) {
      if (slot.cur && !slot.cur.final) {                     // a newer bucket began: this one is done
        slot.cur.final = true
        unmarkOpen(tf, sym, slot.cur)
        emit(sym, tf, slot.cur)
        stats.closed++
      }
      slot.prev = slot.cur
      slot.cur = newAgg(start, end)
      if (gapOverlaps(start, end)) slot.cur.partial = true
      markOpen(tf, sym, slot.cur)
      return slot.cur
    }
    return null
  }

  /** How a minute's volume reaches a bucket: 'sum' (every intraday tf), or for D one of
   *  'av' | 'all' | 'rth' (see dailyVolume). */
  function volMode(tf, av) {
    if (tf !== 'D') return 'sum'
    if (dailyVolume !== 'auto') return dailyVolume
    return av != null && Number.isFinite(av) ? 'av' : 'all'
  }

  function mergeNew(sym, s, tf, minute, row) {
    const t = minute * 60
    const a = aggFor(sym, s, tf, t)
    if (!a) { stats.stale++; sink.stale?.(sym, tf, bucketOf(t, tf)[0]); return }
    const [o, h, l, c, v, av] = row
    if (tf !== 'D' || isRthBar(t)) {
      if (minute < a.first) { a.first = minute; a.o = o }
      if (minute > a.last) { a.last = minute; a.c = c }
      if (h > a.h) a.h = h
      if (l < a.l) a.l = l
    }
    const mode = volMode(tf, av)
    if (mode === 'av') { if (av > a.v) a.v = av }
    else if (mode !== 'rth' || isRthBar(t)) a.v += v
    emit(sym, tf, a)
  }

  function mergeReplace(sym, s, tf, minute, row, old) {
    const t = minute * 60
    const [start] = bucketOf(t, tf)
    const slot = s.b[tf]
    const a = slot && ((slot.cur && slot.cur.t === start) ? slot.cur : (slot.prev && slot.prev.t === start) ? slot.prev : null)
    if (!a) { stats.stale++; sink.stale?.(sym, tf, start); return }
    const [o, h, l, c, v, av] = row
    let exact = true
    if (tf !== 'D' || isRthBar(t)) {
      if (h >= a.h) a.h = h
      else if (old[1] >= a.h) exact = false                      // the old minute may have been the high
      if (l <= a.l) a.l = l
      else if (old[2] <= a.l) exact = false
      if (minute === a.first) a.o = o
      if (minute === a.last) a.c = c
    }
    const mode = volMode(tf, av)
    if (mode === 'av') { if (av > a.v) a.v = av }
    else if (mode !== 'rth' || isRthBar(t)) a.v += v - old[4]
    if (!exact) {
      a.stale = true
      stats.stale++
      sink.stale?.(sym, tf, a.t)
    }
    emit(sym, tf, a)
  }

  /** One closed minute of one symbol. `kind` = the frame block's (codec KIND_*). */
  function applyMinute(sym, minute, o, h, l, c, v, av = null, kind = 0) {
    if (accept && !accept(sym)) return
    const s = stateOf(sym)
    const row = [o, h, l, c, v, av]
    const old = s.recent.get(minute)
    if (old) {
      if (old[0] === o && old[1] === h && old[2] === l && old[3] === c && old[4] === v) { stats.repeats++; return }
      stats.replaced++
      s.recent.set(minute, row)
      if (emit1) sink.upsert(sym, '1', { t: minute * 60, o, h, l, c, v }, true)
      for (const tf of higher) mergeReplace(sym, s, tf, minute, row, old)
      return
    }
    if (kind === KIND_REPLACE) {
      // A correction of a minute this device no longer holds (or never applied): the 1m bar is
      // exact, the buckets around it cannot be vouched for.
      stats.replaced++
      if (emit1) sink.upsert(sym, '1', { t: minute * 60, o, h, l, c, v }, true)
      for (const tf of higher) { stats.stale++; sink.stale?.(sym, tf, bucketOf(minute * 60, tf)[0]) }
      return
    }
    stats.minutes++
    if (s.newest != null && minute < s.newest) stats.late++
    s.recent.set(minute, row)
    if (s.newest == null || minute > s.newest) s.newest = minute
    if (s.recent.size > recentMinutes) {
      const floor = s.newest - recentMinutes
      for (const k of s.recent.keys()) if (k <= floor) s.recent.delete(k)
    }
    if (emit1) sink.upsert(sym, '1', { t: minute * 60, o, h, l, c, v }, true)
    for (const tf of higher) mergeNew(sym, s, tf, minute, row)
  }

  /** Apply every record of a decoded frame (codec.decodeFrame), then close what its minute ended. */
  function applyFrame(f) {
    for (const blk of f.blocks) {
      for (let r = blk.start; r < blk.end; r++) {
        const av = f.av ? f.av[r] : null
        applyMinute(f.symbols[f.sym[r]], blk.minute, f.o[r], f.h[r], f.l[r], f.c[r], f.v[r],
          av != null && !Number.isNaN(av) ? av : null, blk.kind)
      }
    }
    advanceTo((f.minute + 1) * 60)
    if (forgetRefused && accept) {
      for (const sym of [...syms.keys()]) {
        if (accept(sym)) continue
        syms.delete(sym)                                       // (its open buckets are then never closed: advanceTo finds no state)
      }
    }
  }

  /** Close (emit final) every open bucket that ends at or before unix second `boundary`. */
  function advanceTo(boundary) {
    for (const tf of higher) {
      const m = open.get(tf)
      for (const end of [...m.keys()]) {
        if (end > boundary) continue
        for (const sym of m.get(end)) {
          const slot = syms.get(sym)?.b[tf]
          const a = slot?.cur
          if (a && a.end === end && !a.final) { a.final = true; emit(sym, tf, a); stats.closed++ }
        }
        m.delete(end)
      }
    }
  }

  /** Minutes [fromMinute, toMinute] are missing for the whole universe: every bucket spanning
   *  them is PARTIAL from now on, and the sink is told once. */
  function markGap(fromMinute, toMinute, info = {}) {
    gaps.push([fromMinute, toMinute])
    const lo = fromMinute * 60, hi = (toMinute + 1) * 60
    for (const s of syms.values()) {
      for (const tf of higher) {
        const slot = s.b[tf]
        for (const a of [slot?.cur, slot?.prev]) if (a && a.t < hi && a.end > lo) a.partial = true
      }
    }
    sink.gap?.({ fromMinute, toMinute, ...info })
  }

  function reset() {
    syms.clear()
    for (const m of open.values()) m.clear()
    gaps = []
  }

  return {
    applyMinute, applyFrame, advanceTo, markGap, reset,
    stats: () => ({ ...stats, symbols: syms.size, gaps: gaps.map((g) => [...g]) }),
    /** The held buckets of one symbol (tests and diagnostics). */
    peek: (sym, tf) => { const sl = syms.get(sym)?.b[tf]; return sl ? { cur: sl.cur && { ...sl.cur }, prev: sl.prev && { ...sl.prev } } : null },
  }
}
