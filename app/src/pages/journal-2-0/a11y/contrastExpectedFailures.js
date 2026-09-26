// app/src/pages/journal-2-0/a11y/contrastExpectedFailures.js
//
// A5's audit record (wave 8, lane 8A): the Notebook contrast failures that a
// Notebook-CSS token switch CANNOT fix, each tied to the ruling it waits on, and
// the fixable failures that sit in another lane's stylesheet. Written once from
// the measured rows and then held to them: notebookContrast.test.js fails on an
// entry with no ruling id, on an entry whose measured ratio moved, and on an
// entry that passes now (fixed -- remove it).
//
// ✅ CLOSED (D-A4, wave 8 lane 8A, controller ruling 2026-09-26 ~09:25 CT). The
// 139 rows below were the D-A4-1/2/3 rows this table held -- all 139 now pass:
// `tokens.css` gained three additive, Notebook-scoped tokens (--danger-ink,
// --success-ink, --field-edge, each measured >= its bar in every theme) and the
// 139 declarations switched to them. RULINGS is empty because no row cites one
// any more; this table stays because the NEXT contrast regression needs it.

/** The rulings these wait on -- the PROPOSED fix is lane 8A's; the controller rules.
 *  Empty: every ruling this table ever held (D-A4-1/2/3) is closed -- see above. */
export const RULINGS = Object.freeze({})

/** Empty: every D-A4-1/2/3 row this table held now passes -- see the header
 *  comment. A future contrast regression adds rows here again. */
export const EXPECTED_FAILURES = Object.freeze([])

/**
 * Fixable, but in another lane's stylesheet this wave -- that lane's to make.
 * Empty: lane 8C applied all five of its rows (the export menu, the export
 * dialog, the sample strip, the tour's title and Skip) in 6775e2968, so those
 * rules are held to the bar like every other. Add a row only for a failure in a
 * file LANE_OWNED names, with the fix.
 */
export const OTHER_LANES = Object.freeze([])
