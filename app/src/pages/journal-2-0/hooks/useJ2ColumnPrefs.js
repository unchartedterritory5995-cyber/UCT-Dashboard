/**
 * Journal 2.0 — column picker prefs hook.
 *
 * TERM-065: the implementation moved to the S10 DataGrid seed
 * (`lib/presentation/dataGrid/useGridColumns.js`). This path is kept as a
 * re-export — not a second copy — so `TradeJournalTab`, `OpenPositionsTab`
 * and the tests that mock this module keep working unchanged.
 */

export { default } from '../../../lib/presentation/dataGrid/useGridColumns'
