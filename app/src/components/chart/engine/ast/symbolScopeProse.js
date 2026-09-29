// app/src/components/chart/engine/ast/symbolScopeProse.js
//
// ─── ⭐ `symbolScope.json`'s PROSE IS FOR ENGINEERS; THE BUNDLE GETS THE DATA ──
//
// The same move `manifestProse.js` makes for `closedTable.json`, for the second
// manifest the engine imports. `symbolScope.json` is mostly the reasoning behind
// each exchange spelling and tick size — who witnessed it, which probe, why a
// store spelling is NOT served — and it rides in the ENTRY chunk, because the
// engine is reached eagerly (`chartDefaults.js` → `nativeRegistry.js` →
// `ast/bind.js`, `ast/pine.js`). Every route paid for it, the Notebook included,
// and the `syminfo.mintick` table (#238) pushed the Notebook's first-open budget
// over its line on 2026-09-29.
//
// ⛔ THE FILE ON DISK IS UNTOUCHED. The Python lane (`ast_bind.py`) and the rails
// read the full document; only the browser bundle is slimmed, and only on
// `build` (the vite plugin is `apply: 'build'`), so every test sees every word.
//
// ⛔⛔ WHAT SURVIVES IS DECIDED BY WHAT THE RUNTIME READS, AND THE RAIL DERIVES IT.
// `symbolScopeProse.test.js` walks the non-test source for `SYMBOL_SCOPE.<key>`
// access and fails if that set is not exactly `KEEP` — so a new reader cannot be
// starved by a key this list forgot, and a dropped reader cannot leave a passenger.
// It also rebuilds the engine's exported tables from the STRIPPED document and
// requires them to equal the ones built from the full file.
//
// ⭐ INSIDE A KEPT KEY, ONLY `_`-PREFIXED ENTRIES DROP. Every consumer already
// ignores them (`!k.startsWith('_')` in `bind.js` and `pine.js`), and the one
// lookup that does not filter — `bind.js::PENDING[node.name]` — is keyed by a Pine
// field name, which never begins with `_`.

/** The top-level keys the running product reads. The rail re-derives this. */
export const KEEP = Object.freeze([
  'confirmed',
  'pending_measurement',
  'tick_size',
  'unserved',
  'unserved_on_a_screen',
])

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The symbol-scope manifest with its unread prose removed.
 * @param {object} doc the parsed `symbolScope.json`
 * @returns {{doc: object, dropped: string[], savedBytes: number}}
 */
export function stripSymbolScope(doc) {
  const out = {}
  const dropped = []
  for (const [key, value] of Object.entries(doc || {})) {
    if (!KEEP.includes(key)) { dropped.push(key); continue }
    if (!isPlainObject(value)) { out[key] = value; continue }
    const kept = {}
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) { dropped.push(`${key}.${k}`); continue }
      kept[k] = v
    }
    out[key] = kept
  }
  const savedBytes = JSON.stringify(doc || {}).length - JSON.stringify(out).length
  return { doc: out, dropped, savedBytes }
}
