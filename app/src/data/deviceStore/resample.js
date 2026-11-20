// app/src/data/deviceStore/resample.js — W and M from the device store's D bars.
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
import { etDateLabel } from '../../components/chart/barTime'

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
 *  `through`: drop a newest bucket whose period has not ended by then (see the header). */
export function deriveFromDaily(cols, tf, { through = null } = {}) {
  if (!cols || !cols.t?.length || (tf !== 'W' && tf !== 'M')) return null
  const n = cols.t.length
  const rows = new Array(n)
  for (let i = 0; i < n; i++) {
    rows[i] = { t: dayLabelOf(cols.t[i]), o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }
  }
  const out = (tf === 'W' ? resampleDailyToWeekly(rows) : resampleDailyToMonthly(rows)).slice(1)
  if (through != null && out.length && periodEndOf(unixOfLabel(out[out.length - 1].t), tf) > through) out.pop()
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
