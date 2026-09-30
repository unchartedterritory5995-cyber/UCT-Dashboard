// app/src/components/chart/engine/objectColumns.js
//
// ─── ⭐⭐ C3B — FEEDING THE OBJECT PROGRAM FROM THE SHARED GRAPH ─────────────
//
// The object program stores integers. This is where an integer becomes a column
// of numbers, once, and is read by every operation that names it.
//
// ⭐⭐ ONLY THE NODES THE PROGRAM ACTUALLY READS ARE COMPUTED. A saved V2 graph
// on a real script holds hundreds of nodes; an object program typically reads a
// dozen. Materialising the whole table would make a dashboard cost what a whole
// indicator costs, for nothing — so the reference set is derived from the
// program itself (`graphNodesReferenced`), and everything else stays an integer.
//
// ⛔ AND EACH NODE IS COMPUTED ONCE. Two lines whose y-coordinate is the same
// expression share a node by construction (C2C's content digest did that), so
// they must also share the column — otherwise the graph's whole compaction win
// is paid back in evaluation time.
//
// ⚠️ THIS IS ALSO THE ONE PLACE A DANGLING REFERENCE CAN STILL SURFACE. The
// document validator refuses out-of-range nodes at save time, but a document
// written by an older client, or hand-edited, reaches here — so a node that
// cannot be expanded yields a column of NaN and is REPORTED, never silently
// zero. An object at coordinate zero is a drawing; an object that did not draw
// is a fact.
import { nodeTree } from './ast/graph'
import { graphNodesReferenced, bindObjectProgram, runtimeAtIndex } from './ast/objectProgram'
import {
  interpret, maxLookback, readsSwitchedState, probeValuesOf, PREFIX_PROBE, switchedDependencyMask,
} from './ast/interpret'
import { RECURRENCES } from './ast/parse.js'
import { resolveInputs, bindConstsFor, historyFromListingFor } from './nativeRegistry'
import { foldBound } from './ast/bind'
import { barOpenInstant } from '../indicators.js'

// ─── ⭐⭐ C18 — THE RUNTIME LANE, FOR THE VALUES ONLY AN IMPERATIVE RUN COMPUTES ──
//
// A program carrying `runtime` (see `objectProgram.js::RUNTIME_AT_CALL`) has
// placeholder trees whose columns come from ONE run of the script through the
// per-bar runtime lane (`runtime/runtimeColumns.js::runtimeObjectValues`).
//
// ⭐ REGISTERED, NEVER IMPORTED — the same rule the runtime pane follows
// (`nativeRegistry.registerRuntimeLane`): the runtime lane is member-door
// machinery behind the member-pane gate, and no path from the app entry may reach
// it without that gate (`memberPaneGate.test.js`). The member door imports it —
// and so registers it — whenever it translates a script.
// ⛔ UNTIL IT IS REGISTERED, every placeholder reads UNKNOWN (`runtime:not-loaded`)
// — withheld, never guessed. A chart that opens a SAVED document before the member
// door has loaded in that session draws those objects only once it has.
let runtimeObjectValuesFn = null
export function registerObjectRuntimeValues(fn) {
  runtimeObjectValuesFn = typeof fn === 'function' ? fn : null
}

/** ⭐ C18 — did the member leave every input at the author's default, and edit no
 *  folded parameter? The runtime lane runs the script AS WRITTEN; a knob the
 *  member moved is in the drawing's trees and not in that run. */
function inputsAtDefaults(definition, inputs) {
  const manifest = definition && definition.compute && definition.compute.paramManifest
  if (manifest && Object.keys(manifest).length) return false
  for (const input of (definition && definition.inputs) || []) {
    if (!input || typeof input.key !== 'string') continue
    const v = inputs ? inputs[input.key] : undefined
    if (v !== undefined && !Object.is(v, input.default)) return false
  }
  return true
}

