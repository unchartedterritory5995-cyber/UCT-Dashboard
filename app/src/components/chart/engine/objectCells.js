// app/src/components/chart/engine/objectCells.js
//
// ─── ⭐⭐ DIV-3 r1 — ONE RULE FOR WRITING A TABLE CELL, BOTH LANES ──────────────
//
// The host object lane (`objectRuntime.js`) and the runtime lane
// (`runtime/objectStore.js`) each wrote cells with their own copy of the rule, and
// the copies disagreed: the host lane merged every `table.cell` into the cell's old
// properties and carried a merge's span; the runtime lane replaced and dropped the
// span. One script, two tables. This module is the one authority, and both lanes
// call it.
//
// THE REFERENCE (`pine_v6_reference.json`, functions › `table.cell`, remarks[1]):
//   "Each table.cell() call overwrites all previously defined properties of a cell.
//   … If you want, instead, to modify any of the cell's properties, use the
//   table.cell_set_*() functions."
// So a `table.cell` is a REPLACE (an argument it does not pass takes its default
// again) and a `table.cell_set_*` is a PATCH of one property.
//
// ⛔⛔ WHAT THE REFERENCE DOES NOT SAY, WITHHELD BY NAME: what a `table.cell` does to a
// cell `table.merge_cells` made the HEAD of a merge. The span is not one of the
// properties `table.cell` lists, the `table.merge_cells` remarks say nothing about a
// later `table.cell`, and no capture records it. Keeping the span and dropping it are
// both guesses, so the table is not drawn: `MERGED_HEAD_REWRITE`, with a member
// sentence. The probes that settle it are queued: `docs/pine/capture-queue-2026-11-09-div3-merged-head.md`
// (`tools/visual_conformance/probes/vw-div3-merged-head-rewrite.pine`, `vw-div3-merged-head-every-bar.pine`).
//
// ⭐ The span a merge writes goes through `spanned` here too, so the shape a head
// cell carries is written in one place.

/** The guard a merged head's rewrite is withheld under. */
export const MERGED_HEAD_REWRITE = 'table:merged-head-rewrite'

/** What the member reads. */
export const MERGED_HEAD_REWRITE_SENTENCE = 'This table is not shown: the script writes a new value '
  + 'into a cell it had already merged with its neighbours, and how TradingView draws that merged '
  + 'cell afterwards has not been measured yet.'

/** The two ways a script writes a cell. */
export const CELL_WRITE = Object.freeze({ REPLACE: 'cell', PATCH: 'cellpatch' })

/** Is this cell the top-left of a `table.merge_cells` rectangle? */
export const isMergedHead = (cell) => !!cell && (cell.colspan !== undefined || cell.rowspan !== undefined)

/**
 * Write one cell.
 *
 * @param {object|undefined} prior  the cell at the address now (undefined: none)
 * @param {'cell'|'cellpatch'} kind `table.cell` (REPLACE) or `table.cell_set_*` (PATCH)
 * @param {(base: object) => object} write  the lane's own property writer: it puts
 *   this call's arguments onto `base` (resolving and normalising them its own way)
 *   and returns it. It is handed a FRESH object; `prior` is never mutated.
 * @returns {{cell: object, withhold: string|null}} the new cell, and the guard the
 *   table must be withheld under (or null)
 */
export function writeCell(prior, kind, write) {
  const p = prior || {}
  if (kind === CELL_WRITE.PATCH) return { cell: write({ ...p }), withhold: null }
  if (kind !== CELL_WRITE.REPLACE) throw new Error(`writeCell: unknown kind ${JSON.stringify(kind)}`)
  // a REPLACE starts from nothing: every argument the call does not pass is absent,
  // and the render state applies its default, exactly as on a first write
  const cell = write({})
  return { cell, withhold: isMergedHead(p) ? MERGED_HEAD_REWRITE : null }
}

/** The head cell of a merge: its own properties, plus the span. */
export const spanned = (prior, colspan, rowspan) => ({ ...(prior || {}), colspan, rowspan })
