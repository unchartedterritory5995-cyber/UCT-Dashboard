// app/src/components/chart/engine/ast/manifestProse.js
//
// ─── ⭐ THE MANIFEST'S PROSE IS FOR ENGINEERS, AND IT WAS SHIPPING TO MEMBERS ──
//
// `closedTable.json` is 169KB, and 68KB of it — FORTY PER CENT — is top-level
// prose: the rulings that explain why `cum` is refused, why an offset may not run
// forwards, what a vendor note may be written from. Every one is load-bearing
// documentation and none of it is read at runtime. It was being parsed and held in
// memory by every browser that loaded the engine.
//
// ⛔ THIS IS A BUILD-TIME STRIP, NOT AN EDIT. The file on disk keeps every word —
// it is the repo's most-cited artifact and the Python lane reads the SAME file, so
// the source cannot move. Only the browser bundle is slimmed, and only on `build`:
// tests and dev server see the whole document, because dozens of rails assert on
// exactly this prose.
//
// ⛔⛔ THE KEEP LIST IS EXPLICIT AND THE RAIL IS DERIVED, which is the only safe
// order. A build step that silently dropped a key the code READS would fail at
// runtime, in a browser, with a value that is `undefined` rather than a refusal —
// so `manifestProse.test.js` walks the real source of both lanes for property
// ACCESS (never a bare mention, which matches the comments that name these keys
// constantly) and fails if anything accessed is missing from `KEEP`.

/** Sections that carry the grammar itself. Never stripped, never prose. */
export const STRUCTURAL = Object.freeze([
  'nodeTypes', 'functions', 'scalars', 'series', 'clock', 'operators', 'benchmarks',
])

/** ⭐ THE `_` KEYS THE RUNNING PRODUCT ACTUALLY READS AS DATA — derived once by
 *  walking both lanes for property access, and pinned here so the strip is a
 *  decision rather than a guess. The rail re-derives it on every run.
 *
 *  ⚠️ `_functions_excluded` and `_scalars_excluded` are 41KB of the 48KB kept, and
 *  they stay because `vocabulary.js` serves the formula reference page from them —
 *  a member searching for a name they cannot use is told WHY, and that answer lives
 *  in these two rosters. They are data with prose in them, not prose. */
export const KEEP = Object.freeze([
  '_',                          // the document's own header, read server-side
  '_clock',                     // read by api/services/readiness.py
  '_functions_arg_role_kinds',  // read by interpret.js
  '_functions_excluded',        // read by vocabulary.js
  '_scalars_excluded',          // read by vocabulary.js
  '_benchmarks_scannable',      // read by vocabulary.js
])

/**
 * The manifest with its unread prose removed.
 *
 * ⛔ CONSERVATIVE BY CONSTRUCTION: it drops ONLY top-level keys that begin with
 * `_` and are not in `KEEP`. A per-entry `sentence` is never touched — those are
 * 9.7KB and they are what the read-back says to a member, so they are runtime data
 * by definition.
 *
 * @param {object} table the parsed manifest
 * @returns {{table: object, dropped: string[], savedBytes: number}}
 */
export function stripProse(table) {
  const out = {}
  const dropped = []
  let savedBytes = 0
  for (const [key, value] of Object.entries(table)) {
    if (key.startsWith('_') && !KEEP.includes(key)) {
      dropped.push(key)
      savedBytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
      continue
    }
    out[key] = value
  }
  return { table: out, dropped, savedBytes }
}