// ─── ⚰️⚰️ C3B-CLOSE item 6 — THE OBJECT LANE WAS CALLING `interpret` WRONG ────
//
// `interpret(ast, bars, inputs, budget, scalars, opts)`. This module called
//
//     interpret(tree, bars, opts.interpretOpts || {})
//
// which put an EMPTY OBJECT in the **inputs** position and passed no budget and
// no timeframe at all. The name `interpretOpts` made it read like the `opts`
// argument; it never reached it.
//
// ⛔ WHAT THAT COST, EXACTLY. `interpret` seeds its scope FROM `inputs` by name,
// so a definition that declares a member input and reads it in an object's
// coordinate — `line.new(…, close * (1 + off / 100), …)` — resolved `off` to
// nothing and the whole column refused. The PLOT beside it drew correctly,
// because `nativeRegistry.computeFor` has always passed `resolveInputs(def,
// inputs)`. One document, two evaluators, one of them deaf to the knob.
//
// ⛔ AND IT WAS INVISIBLE TO EVERY RAIL. Every object unit test builds its own
// trees out of literals, so `{}` is the correct inputs map for all of them; the
// eight live fixtures likewise carry no member input, because `input.int` in a
// WINDOW slot (`ta.sma(close, len)`) is deliberately folded and never becomes a
// knob (`builderInputs.inputsFromFolded`, `interpret.js::windowLiteral`). The
// defect needed a script whose knob sits in an ARITHMETIC position, which is
// what `c3b_09_param_object` is — see `tests/fixtures/c3b_live/`.
//
// ⭐ THE BUDGET AND THE TIMEFRAME TRAVEL FOR THE SAME REASON. `compute.budget`
// is the DOCUMENT's cap, so an object expression running uncapped beside a
// capped plot is the containment asymmetry `astColumnsFor` already refuses; and
// `isintraday`/`isdaily`/`isweekly`/`ismonthly` are answerable only from the
// caller's `tf`, so without it an object placed by a timeframe test silently
// reads the wrong branch.

/** ⭐⭐ C12 — THE BARS ON WHICH A TREE'S BOUNDED STATE IS NOT COMPUTABLE.
 *
 *  A translated `var` is `accum(seed, body, W)`, and its column is `NaN` on every
 *  bar before `W` (`interpret.js::runRecurrence`, "THE PREFIX IS NaN, NEVER A
 *  SHORT RUN"). Pine's `var` holds a real value there. Downstream the two `NaN`s
 *  are indistinguishable from Pine's own `na`, so a comparison against one is
 *  FALSE and an `else` runs that TradingView's script never ran — see
 *  `objectRuntime.js::readUnknown` for the label this drew wrong.
 *
 *  ⭐ SO THE QUESTION IS ASKED OF THE DATA, BAR BY BAR: does this bar's result
 *  DEPEND on the prefix? The tree is evaluated twice more with the prefix filled
 *  by `+PREFIX_PROBE` and by `-PREFIX_PROBE` (`interpret`'s `prefixProbe`); a bar
 *  whose value is the same all three ways did not read the prefix, and one whose
 *  value moves did. A comparison against the state flips between the two probes,
 *  `na(state)` flips between `NaN` and either probe, and arithmetic carries the
 *  probe through — so each way Pine's hidden value could have changed the answer
 *  shows as a difference here.
 *
 *  ⛔ A STATIC HORIZON WAS MEASURED FIRST AND REJECTED. Withholding every bar
 *  below the tree's `maxLookback` sums a nested `var` to `2W` and more: on the
 *  same capture it withheld all five BOS lines TradingView draws (bars 310–504,
 *  each correct), and it dropped one correct line from `price-action-in-book`,
 *  a MATCH. A recurrence that FORGETS (a flag set by a pivot, a level reset
 *  after a break) is known again at its first reset, and only the data says when.
 *
 *  ⚠️ A PROBE, NOT A PROOF: a function mapping `NaN`, `+P` and `-P` to one value
 *  while answering something else for Pine's real value would slip through. No
 *  such tree is known; the alternative is a taint pass through `interpret`'s
 *  every operator, which this lane does not have.
 *  A tree that reads no recurrence answers `null` — its warm-up `NaN` is Pine's
 *  own `na` (`ta.sma` warming is `na` in Pine too), and withholding there would
 *  drop objects TradingView draws. A probe that refuses answers `null` too: the
 *  real run succeeded, and a probe is not allowed to take a drawing away on a
 *  refusal of its own. */
// ⭐ C12s — `PREFIX_PROBE` and `probeValuesOf` live in `interpret.js` now (the
// plot lane's root agreement asks the same question with the same set); both
// names stay exported from here for every existing importer.
export { PREFIX_PROBE, probeValuesOf }

