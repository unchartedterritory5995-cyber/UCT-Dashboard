// app/src/components/chart/developingTail.js — complete an intraday series' RIGHT EDGE
// from finer bars already in memory.
//
// ⭐ THE CONTRACT (owner, 2026-11-11, vs TC2000): "we can't have missing data on any
// timeframe because we were on a different timeframe just before." When a timeframe's
// LOCAL copy (mem / IDB cache) stops early — its last bar was still forming when it was
// cached, or it is several buckets behind — but a FINER series of the same symbol and
// session view is in memory and current (the timeframe the member was just on, with its
// live developing bar), every missing/partial bucket of the target is DERIVED from it:
// the same aggregation the server performs (open = first, high = max, low = min,
// close = last, volume = sum) on the shared bucket grid (`bucketStartUnix`, the one
// owner of bucket math; 60m follows the TradingView session/clock grid).
//
// The first frame of a switch is then complete through NOW — the developing bar has its
// true bucket-to-date O/H/L/C, and the series already ends at the developing bucket, so
// the framing anchor (newest bar at the pinned right-edge slot) is final at first paint
// and nothing is inserted at the right edge when the network answer lands.
//
// ⛔ NEVER A GUESS. A source is used only when it PROVABLY covers every target bucket
// it rebuilds: it divides the target grid, its history starts at or before the first
// rebuilt bucket, and it is current (its newest bar is the bucket forming now, or the
// market has no bucket forming). Otherwise the base is returned untouched and the
// caller keeps its existing behaviour (the network answer completes the edge).

import { bucketStartUnix } from './barTime'

const _NATIVE = new Set(['1', '5', '15', '30', '60'])

/** Aggregate ascending unix-`t` bars into `tf` buckets on `grid` (pure). */
export function aggregateToTf(bars, tf, grid = 'session') {
  const out = []
  let cur = null
  for (const b of bars) {
    const s = bucketStartUnix(b.t, Number(tf), { grid })
    if (!cur || cur.t !== s) {
      cur = { t: s, o: b.o, h: b.h, l: b.l, c: b.c, v: Number(b.v) || 0 }
      out.push(cur)
    } else {
      if (b.h > cur.h) cur.h = b.h
      if (b.l < cur.l) cur.l = b.l
      cur.c = b.c
      cur.v += Number(b.v) || 0
    }
  }
  return out
}

/**
 * @param {Array<{t,o,h,l,c,v}>} base   the target tf's local series (ascending unix `t`)
 * @param {string} tf                   target tf ('5' | '15' | '30' | '60' …)
 * @param {Array<{tf:string, bars:Array}>} sources  finer series of the SAME symbol + view,
 *                                      in preference order (each ascending unix `t`)
 * @param {object} opts
 * @param {number} opts.nowSec          wall clock (unix s)
 * @param {string} [opts.grid]          60m grid ('session' | 'clock')
 * @param {boolean} [opts.marketOpen]   false ⇒ no bucket is forming (sources need not reach now)
 * @returns {Array} a NEW array with the tail rebuilt, or `base` itself when no source
 *   provably covers it (identity ⇒ "nothing composed").
 */
export function composeDevelopingTail(base, tf, sources, { nowSec, grid = 'session', marketOpen = true } = {}) {
  const T = String(tf)
  if (!_NATIVE.has(T) || !Array.isArray(base) || base.length === 0 || !Array.isArray(sources)) return base
  const last = base[base.length - 1]
  if (!last || typeof last.t !== 'number') return base
  // Rebuild from the base's LAST bucket: it may have been cached while still forming.
  const from = bucketStartUnix(last.t, Number(T), { grid })
  const tfMin = Number(T)
  for (const src of sources) {
    const s = String(src?.tf)
    const sb = src?.bars
    const sMin = Number(s)
    if (!_NATIVE.has(s) || !(sMin < tfMin) || tfMin % sMin !== 0 || !Array.isArray(sb) || sb.length === 0) continue
    if (typeof sb[0]?.t !== 'number' || sb[0].t > from) continue          // does not reach back to `from`
    const sLast = sb[sb.length - 1]
    if (typeof sLast?.t !== 'number') continue
    if (marketOpen && sLast.t < bucketStartUnix(nowSec, sMin, { grid })) continue   // not current
    // A source whose newest bucket is BEHIND the base adds nothing (and would drop bars).
    if (sLast.t < last.t) continue
    let i = sb.length - 1
    while (i > 0 && sb[i - 1].t >= from) i--
    if (sb[i].t < from) i++
    const tail = aggregateToTf(sb.slice(i), T, grid)
    if (!tail.length) continue
    const head = base.slice(0, base.length - 1)
    // Keep any base bar strictly before `from` (the base's last bar is in bucket `from`).
    while (head.length && head[head.length - 1].t >= from) head.pop()
    return head.concat(tail)
  }
  return base
}
