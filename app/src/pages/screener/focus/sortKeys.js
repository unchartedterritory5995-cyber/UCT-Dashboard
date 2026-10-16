// Which columns the Focus layout's sort menu offers (B9). Only NUMERIC columns: a text column
// sorts alphabetically, so "Structure ↓" ran Z→A.
//
// Numeric is derived, never listed here, from two sources that each own part of the answer:
//  · the server's meta: a `range` filter over a column is the server saying it is a number;
//    an `enum` or `bool` filter says it is not, and that wins over anything below;
//  · the column definitions (COLUMN_DEFS): a column with a `heat` scale is coloured by
//    comparing its value to numeric thresholds, so it is a number. This is what covers the
//    numeric view columns meta has no range filter for (pct_vs_sma50 / pct_vs_sma200 in the
//    technical and bases views).
// Meta's filter entries carry NO `column` field, and every range filter's key IS its column
// (filters.py), so the key is read; `column` is honoured only if a later payload carries it.
import { COLUMN_DEFS } from '../columnDefs'

const NUMERIC_TYPES = new Set(['range'])

export function columnTypes(meta) {
  const types = new Map()
  for (const f of meta?.filters || []) {
    const col = f?.column || f?.key
    if (col && f.type && !types.has(col)) types.set(col, f.type)
  }
  return types
}

export function isNumericColumn(key, types, columnDefs = COLUMN_DEFS) {
  const t = types.get(key)
  if (t) return NUMERIC_TYPES.has(t)
  return typeof columnDefs[key]?.heat === 'function'
}

// Offered in EVERY view, after the view's own columns: the two orderings a momentum trader asks of
// any list. "Volume vs usual by now" (live in the session) and "distance to the pattern entry".
// Neither is in most views, so a view-only menu could not rank by them. Still numeric-checked.
export const ALWAYS_SORTABLE = ['rvol_live', 'pattern_entry_dist_pct']

// The sort menu's keys, in order: the default sort, the current sort, the view's columns, then
// ALWAYS_SORTABLE; each once and only when numeric. The default sort is always offered.
export function sortableColumns({ meta, columns = [], sortKey = null, defaultKey, columnDefs = COLUMN_DEFS, always = ALWAYS_SORTABLE }) {
  const types = columnTypes(meta)
  return [...new Set([defaultKey, ...(sortKey ? [sortKey] : []), ...(columns || []), ...(always || [])])]
    .filter(k => k && (k === defaultKey || isNumericColumn(k, types, columnDefs)))
}
