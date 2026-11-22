# Capture queue: DIV-3 r1, a `table.cell` on a merged head cell (2026-11-09)

Branch `fix/pine-table-cells`. Source: the DIV-3 review, finding N1 (`table.cell` on a merged head cell
was SERVED with a guessed span, and the two lanes guessed differently).
Rails: `app/src/components/chart/engine/__tests__/tableCellReplace.test.js`. Rule: `app/src/components/chart/engine/objectCells.js`.
Procedure: `docs/pine/capture-queue-2026-09-28.md`. The owner runs every capture; no builder opens TradingView.
The probes were not compiled on TradingView when they were written. A runtime or compile error is itself a reading:
record its text and the line or bar it names, comment that row out, and capture the rest.

The Pine reference says `table.cell` "overwrites all previously defined properties of a cell", lists those
properties, and does not name the span `table.merge_cells` sets; `table.merge_cells` says "An attempt to merge a
cell that has already been merged will result in an error" and nothing about a later `table.cell`. Each row below
is WITHHELD BY NAME today on both lanes (`table:merged-head-rewrite`, `MERGED_HEAD_REWRITE_SENTENCE`): the capture
turns the withholding into a served rule.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-DIV3-1 | `tools/visual_conformance/probes/vw-div3-merged-head-rewrite.pine` rows M01-M05 | AMEX:SPY 1D | after `table.merge_cells`, does a `table.cell` on the head keep the span (M01 column span, M05 row span), does a head written only after the merge keep it (M02), what a write to a COVERED cell does (M03); M04 (`cell_set_text`, a patch) is the control | a `table.cell` on a merged head (M01, M02, M05) withholds the TABLE FAMILY on both lanes (host `withheldBy['table:merged-head-rewrite']`, runtime `withheld.table`), so this probe draws no table at all on our side, M03 and M04 included; alone, the M04 shape is drawn with the span and the M03 shape is drawn (a covered cell is not a head) on both lanes (rails) |
| Q-DIV3-2 | `tools/visual_conformance/probes/vw-div3-merged-head-every-bar.pine` row E01 | AMEX:SPY 1D | a `var` table whose header is written and merged on EVERY bar: a runtime error on the second bar, or does the rewrite undo the merge | withheld by the same guard from the second bar on, both lanes |
