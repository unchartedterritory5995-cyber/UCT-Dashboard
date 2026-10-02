// G-040 ruling 1 — what "Save to Notebook" freezes from the Screener page.
//
// ⛔ A FROZEN SNAPSHOT OF THE RESULT SET AS THE MEMBER SAW IT, built once, at the
// press: the screen's name and its criteria (the definition as text, the same
// chip wording the page shows), the data's own as-of, the columns shown, up to
// the first SCREENER_CAPTURE_ROW_CAP rows in the order on screen — the ticker plus
// each visible column's value AS DISPLAYED — and the total match count. Coverage,
// when the page shows a four-count receipt, is carried whole for `CoverageLine`.
// The definition itself (`spec`) rides along ONLY so the note can offer a
// clearly-labelled NEW run; the note never re-runs it on its own.
//
// Pure: no React, no fetch. `notebookCapture.test.js` drives it directly.
import { COLUMN_DEFS } from '../columnDefs'
import { chipLabel } from '../chipLabel'
import { SCREENER_CAPTURE_ROW_CAP } from '../../../widgets/registry'

const POOL_KEYS = new Set(['universe', 'list'])

/** The pool the screen ran in, in the Universe bar's own words. */
export function screenerPoolLabel(filters = {}) {
  return filters?.list?.label || filters?.universe?.label || 'All Market'
}

/** The definition as text: the pool first, then one chip label per active filter. */
export function screenerCriteria(meta, filters = {}) {
  const byKey = Object.fromEntries((meta?.filters || []).map((f) => [f.key, f]))
  const chips = Object.entries(filters || {})
    .filter(([k, v]) => v && !POOL_KEYS.has(k))
    .map(([k, spec]) => chipLabel(byKey[k] || { label: k, presets: [] }, spec))
    .filter(Boolean)
  return [screenerPoolLabel(filters), ...chips]
}

/** The data's as-of, stated the way the Screener's seal states it. */
export function screenerAsOf(snapshotDate, snapshot) {
  const day = snapshotDate || 'date unknown'
  const live = snapshot?.live
  if (live?.state === 'live') {
    return `${day} ${live.as_of_et ? `${live.as_of_et} ET` : ''}`.trim()
      + ' (price-derived columns live; every other column from the 03:00 ET build)'
  }
  return `${day} 03:00 ET (nightly build)`
}

/** One cell's text exactly as the results table renders it.
 *  ⚠️ MIRRORS `VirtualResults.jsx`'s `cellValue` (a closure there, so it cannot be
 *  imported): price and 1-day change come from the live stream when it has them —
 *  that is what was on screen — and every column formats through `COLUMN_DEFS`. */
export function screenerCellText(row, key, livePrices) {
  const lp = livePrices?.[row?.ticker]
  let val = row?.[key]
  if (key === 'price' && lp?.price != null) val = lp.price
  if (key === 'chg_pct_1d' && lp?.change_pct != null) val = lp.change_pct
  const def = COLUMN_DEFS[key] || { fmt: (v) => v ?? '—' }
  if (def.cell === 'tag' && !val) return '—'
  if (def.cell === 'rs' && typeof val !== 'number') return '—'
  try {
    const out = def.fmt(val, row)
    return out == null || out === '' ? '—' : String(out)
  } catch {
    return val == null ? '—' : String(val)
  }
}

/**
 * The capture the Screener's "Save to Notebook" hands to the Notebook.
 * Returns null when there is nothing to describe (no result has landed yet).
 */
export function buildScreenerCapture({
  meta, filters, spec, visibleColumns, displayRows, livePrices,
  total, snapshotDate, snapshot, scanReceipts,
} = {}) {
  if (!Number.isFinite(total)) return null
  const cols = (Array.isArray(visibleColumns) && visibleColumns.length ? visibleColumns : ['ticker'])
  const rows = (Array.isArray(displayRows) ? displayRows : []).slice(0, SCREENER_CAPTURE_ROW_CAP)
  const coverage = (Array.isArray(scanReceipts) ? scanReceipts : [])
    .filter((r) => r && r.latest)
    .map((r) => ({ label: r.label || null, coverage: r.latest }))
  return {
    name: `Screener — ${screenerPoolLabel(filters)}`,
    criteria: screenerCriteria(meta, filters),
    spec: spec || null,
    asOf: screenerAsOf(snapshotDate, snapshot),
    columns: cols.map((c) => ({ key: c, label: COLUMN_DEFS[c]?.label || c })),
    rows: rows.map((r) => ({ ticker: r.ticker, cells: cols.map((c) => screenerCellText(r, c, livePrices)) })),
    total,
    coverage: coverage.length ? coverage : null,
  }
}
