// app/src/lib/presentation/dataGrid/gridSort.js
//
// ─── S10 — THE DATAGRID SEED: SORTING (TERM-065 / FB-S10-01) ─────────────────
//
// The pure half of a sortable grid: which way a header click turns the sort,
// what `aria-sort` and the caret say about it, and how two cells compare. No
// React, no DOM, no clock.
//
// ⭐ LIFTED, NOT INVENTED. Every function here is what `TradesTable` and
// `PositionsTable` each hand-rolled, byte-for-byte in behaviour:
//   nextSort     <- both grids' `handleSort` (same key flips, a new key takes
//                   the column's default direction)
//   ariaSortFor  <- both grids' `aria-sort` ternary (Trades says 'none' for an
//                   inactive column, Positions omits the attribute — the
//                   difference is a PARAMETER, not something this module decides)
//   sortCaretFor <- both grids' ▲/▼ span
//   sortRows     <- both grids' comparator: blanks (null or '') sink to the
//                   bottom in BOTH directions, then numeric or text compare,
//                   then the grid's own stable tiebreak
// `journalGrids.seedParity.test.jsx` holds a snapshot recorded by the
// hand-rolled code before this module existed; the grids now run on it.
//
// ⛔ WHAT THIS DOES NOT DECIDE: a grid's default sort, which columns are
// numeric, what a cell's sortable value is, or how ties break. Those are facts
// about the grid's data and stay in the grid, passed in as functions.
//
// ⛔ A NEW SORTABLE GRID USES THIS MODULE. `dataGridSeed.rail.test.js` counts
// the modules under app/src that hand-roll a sort direction and fails by name
// on one that is not already in its shrinking baseline.

export const ASC = 'asc'
export const DESC = 'desc'

/** The sort after clicking `key`: flip the active column, or start a new one. */
export function nextSort(prev, key, defaultDirFor) {
  if (prev && prev.key === key) return { key, dir: prev.dir === ASC ? DESC : ASC }
  return { key, dir: defaultDirFor ? defaultDirFor(key) : DESC }
}

/**
 * The `aria-sort` value for column `key`. `inactive` is what a column that is
 * NOT the sort key says — `'none'`, or `undefined` to omit the attribute.
 */
export function ariaSortFor(sort, key, inactive) {
  if (!sort || sort.key !== key) return inactive
  return sort.dir === ASC ? 'ascending' : 'descending'
}

/** The visible caret for column `key`: ▲ ascending, ▼ descending, '' otherwise. */
export function sortCaretFor(sort, key) {
  if (!sort || sort.key !== key) return ''
  return sort.dir === ASC ? '▲' : '▼'
}

/** A blank cell sorts to the bottom whichever way the column is sorted. */
export const isBlankCell = (v) => v == null || v === ''

/** Compare two NON-blank cell values: numeric subtraction, or string order. */
export function compareCells(av, bv, numeric) {
  if (numeric) return av - bv
  const as = String(av)
  const bs = String(bv)
  return as < bs ? -1 : as > bs ? 1 : 0
}

/**
 * A sorted copy of `rows` under `sort` ({ key, dir }).
 *   valueOf(key, row)  the cell's sortable value
 *   isNumeric(key)     numeric subtraction when true, string order otherwise
 *   tiebreak(a, b)     the grid's stable order for equal (or both-blank) cells
 */
export function sortRows(rows, sort, { valueOf, isNumeric, tiebreak }) {
  const dir = sort.dir === ASC ? 1 : -1
  const numeric = isNumeric(sort.key)
  return [...rows].sort((a, b) => {
    const av = valueOf(sort.key, a)
    const bv = valueOf(sort.key, b)
    const aBlank = isBlankCell(av)
    const bBlank = isBlankCell(bv)
    if (aBlank && bBlank) { /* both blank: fall through to the tiebreak */ }
    else if (aBlank) return 1
    else if (bBlank) return -1
    else {
      const c = compareCells(av, bv, numeric)
      if (c !== 0) return c * dir
    }
    return tiebreak ? tiebreak(a, b) : 0
  })
}
