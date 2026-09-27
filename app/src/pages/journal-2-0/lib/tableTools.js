/**
 * Wave 10 (G-134) — column width and row sort for a Notebook table.
 *
 * Both are TRANSACTION BUILDERS over prosemirror-tables' own `TableMap`: they
 * read the table the caret is in, and return ONE transaction (or null when the
 * action would do nothing). The table toolbar dispatches them; nothing here
 * touches the DOM except `measuredColumnWidth`, which only reads it.
 *
 * ⛔ ONE TRANSACTION PER ACTION. A sort is a single `replaceWith` of the whole
 * table, so ONE Undo (Ctrl+Z, or the touch Undo) puts every row back where it
 * was. Two dispatches would be two history steps and an Undo would leave the
 * table half-sorted.
 * ⛔ AND ITS OWN STEP. prosemirror-history MERGES an adjacent change made within
 * 500ms into the previous step, so a sort right after typing in the table
 * would share one Undo with the typing — Undo would take the member's words
 * with it. Every transaction here is `closeHistory`-sealed.
 *
 * ⛔ `colwidth` IS NOT A NEW SCHEMA FIELD. The table extension has declared a
 * `colwidth` attribute on `tableCell` and `tableHeader` since before wave 5 —
 * every stored cell already carries `"colwidth": null`
 * (api/services/journal_two/sample_notebook.json). Resizing changes its VALUE
 * from null to a list of pixel widths, which every bundle already reads and
 * renders (the table's colgroup), so an older tab neither blanks nor drops it.
 * `notebookSchema.js` registers node and mark TYPES; nothing is added there.
 * Rail: tableTools.test.js ("colwidth is a level-0 attribute").
 */
import { TableMap } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

/** One tap of Wider / Narrower moves a column by this many pixels. */
export const COLUMN_STEP_PX = 40
/** Narrower stops here (the drag handle's own floor is the extension's 25px). */
export const COLUMN_MIN_PX = 40
/** Wider stops here: past it a note's table only scrolls sideways. */
export const COLUMN_MAX_PX = 960
/** A column nobody has sized and the browser has not laid out (jsdom). */
export const COLUMN_DEFAULT_PX = 120

/**
 * The table and cell the caret is in: `{ table, tablePos, start, map, row,
 * col, cellPos }` (positions absolute; `col` is the cell's LEFT column), or null.
 */
export function tableContext(state) {
  const $from = state?.selection?.$from
  if (!$from) return null
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d)
    const role = node.type.spec.tableRole
    if (role !== 'cell' && role !== 'header_cell') continue
    const table = $from.node(d - 2)
    if (!table || table.type.spec.tableRole !== 'table') return null
    const tablePos = $from.before(d - 2)
    const start = tablePos + 1
    const map = TableMap.get(table)
    const cellPos = $from.before(d)
    const rect = map.findCell(cellPos - start)
    return { table, tablePos, start, map, row: rect.top, col: rect.left, cellPos }
  }
  return null
}

/** The cell covering (row, col): `{ node, pos }` with pos absolute. */
function cellAt(ctx, row, col) {
  const rel = ctx.map.map[row * ctx.map.width + col]
  return { node: ctx.table.nodeAt(rel), pos: ctx.start + rel, rel }
}

/** Is the first row made of header cells only? (the pinned row) */
export function hasHeaderRowNode(table) {
  const first = table?.firstChild
  if (!first || !first.childCount) return false
  let all = true
  first.forEach((c) => { if (c.type.name !== 'tableHeader') all = false })
  return all
}

// ── column width ──────────────────────────────────────────────────────────

/** The stored width of column `col`, or null when nobody has sized it. */
export function storedColumnWidth(ctx, col = ctx?.col) {
  if (!ctx) return null
  for (let row = 0; row < ctx.map.height; row += 1) {
    const { node, rel } = cellAt(ctx, row, col)
    const cw = node?.attrs?.colwidth
    if (!Array.isArray(cw)) continue
    const index = (node.attrs.colspan || 1) === 1 ? 0 : col - ctx.map.colCount(rel)
    if (Number.isFinite(cw[index]) && cw[index] > 0) return cw[index]
  }
  return null
}

/** The column's rendered width from the DOM (0 when nothing is laid out). */
export function measuredColumnWidth(view, ctx, col = ctx?.col) {
  if (!view || !ctx) return 0
  try {
    const { pos, node } = cellAt(ctx, 0, col)
    const dom = view.nodeDOM(pos)
    const w = dom && typeof dom.getBoundingClientRect === 'function' ? dom.getBoundingClientRect().width : 0
    const span = node?.attrs?.colspan || 1
    return w > 0 ? Math.round(w / span) : 0
  } catch {
    return 0
  }
}

/** What Wider / Narrower start from: stored, else measured, else the default. */
export function currentColumnWidth(view, ctx, col = ctx?.col) {
  return storedColumnWidth(ctx, col) ?? (measuredColumnWidth(view, ctx, col) || COLUMN_DEFAULT_PX)
}

/**
 * ONE transaction setting column `col` to `width` px in every row — the same
 * write prosemirror-tables' drag handle makes (`updateColumnWidth`), so a
 * width set from the toolbar and one set by dragging are the same stored fact.
 * Null when nothing would change.
 */
