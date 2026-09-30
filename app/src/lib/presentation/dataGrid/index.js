// app/src/lib/presentation/dataGrid/index.js
//
// ─── S10 — THE DATAGRID SEED (TERM-065 / FB-S10-01) ──────────────────────────
//
// The one place a sortable grid gets its sort state, its header semantics and
// its column visibility. Headless: a grid keeps its own markup and CSS module.
//
//   useGridSort     sort state + sorted rows + requestSort / ariaSort / caret
//   useGridColumns  column order + visibility, persisted under a caller key
//   gridSort.js     the pure pieces (nextSort, ariaSortFor, sortCaretFor,
//                   sortRows, compareCells, isBlankCell)
//
// Consumers today: `journal-2-0/components/TradesTable.jsx`,
// `PositionsTable.jsx`, and the screener's `shell/VirtualResults.jsx` (header
// decisions) + `shell/liveSort.js` (the live re-sort comparator). `dataGridSeed.rail.test.js` keeps the list of grids
// that still hand-roll a sort, and it may only shrink.

export { default as useGridSort } from './useGridSort'
export { default as useGridColumns } from './useGridColumns'
export {
  ASC, DESC, nextSort, ariaSortFor, sortCaretFor, sortRows, compareCells, isBlankCell,
} from './gridSort'
