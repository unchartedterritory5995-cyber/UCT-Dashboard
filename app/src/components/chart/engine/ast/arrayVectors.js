// app/src/components/chart/engine/ast/arrayVectors.js
//
// ─── ⭐⭐ MECHANISM A — AN ARRAY IS A PLAN-TIME VECTOR OF EXPRESSION SLOTS ───
//
// Owner ruling 2026-09-14 (wave 2, item (a)); recorded in
// `closedTable.json::_engine_limits.arrays_are_plan_time_vectors_on_the_definition_lane`.
//
// The definition lane is an EXPRESSION language — `NODE_TYPES` has no statement
// form and no collection form. It already reduces one block keyword this way:
// `switch` becomes "its one live arm" when the subject is a value the script
// fixes. An array whose size folds, and a loop whose iteration count folds, are
// the same argument with different keywords: the array becomes N SLOTS, each
// holding an ordinary expression tree, and `array.get(arr, k)` with a foldable
// `k` FOLDS TO SLOT k's TREE.
//
// ⭐⭐ THE R-A2 PROOF FALLS OUT OF THAT, IN ITS STRONGEST FORM. After the fold
// there is nothing new to decide about `maxLookback` or the repaint verdict:
// every slot is a node of a kind already in `NODE_TYPES`, so the existing walks
// read it unchanged, and a shape that cannot fold never enters the tree at all.
// There is no "compute the bound after the fold" step to get wrong, because the
// fold IS the bound.
//
// ⛔⛔ AND THE FORECLOSURE IS PER-LANE, NOT PER-PRODUCT. An array whose size, or
// a loop whose bound, depends on a SERIES cannot be a plan-time vector — ever,
// on this lane. It refuses by name, names the dependency and its line, and
// points at the item that will take it: **the IR lane, item (c)**, which already
// has statements and already reaches `uncharted-clouds.pine` line 57 by name.
// The words "not supported" are never used, because they would be false.
// ⛔ THIS MODULE IMPORTS NOTHING FROM `pine.js`, ON PURPOSE. `pine.js` imports
// IT, and a cycle between the two would make the guard table's initialisation
// order load-bearing. So every refusal here is returned as a DESCRIPTOR —
// `{ guard, detail }` — and `pine.js` builds the `PineRefusal` from it, keeping
// one thrower and one message table.

/** ⭐ THE ADMITTED SET IS THE CENSUS'S OWN HEAD, not a guess at one: these are
 *  7,272 of the 7,823 member calls measured across 327 scripts
 *  (`docs/pine/WAVE2-A-CENSUS.md` §A). Ranked, so a reader can see why each is
 *  here and what it cost to leave the tail out. */
export const CREATE_MEMBERS = Object.freeze(new Set([
  'new', 'new_float', 'new_int', 'new_bool', 'from',
]))

/** ⛔ A TYPED DRAWING ARRAY IS DRAWING, NOT DATA, and it refuses AT CREATION —
 *  not at first use. `array.new_label(64)` is a request for sixty-four labels;
 *  admitting the container and refusing the draw would accept a shape whose only
 *  purpose is the thing this item does not do. 299 calls across 60 files. */
export const DRAWING_MEMBERS = Object.freeze(new Set([
  'new_line', 'new_box', 'new_label', 'new_linefill', 'new_polyline',
]))

export const READ_MEMBERS = Object.freeze(new Set(['get', 'size', 'first', 'last']))
export const WRITE_MEMBERS = Object.freeze(new Set([
  'set', 'push', 'pop', 'shift', 'unshift', 'insert', 'remove', 'clear',
]))
export const REDUCE_MEMBERS = Object.freeze(new Set(['sum', 'max', 'min', 'avg']))

/** Every member this item handles at all. Anything else under `array.` keeps
 *  refusing `pine:collection` by name, which is the honest answer. */
export const HANDLED = Object.freeze(new Set([
  ...CREATE_MEMBERS, ...READ_MEMBERS, ...WRITE_MEMBERS, ...REDUCE_MEMBERS,
]))

/** ⭐⭐ THE UNROLL CEILING, IN SLOTS — derived in a1 from the corpus, not chosen.
 *
 *  The unit is UNROLLED NODES, because that is what a plan-time vector costs:
 *  worst measured real across 327 scripts was **19,992** (iterations x nesting,
 *  `relative-volume-at-time`), and the ceiling is that x 1.5 — R-Q's multiple and
 *  R-Q's method. ⚠️ RE-DERIVED AT a3 with the engine's real folder: a1's probe
 *  resolved 124 of 1,004 loops, so 19,992 is a floor on the true max. It is the
 *  right input today because a loop whose bound does not fold is REFUSED and
 *  contributes zero — the ceiling only has to bound what is ADMITTED.
 */
export const MAX_UNROLLED_NODES = 30000

/** A single vector may not itself exceed the ceiling. */
export const MAX_VECTOR_SLOTS = MAX_UNROLLED_NODES

