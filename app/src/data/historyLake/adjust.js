// Split adjustment for decoded history-lake bars. The browser half of tools/history_lake/factors.py
// (THE RULE is written there; this file applies the same arithmetic and is pinned to it by
// adjust.test.js against values the Python reference produced).
//
//   ratio      = split_to / split_from
//   f(D)       = product of the ratios of every split executed strictly AFTER ET calendar date D
//   adj price  = raw price / f(D)        adj volume = raw volume * f(D)
//
// A split table is `[[execution_date 'YYYY-MM-DD', ratio], ...]`, ascending (what the symbol index
// carries as `splits`). Pieces stay raw on disk and at the edge: a new split changes one small
// table, never a piece.

const NY_HOUR = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
  : null

/** Epoch seconds of 00:00 America/New_York on an ISO calendar date. */
export function etMidnightEpoch(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) throw new Error(`not an ISO date: ${JSON.stringify(iso)}`)
  // 05:00 UTC is midnight in standard time and 01:00 in daylight time
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], 5) / 1000
  if (!NY_HOUR) return guess
  const hour = Number(NY_HOUR.format(new Date(guess * 1000)))
  return guess - hour * 3600
}

/** A usable table from whatever the index holds: ascending, finite positive ratios, no 1.0. */
export function cleanSplitTable(table) {
  if (!Array.isArray(table)) return []
  const rows = []
  for (const row of table) {
    if (!Array.isArray(row) || row.length < 2) continue
    const [date, ratio] = row
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio === 1) continue
    rows.push([date, ratio])
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return rows
}

/** The table as time segments: `[{ before: epoch seconds | Infinity, factor }]` ascending. A bar
 *  with `t < before` (and not below the previous segment's `before`) takes that factor; the last
 *  segment is `{ before: Infinity, factor: 1 }`. */
export function segmentFactors(table) {
  const rows = cleanSplitTable(table)
  const out = []
  for (let i = 0; i < rows.length; i++) {
    let f = 1
    for (let k = i; k < rows.length; k++) f *= rows[k][1]
    out.push({ before: etMidnightEpoch(rows[i][0]), factor: f })
  }
  out.push({ before: Infinity, factor: 1 })
  return out
}

/** f for one bar time. */
export function factorAt(segments, t) {
  for (const s of segments) if (t < s.before) return s.factor
  return 1
}

/**
 * Split-adjust float columns IN PLACE. `cols` is `{ t, o, h, l, c, v }` (t ascending epoch
 * seconds; o/h/l/c/v Float64Arrays, as `toFloats` returns). Returns `cols`.
 */
export function adjustColumns(cols, table) {
  const segs = segmentFactors(table)
  if (segs.length === 1) return cols
  const { t, o, h, l, c, v } = cols
  const n = t.length
  let si = 0
  for (let i = 0; i < n; i++) {
    const ti = t[i]
    while (ti >= segs[si].before) si++
    const f = segs[si].factor
    if (f === 1) {
      // every later bar is on the current basis only when this is the LAST segment
      if (si === segs.length - 1) break
      continue
    }
    o[i] /= f; h[i] /= f; l[i] /= f; c[i] /= f; v[i] *= f
  }
  return cols
}