/** ⭐⭐ C12r (2026-09-29) — ONE OBJECT PER DISTINCT SUBTREE, ACROSS THE PASS.
 *
 *  `interpret`'s cross-column memo (`crossMemo`) is keyed on the node OBJECT,
 *  and the object lane's trees are separate objects even where they are the
 *  same subtree — each op's tree is resolved on its own, and the V2 form's
 *  `nodeTree` builds a fresh tree per node. ⚰️ MEASURED on
 *  `rsi-swing-indicator`: fifteen trees each re-ran the same two `var`
 *  accumulators, three times over with the warm-up probes. Interning by the
 *  canonical shape (`type`, `name`, `value`, `args` — every key a canonical
 *  node has, `parse.js::CANONICAL_KEYS`, and the exact identity
 *  `interpret.js::structuralMaps` memoises on) makes the memo see them as one.
 *  Pure: a node is copied only when an argument was replaced, never mutated.
 *  ⛔ Its lifetime is ONE pass, like the memo it feeds. */
export function makeInterner() {
  const byKey = new Map()
  const idOf = new Map()
  const canonOf = new Map()
  const litKey = (v) => `l${JSON.stringify(v === undefined ? null : v)}`
  return (root) => {
    if (!root || typeof root !== 'object') return root
    const stack = [[root, false]]
    while (stack.length) {
      const [n, expanded] = stack.pop()
      if (canonOf.has(n)) continue
      const args = Array.isArray(n.args) ? n.args : null
      if (!expanded) {
        stack.push([n, true])
        if (args) for (const a of args) if (a && typeof a === 'object' && !canonOf.has(a)) stack.push([a, false])
        continue
      }
      let changed = false
      const parts = []
      const next = args ? args.map((a) => {
        if (!a || typeof a !== 'object') { parts.push(litKey(a)); return a }
        const c = canonOf.get(a)
        parts.push(`n${idOf.get(c)}`)
        if (c !== a) changed = true
        return c
      }) : null
      const key = `${n.type}\u0001${JSON.stringify(n.name ?? null)}\u0001${JSON.stringify(n.value ?? null)}\u0001${args ? parts.join(',') : '-'}`
      let c = byKey.get(key)
      if (!c) {
        c = changed ? { ...n, args: next } : n
        byKey.set(key, c)
        idOf.set(c, idOf.size)
      }
      canonOf.set(n, c)
    }
    return canonOf.get(root)
  }
}

export function readsBoundedState(tree) {
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'call' && Object.prototype.hasOwnProperty.call(RECURRENCES, n.name)) return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}

const sameValue = (a, b) => a === b || (a !== a && b !== b)

/** `probeValuesOf` — see `interpret.js` (C17, moved there by C12s). */

/** The bars on which `col` (the tree's real column) depends on a recurrence
 *  prefix, as a `Uint8Array`, or `null` when there are none.
 *
 *  ⭐ ONLY THE BARS BELOW THE TREE'S `maxLookback` CAN DEPEND ON A PREFIX — the
 *  tree sum counts every `W` and every window along the path — and the lane is
 *  causal (no read reaches forward), so the probes run over that many bars plus
 *  one, not the whole chart. Measured on `market-structure-by-leviathan` (632
 *  bars) the probes cost about twice the real pass; truncated, a 5,000-bar chart
 *  pays for ~250–550 bars of probing instead of 5,000. The extra bar keeps the
 *  last compared bar from being the series' newest (`barstate.*` answers there).
 *  ⚠️ `ta.barssince`-style reads declare lookback 0 (`SERIES_LOOKBACK`), so a
 *  dependence carried through one past the bound is not seen — it reads as
 *  today's behaviour, never as a new withheld object.
 *
 *  `memos` is keyed by the probed length, then by the probe value (one memo per
 *  value, `probeValuesOf`), because a memoised column is only valid for the
 *  series and the prefix it was computed over. */
