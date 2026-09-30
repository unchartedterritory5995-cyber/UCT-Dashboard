// Pure re-sort of already-loaded rows by their LIVE overlay values (price /
// chg_pct_1d), used only while the live-sort toggle is on. Falls back to the
// row's own value when no live tick has landed for that ticker yet.
//
// TERM-065: the comparison is the DataGrid seed's `sortRows` -- blanks sink in
// both directions, numeric compare, equal rows keep their order -- exactly what
// the hand-rolled comparator did (`screenerGrid.seedParity.test.jsx`).
import { sortRows } from '../../../lib/presentation/dataGrid'

export const LIVE_SORTABLE = new Set(['price', 'chg_pct_1d'])

const liveVal = (row, key, lp) => {
  if (key === 'price' && lp?.price != null) return lp.price
  if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
  return row[key]
}

export function sortRowsLive(rows, sort, livePrices) {
  if (!sort?.key || !LIVE_SORTABLE.has(sort.key)) return rows
  return sortRows(rows, sort, {
    valueOf: (key, row) => liveVal(row, key, livePrices?.[row.ticker]),
    isNumeric: () => true,
  })
}
