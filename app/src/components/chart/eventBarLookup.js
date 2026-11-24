// ⭐ THE BAR THAT HOLDS AN EVENT DATE, WITHOUT AN INDEX OF EVERY BAR (2026-11-23, next-row chart walks, item i).
//
// The earnings, split and dividend badges (StockChart `earningsEventsOf` / `splitEventsOf` / `dividendEventsOf`)
// placed a handful of dates by building a Map over EVERY bar, keyed by the bar's bucket (`bucketEventDate`: a string
// slice per bar), on every symbol switch: ~8,000 bucket computations on a daily chart to place a few badges
// (production profile of a next-row press: 1.2 ms in the earnings builder alone).
//
// On bars whose times are strings in ascending order, a daily or monthly bucket is a PREFIX of the time (10 or 7
// characters), and a prefix of a sorted string list is sorted too: the bars of one bucket are one contiguous run,
// found by binary search. Of that run the LAST bar is the answer, as the Map's last write was. Any other input (a
// time that is not a string, an order that is not ascending, a weekly chart, whose bucket is a computed Monday) takes
// the Map, built exactly as before. So the answer is the Map's on every input: equality rails in
// `eventBarLookup.test.js` against the builders as they were.

/** An event date (or a D/W/M bar time) to the period it falls in: the day, the ISO week's Monday, or YYYY-MM. */
export function bucketEventDate(dstr, tf) {
  const s = String(dstr).slice(0, 10)
  if (tf === 'W') {
    const dt = new Date(`${s}T00:00:00Z`)
    if (isNaN(dt.getTime())) return s
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)) // → Monday of its ISO week
    return dt.toISOString().slice(0, 10)
  }
  if (tf === 'M') return s.slice(0, 7)   // YYYY-MM
  return s
}

/** Every bar's time a string, in ascending order (equal times allowed). One comparison per bar, nothing built. */
function stringTimesAscending(bars) {
  let prev = null
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const t = b == null ? undefined : b.t
    if (typeof t !== 'string') return false
    if (prev !== null && t < prev) return false
    prev = t
  }
  return true
}

/**
 * `date -> the bar whose period holds it` (or undefined): the same answer as
 * `new Map(bars.map((b) => [bucketEventDate(b.t, tf), b])).get(bucketEventDate(date, tf))`, the last bar of a bucket
 * winning. `bars` must not change while the lookup is used (the builders use it within one call).
 */
export function barLookupFor(bars, tf) {
  if (tf !== 'W' && Array.isArray(bars) && stringTimesAscending(bars)) {
    const k = tf === 'M' ? 7 : 10
    return (date) => {
      const target = bucketEventDate(date, tf)
      let lo = 0
      let hi = bars.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (bars[mid].t.slice(0, k) < target) lo = mid + 1
        else hi = mid
      }
      let hit
      for (let i = lo; i < bars.length && bars[i].t.slice(0, k) === target; i++) hit = bars[i]
      return hit
    }
  }
  const barByBucket = new Map()
  for (const b of bars) barByBucket.set(bucketEventDate(b.t, tf), b)
  return (date) => barByBucket.get(bucketEventDate(date, tf))
}
