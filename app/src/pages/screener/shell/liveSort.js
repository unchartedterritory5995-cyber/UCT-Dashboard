// Pure re-sort of already-loaded rows by their LIVE overlay values (price /
// chg_pct_1d), used only while the live-sort toggle is on. Falls back to the
// row's own value when no live tick has landed for that ticker yet.
export const LIVE_SORTABLE = new Set(['price', 'chg_pct_1d'])

const liveVal = (row, key, lp) => {
  if (key === 'price' && lp?.price != null) return lp.price
  if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
  return row[key]
}

export function sortRowsLive(rows, sort, livePrices) {
  if (!sort?.key || !LIVE_SORTABLE.has(sort.key)) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = liveVal(a, sort.key, livePrices?.[a.ticker])
    const bv = liveVal(b, sort.key, livePrices?.[b.ticker])
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return av === bv ? 0 : av > bv ? dir : -dir
  })
}