export function setColumnWidthTr(state, ctx, col, width) {
  if (!ctx) return null
  const w = Math.round(Math.max(COLUMN_MIN_PX, Math.min(COLUMN_MAX_PX, width)))
  const tr = state.tr
  for (let row = 0; row < ctx.map.height; row += 1) {
    const idx = row * ctx.map.width + col
    // A cell spanning rows is written once, at its top row.
    if (row && ctx.map.map[idx] === ctx.map.map[idx - ctx.map.width]) continue
    const rel = ctx.map.map[idx]
    const node = ctx.table.nodeAt(rel)
    const span = node.attrs.colspan || 1
    const index = span === 1 ? 0 : col - ctx.map.colCount(rel)
    if (Array.isArray(node.attrs.colwidth) && node.attrs.colwidth[index] === w) continue
    const colwidth = Array.isArray(node.attrs.colwidth) ? node.attrs.colwidth.slice() : new Array(span).fill(0)
    colwidth[index] = w
    tr.setNodeMarkup(tr.mapping.map(ctx.start + rel), null, { ...node.attrs, colwidth })
  }
  return tr.docChanged ? closeHistory(tr) : null
}

// ── row sort ──────────────────────────────────────────────────────────────

const collator = typeof Intl !== 'undefined'
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : null

const SCALE = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

/**
 * A cell's text as a number, or null. Numeric-AWARE, the way a trader's table
 * reads: `1,200`, `$45.10`, `-3.5%`, `(2.4)` (a negative), `+12`, `1.2B`,
 * `850M`. Anything else is text.
 */
export function cellNumber(text) {
  let s = String(text ?? '').trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  s = s.replace(/^[-+−]/, (m) => { if (m !== '+') neg = !neg; return '' }).trim()
  s = s.replace(/^[$€£¥]\s*/, '')
  s = s.replace(/^[-+−]/, (m) => { if (m !== '+') neg = !neg; return '' })
  s = s.replace(/%$/, '')
  let scale = 1
  const suffix = /([kmbt])$/i.exec(s)
  if (suffix) { scale = SCALE[suffix[1].toLowerCase()]; s = s.slice(0, -1) }
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null
  const n = Number(s.replace(/,/g, '')) * scale
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

/**
 * The sort order of two cell texts. Blanks ALWAYS sink to the bottom (in
 * either direction); numbers compare as numbers and come before words; words
 * compare with a numeric-aware collator ("Q2" before "Q10").
 */
export function compareCellText(a, b, dir = 'asc') {
  const ta = String(a ?? '').trim()
  const tb = String(b ?? '').trim()
  if (!ta || !tb) return !ta && !tb ? 0 : (!ta ? 1 : -1)
  const na = cellNumber(ta)
  const nb = cellNumber(tb)
  let c
  if (na != null && nb != null) c = na - nb
  else if (na != null) c = -1
  else if (nb != null) c = 1
  else c = collator ? collator.compare(ta, tb) : (ta < tb ? -1 : ta > tb ? 1 : 0)
  return dir === 'desc' ? -c : c
}

/**
 * Can the table the caret is in be sorted by the caret's column? `{ ok,
 * reason }` — the reason is a sentence for the disabled button's title.
 */
export function canSortTable(state) {
  const ctx = tableContext(state)
  if (!ctx) return { ok: false, reason: 'Put the cursor in a table to sort it.' }
  const pinned = hasHeaderRowNode(ctx.table) ? 1 : 0
  if (ctx.table.childCount - pinned < 2) return { ok: false, reason: 'There is only one row to sort.' }
  let merged = false
  ctx.table.descendants((n) => {
    if ((n.attrs?.rowspan || 1) > 1) merged = true
    return n.type.spec.tableRole === 'row' || n.type.spec.tableRole === 'table'
  })
  if (merged) return { ok: false, reason: 'A table with cells merged across rows cannot be sorted.' }
  return { ok: true, reason: null, ctx }
}

/**
 * ONE transaction that reorders the table's rows by the text in column `col`
 * (`dir` 'asc' | 'desc'). The header row, when there is one, stays first.
 * Stable: rows that compare equal keep their order. Null when the table cannot
 * be sorted or is already in that order.
 */
export function sortTableTr(state, dir = 'asc', col = null) {
  const check = canSortTable(state)
  if (!check.ok) return null
  const ctx = check.ctx
  const c = col == null ? ctx.col : col
  const pinned = hasHeaderRowNode(ctx.table) ? 1 : 0
  const rows = []
  ctx.table.forEach((rowNode, _o, i) => { rows.push({ node: rowNode, i }) })
  const head = rows.slice(0, pinned)
  const body = rows.slice(pinned).map((r) => ({ ...r, key: cellAt(ctx, r.i, c).node?.textContent ?? '' }))
  const sorted = body.slice().sort((x, y) => compareCellText(x.key, y.key, dir) || x.i - y.i)
  if (sorted.every((r, k) => r.i === body[k].i)) return null
  const table = ctx.table.type.create(ctx.table.attrs, [...head, ...sorted].map((r) => r.node), ctx.table.marks)
  const tr = state.tr.replaceWith(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize, table)
  // Keep the caret in the sorted column's first cell, so the toolbar stays and
  // the member sees which column the table is sorted by.
  try {
    const newMap = TableMap.get(table)
    const rel = newMap.map[c]
    tr.setSelection(TextSelection.near(tr.doc.resolve(ctx.tablePos + 1 + rel + 1)))
  } catch { /* the selection maps on its own */ }
  return closeHistory(tr)
}