export function unknownMask(tree, col, bars, inputs, budget, iopts, memos = new Map()) {
  if (!col || !readsBoundedState(tree)) return null
  let reach
  try { reach = maxLookback(tree) } catch { reach = col.length }
  // ⭐ C12s — a SWITCHED recurrence is unknown wherever its reset lies outside
  // the window, which can be any bar, so its tree is probed over the whole
  // series (the prefix bound above holds only for the warm-up curtain).
  const n = readsSwitchedState(tree)
    ? col.length
    : Math.min(col.length, Number.isFinite(reach) && reach > 0 ? reach : col.length)
  if (n <= 0) return null
  const probeBars = n < bars.length ? bars.slice(0, n + 1) : bars
  // ⭐ C19 — the real pass's columns serve a probe only over the SAME bars: a
  // truncated probe series ends earlier, and `barstate.*` answers at its end.
  const probeOpts = probeBars === bars ? iopts : { ...iopts, probeBase: undefined }
  if (!memos.has(probeBars.length)) memos.set(probeBars.length, new Map())
  const bySign = memos.get(probeBars.length)
  // ⭐ C17 — one probe per value `probeValuesOf` names, each with its own memo
  // (a column computed at one probe value must never answer for another).
  const switched = readsSwitchedState(tree)
  // ⭐⭐ C12s — a switched tree's unknown bars are READ OFF THE TREE, not only
  // probed: one probe value cannot stand for two unknown recurrences that Pine
  // holds at different values, nor for a value inside a range test
  // (`interpret.js::switchedDependencyMask`). A mask that cannot be computed
  // withholds the whole series — the safe direction.
  let dep = null
  if (switched) {
    if (!memos.has('c12s-dep')) memos.set('c12s-dep', new Map())
    try {
      dep = switchedDependencyMask(tree, bars, inputs, budget, undefined, { ...iopts, crossMemo: memos.get('c12s-dep') })
    } catch {
      dep = new Uint8Array(col.length).fill(1)
    }
  }
  const probed = []
  try {
    for (const p of probeValuesOf(tree)) {
      if (!bySign.has(p)) bySign.set(p, new Map())
      probed.push(interpret(tree, probeBars, inputs, budget, undefined, { ...probeOpts, crossMemo: bySign.get(p), prefixProbe: p }))
    }
  } catch (err) {
    // ⛔ C19 — A PROBE THE NODE BUDGET REFUSES PROVES NOTHING, so nothing is
    // published on its word. The real run was charged against the pass's memo
    // (`interpret.js::evaluationUnits`) and a probe against its own, so a tree
    // the pass admitted can be refused here; the safe direction is every bar
    // withheld, never the `null` below (which publishes every bar).
    if (err && err.guard === 'budget:nodes') return new Uint8Array(col.length).fill(1)
    if (!dep) return null
    probed.length = 0
  }
  let mask = null
  for (let i = 0; i < col.length; i++) {
    if ((dep && dep[i]) || (i < n && probed.some((pc) => !sameValue(col[i], pc[i])))) {
      if (!mask) mask = new Uint8Array(col.length)
      mask[i] = 1
    }
  }
  return mask
}

/**
 * @param {object} graph    a V2 graph
 * @param {object} program  a BOUND object program
 * @param {Array}  bars     the series to evaluate over
 * @param {object} [opts]   `{ inputs, budget, tf }` — the SAME three the plot
 *        lane hands `interpret`. See the header for what passing none cost.
 * @returns {{ readNode: (node:number, bar:number)=>number, columns: Map, failed: number[] }}
 */