/** The element type a creation declares, for the plan record. */
export function elementTypeOf(member, generic) {
  if (generic) return String(generic)
  if (member === 'new_float') return 'float'
  if (member === 'new_int') return 'int'
  if (member === 'new_bool') return 'bool'
  if (member === 'from') return 'inferred'
  return 'unknown'
}

/** ⛔⛔ THE SENTENCE A MEMBER READS WHEN THIS LANE CANNOT TAKE THEIR SHAPE, and
 *  it is ONE function so the wording cannot drift between the six sites that
 *  need it. It names WHAT depends on a series, WHERE, and WHICH item will take
 *  it — never "not supported". */
export function seriesDependentMessage(what, dependency, line) {
  return `${what} depends on a series — \`${dependency}\``
    + (line ? ` at line ${line}` : '')
    + ' — so it cannot be settled before the chart runs. On this lane an array is'
    + ' a plan-time vector, so its size and every loop bound must be known first.'
    + ' Runtime arrays are the IR lane\'s, item (c).'
}

/**
 * A vector binding: N slots, each an expression tree or `null` (never written).
 *
 * ⛔ `persists` IS PART OF THE PLAN, NOT A DETAIL. A `var` array is created once
 * and carries its slots across bars; a non-`var` array is rebuilt every bar. The
 * two produce different trees for the same source, so the flag is recorded at
 * creation and the rails drive both.
 */
export function makeVector({ size, elemType, persists, at, line, env, initial = null }) {
  return {
    kind: 'vector',
    size,
    elemType,
    persists: !!persists,
    // ⭐ Pine fills a sized creation with `na` unless an initial value is given,
    // so an unwritten slot is DISTINGUISHABLE from a slot written with `na`:
    // `null` means "never written", which is what the read rail needs.
    slots: new Array(size).fill(initial),
    at,
    line,
    env,
  }
}

/** ⛔ THE READ RAIL'S OTHER HALF (F2). A read of an array-typed name that has no
 *  recorded creation is a GUARD, never `na` — a silent `na` from a read that
 *  succeeded is indistinguishable from a member's own empty array. */
export function refuseUncreated(name) {
  return {
    guard: 'pine:collection',
    detail: `\`${name}\` is read as an array here and nothing in this script`
      + ' creates it, so there are no slots to read',
  }
}

/** A statically-known index outside a known size.
 *
 *  ⭐⭐ OWNER RULING, 2026-09-14, AND IT REVERSED THE INSTRUCTION THAT PRECEDED
 *  IT. The item was scoped with "out-of-range read follows Pine's na rule"; the
 *  measurement says Pine RAISES a runtime error for an out-of-bounds
 *  `array.get`, so `na` would match neither Pine nor this engine's own "never a
 *  silent na" doctrine. Ruled: refuse at plan time, naming the index, the size
 *  and the line. Recorded here rather than only in a commit message because the
 *  next reader of this function is the one who needs to know it was decided.
 *
 *  ⚠️ THIS REFUSES RATHER THAN YIELDING `na`, and the reason is on file: this
 *  engine's standing doctrine is that a value it can prove wrong is named, not
 *  silently emptied. Pine itself raises a RUNTIME error for an out-of-bounds
 *  `array.get`, so `na` would match neither Pine nor this engine — and a refusal
 *  carrying the index, the size and the line is strictly more use to a member
 *  than either.
 */
export function refuseOutOfRange(arrName, index, size) {
  return {
    guard: 'pine:collection',
    detail: `\`${arrName}\` holds ${size} slot${size === 1 ? '' : 's'} and this`
      + ` reads index ${index}, which is outside it`,
  }
}

/** ⭐⭐ A READ OF AN UNWRITTEN SLOT IS CORRECT, AND A MEMBER SHOULD STILL SEE IT.
 *
 *  `array.new<float>(21)` fills twenty-one slots with `na`, and `array.get` on
 *  one of them answers `na` — that is Pine's own behaviour and this engine
 *  reproduces it exactly, so it is NOT a refusal. But a plot that draws nothing
 *  because the array was never filled looks identical to a plot that draws
 *  nothing because the data is missing, and only one of those is the member's
 *  own doing.
 *
 *  ⛔ SO IT IS A NOTE, NOT SILENCE. The slot and the line are in the sentence,
 *  because "your array was never filled" without a line is not something anyone
 *  can act on.
 */
export const UNWRITTEN_NOTE = 'pine:vector-unwritten'

export function unwrittenSlotMessage(arrName, index, createdLine) {
  return TICK_NAME(arrName) + ' slot ' + index + ' was never written, so this reads `na`'
    + (createdLine ? ' — the array is created at line ' + createdLine : '')
    + '. That is what Pine answers for a sized array nothing has filled; it is'
    + ' recorded so an empty plot can be told from a missing one.'
}

/** One place builds the back-ticked name, so no call site hand-rolls one. */
function TICK_NAME(n) { return '`' + n + '`' }
