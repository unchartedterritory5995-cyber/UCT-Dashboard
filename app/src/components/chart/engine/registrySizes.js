// app/src/components/chart/engine/registrySizes.js
//
// ─── WHAT SHIPS, BY LANE, BY NAME — AND THE ONE PLACE A COUNT LIVES ─────────
//
// 🔴 WHY THIS FILE EXISTS, MEASURED. Plan §A5: *"2 definitions cost 33
// assertions across 12 files."* Phase C Task 10 then watched 28 tests fail
// across 13 files, every one of them asserting `defs.length === 16`, because the
// registry moved to 17 mid-phase. Phase D adds a THIRD LANE, so a per-file
// integer literal would break every one of them again for no reason — and worse,
// each break is a hand edit that can be made wrong, which is how "17" ends up
// meaning three different things in three files.
//
// ⛔ THE MANIFEST BELOW IS HAND-WRITTEN, AND IT IS HAND-WRITTEN ON PURPOSE.
// The obvious version of this file derives the ids from `listDefinitions()` —
// and that version is TRUE BY CONSTRUCTION and can never fail. It is the exact
// vacuous-gate shape `CARVED_OUT_INDICATOR_KEYS` already refuses one file over
// (*"It is written down by hand so the test can disagree with it"*), and the
// exact shape §A5's finding was about: a count that derives from the thing it is
// checking measures nothing. So this module imports NOTHING. It is a
// DECLARATION of what the catalogue is; `nativeRegistry.test.js` holds the one
// equality that makes the registry prove it.
//
// ⭐ WHAT COLLAPSES, AND WHAT DOES NOT. Every count assertion elsewhere reads
// `REGISTRY_SIZES.*` instead of typing an integer — so a definition landing
// moves ONE line. What does NOT collapse is the claim: the rail that decides
// whether the catalogue is right is `SHIPPED_DEF_IDS`, a LIST, compared by
// equality. A count is satisfied by a RENAME and by a LANE MOVE; a list is not.
// (Phase D Task 1 lost an entire per-plot clause to exactly that — `(d.plots ||
// [])` answered `[]` for a renamed field and the case stayed green. Prefer a
// list to a count in any rail that must survive a rename.)

/**
 * The shipped catalogue: every registered definition id, partitioned by
 * `compute.kind`, in registry order.
 *
 * ⚠️ ORDER IS Z-ORDER AND IS PART OF THE CLAIM. `instances.js`'s stack order and
 * the binder's draw order both read `RAW_DEFS`' order, so this array is compared
 * ORDERED, not as a set: a re-ordering that moved `sar` in front of `bb` would
 * change what is painted over what on charts that never enabled either.
 *
 * ⚠️ `native` IS SIXTEEN AND NOT FOURTEEN. `avwap` and `atrBands` (Phase C Task
 * 14) are the first definitions that were never a `CHART_DEFAULTS.indicators`
 * section, so "the fourteen natives" is a sentence about the SETTINGS BLOB and
 * has not been a sentence about this registry since.
 *
 * ⚠️ `ast` IS EMPTY AND THAT IS A CLAIM, NOT A PLACEHOLDER. Phase D Task 8 built
 * the lane — `defSchema` validates an `ast` definition, `validateUserDefinitions`
 * budgets and lints it, `computeFor` interprets it — and registered NOTHING on
 * it, because an `ast` definition is a user's formula and arrives per user. The
 * day this repo ships one, this list is what says so.
 *
 * ⛔⛔ AND A USER'S FORMULA STILL DOES NOT COUNT HERE — PHASE D TASK 16. That
 * task gave the registry a RUNTIME index so an installed user definition
 * resolves through `getDefinition` and draws; this manifest is untouched by it
 * ON PURPOSE. `listDefinitions()` remains the SHIPPED catalogue and is what the
 * equality below is compared against, so `ast: []` and `REGISTRY_SIZES.ast === 0`
 * stay claims about this BUILD rather than about whoever happens to be signed
 * in. A manifest that counted session state would read green in every suite that
 * installs nothing and mean nothing in the one that does — the vacuous-gate shape
 * this whole file is written against. `nativeRegistry.test.js` asserts it by
 * installing a valid user definition and re-checking all three rails.
 */
export const SHIPPED_DEF_IDS = Object.freeze({
  native: Object.freeze([
    'rsi', 'macd', 'bb', 'vwap', 'stoch', 'atr', 'sar', 'ichimoku',
    'mfi', 'cci', 'williamsR', 'adx', 'obv', 'donchian', 'avwap', 'atrBands',
  ]),
  server: Object.freeze(['rsLine']),
  ast: Object.freeze([]),
})

/** The lanes this table partitions by — `defSchema.SUPPORTED_KINDS`, in order.
 *
 *  ⛔ NOT IMPORTED FROM `defSchema`, AND THE DUPLICATION IS DELIBERATE ONE TIME
 *  ONLY: importing it would make this module derive from the thing a test uses
 *  it to check, and `nativeRegistry.test.js` asserts the two are equal. A copy
 *  that is CHECKED is a different object from a copy that is trusted. */
export const REGISTRY_LANES = Object.freeze(['native', 'server', 'ast'])

/**
 * `{native, server, ast, total}` — the ONE place a registry count lives.
 *
 * ⛔ EVERY VALUE DERIVES FROM `SHIPPED_DEF_IDS`. Not one of them is a numeric
 * literal, and that is asserted by an AST scan over this file's own source in
 * `nativeRegistry.test.js` — because it is the one property no behavioural test
 * can ever see. `total: 17` and `total: a + b + c` are equal today and will stay
 * equal until the moment a definition lands, which is precisely the moment the
 * hardcoded one starts lying. (Same class as Phase D Task 7's M4: a hand-copied
 * `26` and a read `TRAILING_PAD` are the same number, so only a scan over the
 * source can tell them apart.)
 */
export const REGISTRY_SIZES = Object.freeze({
  native: SHIPPED_DEF_IDS.native.length,
  server: SHIPPED_DEF_IDS.server.length,
  ast: SHIPPED_DEF_IDS.ast.length,
  total: REGISTRY_LANES.reduce((n, lane) => n + SHIPPED_DEF_IDS[lane].length, 0),
})

/**
 * Partition a list of definitions into `{native, server, ast}` id arrays — the
 * shape `SHIPPED_DEF_IDS` is compared against.
 *
 * ⚠️ A DEFINITION ON A LANE THIS TABLE DOES NOT NAME GETS ITS OWN KEY rather
 * than being dropped or bucketed into a default. Dropping it would make the
 * equality pass while a `script` definition sat in the registry; a default
 * bucket would file it under a lane it is not on. An extra key fails `toEqual`
 * BY NAME, which is the only outcome that tells a reader what happened.
 *
 * @param {object[]} defs
 * @returns {{[lane: string]: string[]}}
 */
export function idsByLane(defs) {
  const out = {}
  for (const lane of REGISTRY_LANES) out[lane] = []
  for (const def of defs || []) {
    const lane = def && def.compute && def.compute.kind
    const key = typeof lane === 'string' && lane ? lane : '<no compute.kind>'
    if (!out[key]) out[key] = []
    out[key].push(def && def.id)
  }
  return out
}