export function computeObjectColumns(graph, program, bars, opts = {}) {
  const columns = new Map()
  const failed = []
  const refusals = []
  const wanted = graphNodesReferenced(program)
  const fold = opts.fold || ((t) => t)
  // ⭐⭐ ONE MEMO FOR THE WHOLE PASS — the same arrangement `computeFor` has had
  // since C2C.11, and the object lane never got it.
  //
  // ⚠️ AND WITHOUT IT R-Q WOULD HAVE TRADED A BLANK DASHBOARD FOR A SLOW ONE.
  // `nodeTree` EXPANDS the shared graph per referenced node, so a subtree two
  // cells have in common is walked twice — and `uncharted-volume-v2.pine` has 27
  // referenced nodes over one accumulator. While the step ceiling refused, that
  // cost nothing because nothing ran; raising the ceiling is what makes it the
  // member's wait. Measured on SPY 1D (8,000 bars) in `memberPaneTables`.
  //
  // ⛔ ITS LIFETIME IS THIS CALL. The columns it holds were computed against
  // THESE bars, THESE inputs and THIS fold; a memo that outlived the pass would
  // serve stale numbers with nothing red anywhere.
  const crossMemo = new Map()
  const unknown = new Map()
  // ⭐ ONE MEMO PER PROBE SIGN (and probed length) for the whole pass, beside `crossMemo` — a probe
  // value must never be served to the real column, nor one sign to the other.
  const probeMemos = new Map()
  // ⭐ C12r — one object per distinct subtree for the whole pass (`makeInterner`).
  const intern = makeInterner()
  for (const node of wanted) {
    try {
      const tree = intern(fold(nodeTree(graph, node)))
      const iopts = { tf: opts.tf, newestBarIsForming: opts.newestBarIsForming ?? null,
        ...(opts.historyFromListing === true ? { historyFromListing: true } : {}) }
      const col = interpret(tree, bars, opts.inputs || {}, opts.budget, undefined, { ...iopts, crossMemo, switchedAgreement: false })
      columns.set(node, col)
      // ⭐ C19 — a probe reads the columns no probe value can move from THIS
      // pass's memo (`interpret.js::passView`) instead of recomputing them.
      const mask = unknownMask(tree, col, bars, opts.inputs || {}, opts.budget, { ...iopts, probeBase: crossMemo }, probeMemos)
      if (mask) unknown.set(node, mask)
    } catch (err) {
      failed.push(node)
      // ⛔⛔ R-Q — WHY, NOT JUST WHICH. `failed` is a list of node indices, and a
      // node index cannot tell a member that their dashboard is blank because
      // the engine declined to spend the steps. Every refusal is kept with its
      // guard, its sentence and the node it came from, so a `NaN` on the pane
      // has a reason attached instead of being indistinguishable from the
      // script's own `na`.
      refusals.push({
        node,
        guard: (err && err.guard) || 'error',
        message: String((err && err.message) || err),
      })
    }
  }
  const readNode = (node, bar) => {
    const col = columns.get(node)
    if (!col) return NaN
    const v = col[bar]
    return v === undefined ? NaN : v
  }
  const readUnknown = (node, bar) => { const m = unknown.get(node); return !!m && m[bar] === 1 }
  return { readNode, readUnknown, unknown, columns, failed, refusals, wanted }
}

/**
 * ⭐⭐ ONE READER FOR BOTH DOCUMENT FORMS.
 *
 * ⚰️⚰️ THIS FUNCTION EXISTS BECAUSE THE FIRST LIVE RUN DREW NOTHING. Seven
 * fixtures completed the whole journey — import, apply, save, reopen, chips,
 * `FULL_JOURNEY_PASS` seven times — and every object layer reported **zero
 * pixels** and a canvas still at its default 300×150, meaning `draw()` had never
 * run. The cause: a small script never exceeds the 64 KB budget, so its saved
 * document stays **V1** (`compute.ast`, no graph) and its object program stays
 * **UNBOUND** — which is correct and necessary, because in a V1 document the
 * program's own `trees` are the only place those expressions live. The binder
 * read only the BOUND form, found no graph, and quietly set a null state.
 *
 * ⛔ EVERY LAYER ABOVE WAS GREEN. The model, the runtime, the render state, the
 * painter, the layer, the save path and the document validator each had passing
 * rails, and the one thing none of them could see was that the two halves were
 * connected for one document shape and not the other. That is
 * `lesson_built_tested_green_and_unreachable` reached by a door nobody had
 * walked, and only a PIXEL read could say so — a canvas count, a layer count and
 * our own drawn-counter were all consistent with a working renderer.
 *
 *   V1 (`compute.ast` / `compute.trees`)  program is UNBOUND; its `trees` ARE
 *                                         the node table, so binding is identity
 *   V2 (`compute.graph`)                  program is BOUND to the shared graph
 *
 * @param {object} [opts] `{ inputs, tf, newestBarIsForming }` — the INSTANCE's
 *        inputs (merged here over the definition's declared defaults by the plot
 *        lane's own `resolveInputs`), the chart's timeframe, and whether the
 *        newest bar is still forming. The document's budget is read off the
 *        definition, never passed in.
 *
 *        ⚰️⚰️ `newestBarIsForming` IS THE FOURTH ARGUMENT THIS LANE WAS DEAF TO,
 *        after `inputs`, `budget` and `tf` (see this file's header). `interpret`
 *        seeds the four BARSTATE realtime columns from it and leaves them `NaN`
 *        when it is absent — fail-closed, correctly — so `barstate.isconfirmed`
 *        read `na` in EVERY object tree while the plot beside it read 1.
 *        MEASURED against TradingView 2026-09-28: `liquidity-pools` guards its
 *        swings with `barstate.isconfirmed ? ta.pivothigh(…) : na`; the vendor
 *        draws 182 lines and 91 labels and every one of our guards was
 *        truthy on 0 of 632 bars. `?? null` keeps UNKNOWN unknown, exactly as
 *        `computeFor` does.
 * @returns {{program, readNode, readTime, failed, form}} or null when there is
 *        nothing to read. `readTime` is the runtime's reader for a bare `time`.
 */
