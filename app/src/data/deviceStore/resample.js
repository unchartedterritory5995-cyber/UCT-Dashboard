// app/src/data/deviceStore/resample.js — W and M from the device store's D bars.
//
// ⭐ SERVED TO THE PAGE ONLY FROM A WHOLE D COPY WHOSE PERIOD IN PROGRESS IS KNOWN (zero-network PR 3.3, tfs.js
// DEVICE_WM_FROM_FULL_D): `deriveServed` below, called by source.js. Anything else is null (H1 of #2537: a shallow copy
// without today's bar dropped the week / month in progress and still read current).
//
// ⭐ ONE OWNER OF THE BUCKETING: utils/resampleBars (resampleDailyToWeekly / resampleDailyToMonthly),
// which mirrors the server's resamplers bar for bar (ISO-Friday week label, 1st-of-month label). This
// module only converts columns to that module's row shape and back.
//
// ⛔ THE OLDEST BUCKET IS DROPPED. The D file holds the newest N sessions, so its first week / month
// usually starts mid-period: that bucket's open (and maybe its high / low) would be wrong. Every other
// bucket is whole. (A week starting on a holiday Monday makes the dropped one whole too: one bar of a
// 70-week chart is the price of never drawing a wrong one.)
// ⛔ AND SO IS A NEWEST BUCKET WHOSE PERIOD HAS NOT ENDED by `through` (the unix second the D copy is
// complete up to): mid-week, the week's bar from the days so far is not the bar the server sends, and
// painted it would be rewritten. Week: ends after its label Friday; month: after its last day.

import { resampleDailyToWeekly, resampleDailyToMonthly } from '../../utils/resampleBars'
import { etDateLabel, etMinuteOfDay } from '../../components/chart/barTime'
import { sessionISO, prevSessionISO } from './sessions'

/** The D label ('YYYY-MM-DD') of a D bar time: 00:00 UTC of the label date (the store's rule), or
 *  any time during the ET session day (read as its ET date). */
export function dayLabelOf(t) {
  return t % 86400 === 0 ? new Date(t * 1000).toISOString().slice(0, 10) : etDateLabel(t)
}

const unixOfLabel = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 1000

/** The exclusive end (unix s, 00:00 UTC) of the W / M period labelled `t` (00:00 UTC of its label). */
export function periodEndOf(t, tf) {
  if (tf === 'W') return t + 86400
  const d = new Date(t * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
}

/** D columns → W ('W') or M ('M') columns, labels as unix s at 00:00 UTC. Null when nothing whole.
 *  `through`: drop a newest bucket whose period has not ended by then (see the header), unless `forming`:
 *  the D columns end with TODAY'S forming bar (deviceStore/forming.js), so the period in progress is built
 *  from every day of it so far and is kept, as the server's forming week / month is. */
export function deriveFromDaily(cols, tf, { through = null, forming = false, whole = false } = {}) {
  if (!cols || !cols.t?.length || (tf !== 'W' && tf !== 'M')) return null
  const n = cols.t.length
  const rows = new Array(n)
  for (let i = 0; i < n; i++) {
    rows[i] = { t: dayLabelOf(cols.t[i]), o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }
  }
  // `whole`: the D columns start at the series' first served bar, so the oldest bucket is the server's oldest too
  // (the server resamples the same days): kept. Otherwise it may start mid-period and is dropped (see the header).
  const all = tf === 'W' ? resampleDailyToWeekly(rows) : resampleDailyToMonthly(rows)
  const out = whole ? all : all.slice(1)
  if (!forming && through != null && out.length && periodEndOf(unixOfLabel(out[out.length - 1].t), tf) > through) out.pop()
  if (!out.length) return null
  const m = out.length
  const res = { t: new Float64Array(m), o: new Float64Array(m), h: new Float64Array(m), l: new Float64Array(m),
    c: new Float64Array(m), v: new Float64Array(m) }
  for (let i = 0; i < m; i++) {
    const b = out[i]
    res.t[i] = unixOfLabel(b.t); res.o[i] = b.o; res.h[i] = b.h; res.l[i] = b.l; res.c[i] = b.c; res.v[i] = b.v
  }
  return res
}

/** ET minute from which a session day counts as begun for W / M (04:00, the pre-market open: a vendor's day row may carry
 *  pre-market trades, so from then on the copy must hold today's row to know the period in progress). */
export const SESSION_BEGUN_MIN = 240

/**
 * Is the period in progress KNOWN from D columns `cols` at `nowMs`? Their last row is today's (forming, or the server's
 * own row after the close: live.js), or no session has begun since their last row: before 04:00 ET of a session day the
 * last row must be the previous session; on a day that is not a session, the last session before it. Otherwise some
 * session's bar is missing from the copy and a W / M built from it would lack days the server's has.
 */
export function periodKnown(cols, nowMs) {
  const n = cols?.t?.length || 0
  if (!n) return false
  const nowSec = Math.floor(nowMs / 1000)
  const today = etDateLabel(nowSec)
  const last = dayLabelOf(cols.t[n - 1])
  if (last === today) return true
  const begun = sessionISO(today) && etMinuteOfDay(nowSec) >= SESSION_BEGUN_MIN
  return !begun && last === prevSessionISO(today)
}

/**
 * ⭐ THE ONE DOOR FOR A DEVICE W / M (tfs.DEVICE_WM_FROM_FULL_D): {cols, why}: W ('W') or M ('M') columns from a D copy
 * `d`, or null cols and the rule that refused. Only from a WHOLE copy (engine `whole`) whose period in progress is known
 * (periodKnown). The result carries the copy's `through` and `whole`, and `forming` (the tf) when its newest bucket's
 * period has not ended by `nowMs`: the store files that row as the developing bar (source.js formingT), as the server's
 * W / M answer has it.
 */
export function deriveServed(d, tf, nowMs) {
  if (!d || !d.t?.length) return { cols: null, why: 'no-daily' }
  if (d.whole !== true) return { cols: null, why: 'wm-shallow' }
  if (!periodKnown(d, nowMs)) return { cols: null, why: 'wm-period' }
  const w = deriveFromDaily(d, tf, { forming: true, whole: true })
  if (!w) return { cols: null, why: 'wm-empty' }
  w.through = d.through
  w.whole = true
  const m = w.t.length
  if (periodEndOf(w.t[m - 1], tf) > Math.floor(nowMs / 1000)) w.forming = tf
  return { cols: w, why: 'ok' }
}