export function objectReaderFor(definition, bars, opts = {}) {
  const stored = definition && definition.objects
  if (!stored || !Array.isArray(stored.ops) || !stored.ops.length) return null
  // ⭐ ONE RESOLUTION FOR BOTH FORMS, and it is the PLOT lane's function — an
  // object's coordinate and the plot beside it now read the same knob.
  const inputs = resolveInputs(definition, opts.inputs)
  // ⭐⭐ R2 STEP 6 — THE BIND-TIME FOLD REACHES THE OBJECT LANE, from the same
  // assembly the PLOT lane uses.
  //
  // ⚰⚰ MEASURED 2026-09-13 ON `uncharted-volume-v2.pine`, whose product IS two
  // tables. Twenty-four of its twenty-seven object trees refused before ever
  // reaching a coordinate — eighteen with *"a value that a symbol settles
  // reached the evaluator unsettled"* (`syminfo.ticker`, never folded) and six
  // with *"a window must be a whole-number literal … got {type:'op'}"* (a length
  // behind a `timeframe.*` test, never folded). `computeFor` has folded both
  // since R-K; this module called `interpret` on the RAW tree.
  //
  // ⛔ SO THE PLOT AND THE OBJECT BESIDE IT WERE READING TWO DIFFERENT
  // DOCUMENTS — the exact asymmetry this file's own header records for `inputs`,
  // one argument over. `bindConstsFor` is exported for that reason: the two
  // lanes now make one call, and a constant added to it cannot reach one lane
  // and miss the other.
  //
  // ⚠️ `symbol` COMES FROM THE CALLER AND IS NOT GUESSED. Without it
  // `symbolConstantsWith` returns `{}` and every `syminfo.*` stays NotFoldable,
  // which refuses loudly and names the field — the behaviour R-K deliberately
  // chose over half-resolving a bare string.
  const bindConsts = bindConstsFor({ tf: opts.tf, inputs, symbol: opts.symbol })
  const fold = (tree) => foldBound(tree, bindConsts)
  // ⭐⭐ C15 — A SYMBOL'S TEXT IN AN OBJECT (`table.cell(t, 3, 11, syminfo.ticker)`)
  // is settled from the SAME map, so a cell and the fold beside it cannot read two
  // different symbols. Only TEXT entries: the map also holds numbers.
  const symbolText = Object.fromEntries(Object.entries(bindConsts)
    .filter(([k, v]) => k.startsWith('syminfo.') && typeof v === 'string'))
  // ⛔ The V2 (graph) form is already bound, so binding again only settles the
  // symbol text; the V1 form is bound below, where its trees become nodes.
  const isGraphForm = !!(definition.compute && definition.compute.graph
    && Array.isArray(definition.compute.graph.nodes))
  const program = isGraphForm ? bindObjectProgram(stored, (i) => i, symbolText) : stored
  const evalOpts = {
    inputs,
    budget: definition.compute && definition.compute.budget,
    tf: opts.tf,
    newestBarIsForming: opts.newestBarIsForming ?? null,
    // ⭐ C12w — the listing exception, decided by the SAME gate the plot lane
    // asks (`historyFromListingFor`), so an object and the plot beside it can
    // never read two different answers about where the series starts.
    historyFromListing: historyFromListingFor(definition, opts),
    fold,
  }
  // ⭐⭐ A BARE `time` IN AN OBJECT PROP IS PINE'S `time` — the bar's opening
  // instant in MILLISECONDS, exactly what the same name reads inside a tree
  // (`time * 1000`, off the clock column `barOpenInstant` fills). The runtime
  // reads it through `readTime`, so it is decided HERE, beside the trees, from
  // the same bars and timeframe.
  // ⚰️ The callers passed the bar's KEY (`bars[i].t`): a date string on a daily
  // chart, unix seconds on an intraday one. So `label.new(time, …,
  // xloc.bar_time)` handed the render state a different unit from
  // `label.new(time + 1, …)`, and on a daily chart a string it dropped as `na`.
  const readTime = (i) => {
    const at = barOpenInstant(bars && bars[i] ? bars[i].t : undefined, opts.tf)
    return at === null ? NaN : at * 1000
  }
  const graph = definition.compute && definition.compute.graph
  if (graph && Array.isArray(graph.nodes)) {
    const { readNode, readUnknown, failed, refusals } = computeObjectColumns(graph, program, bars, evalOpts)
    return { program, readNode, readUnknown, readTime, failed, refusals, form: 'graph' }
  }
  const trees = Array.isArray(program.trees) ? program.trees : null
  if (!trees) return null
  // ⭐⭐ C18 — the placeholders' columns, from ONE runtime run (or withheld).
  let runtime = null
  if (program.runtime) {
    runtime = runtimeObjectValuesFn
      ? runtimeObjectValuesFn(program.runtime, bars, {
        tf: evalOpts.tf,
        newestBarIsForming: evalOpts.newestBarIsForming,
        fromListing: evalOpts.historyFromListing === true,
        atDefaults: inputsAtDefaults(definition, opts.inputs),
      })
      : { cols: [], unknown: [], served: false, reason: 'runtime:not-loaded' }
  }
  const barCount = Array.isArray(bars) ? bars.length : 0
  // ⭐ IDENTITY BINDING. The program's own `trees` array IS the node table, so
  // tree index i becomes node index i and the runtime's single `{v:'graph'}`
  // vocabulary serves both forms without a second evaluator.
  const bound = bindObjectProgram(program, (i) => i, symbolText)
  const columns = new Map()
  const failed = []
  const refusals = []
  // ⭐ THE SAME ONE-MEMO-PER-PASS ON THE V1 FORM, for the same reason.
  const crossMemo = new Map()
  const unknown = new Map()
  const probeMemos = new Map()
  const intern = makeInterner()
  for (const i of graphNodesReferenced(bound)) {
    // ⭐ C18 — a runtime placeholder is read off the run, never interpreted.
    const rk = runtimeAtIndex(trees[i])
    if (rk >= 0) {
      const col = runtime && runtime.cols[rk]
      if (col) {
        columns.set(i, col)
        if (runtime.unknown[rk]) unknown.set(i, runtime.unknown[rk])
      } else {
        columns.set(i, new Float64Array(barCount).fill(NaN))
        unknown.set(i, new Uint8Array(barCount).fill(1))
      }
      continue
    }
    try {
      const tree = intern(fold(trees[i]))
      const iopts = { tf: evalOpts.tf, newestBarIsForming: evalOpts.newestBarIsForming,
        ...(evalOpts.historyFromListing === true ? { historyFromListing: true } : {}) }
      const col = interpret(tree, bars, evalOpts.inputs, evalOpts.budget, undefined, { ...iopts, crossMemo, switchedAgreement: false })
      columns.set(i, col)
      const mask = unknownMask(tree, col, bars, evalOpts.inputs, evalOpts.budget, { ...iopts, probeBase: crossMemo }, probeMemos)
      if (mask) unknown.set(i, mask)
    } catch (err) {
      failed.push(i)
      // ⛔ THE SAME RECORD ON THE V1 FORM. A document under the budget stays V1,
      // and a member on a V1 document is owed the same reason as one on a V2.
      refusals.push({
        node: i,
        guard: (err && err.guard) || 'error',
        message: String((err && err.message) || err),
      })
    }
  }
  const readNode = (node, bar) => {
    const col = columns.get(node)
    if (!col) return NaN
    const v = col[bar]
    return v === undefined ? NaN : v
  }
  const readUnknown = (node, bar) => { const m = unknown.get(node); return !!m && m[bar] === 1 }
  return {
    program: bound, readNode, readUnknown, readTime, failed, refusals, form: 'trees',
    // ⭐ C18 — whether the runtime values were served, and if not, why (named).
    ...(runtime ? { runtime: { served: runtime.served, reason: runtime.reason } } : {}),
  }
}
