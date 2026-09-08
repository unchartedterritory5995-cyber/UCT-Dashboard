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
import { graphNodesReferenced, bindObjectProgram } from './ast/objectProgram'
import { interpret } from './ast/interpret'
import { resolveInputs } from './nativeRegistry'

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
  const wanted = graphNodesReferenced(program)
  for (const node of wanted) {
    try {
      const tree = nodeTree(graph, node)
      const col = interpret(tree, bars, opts.inputs || {}, opts.budget,
        undefined, { tf: opts.tf })
      columns.set(node, col)
    } catch {
      failed.push(node)
    }
  }
  const readNode = (node, bar) => {
    const col = columns.get(node)
    if (!col) return NaN
    const v = col[bar]
    return v === undefined ? NaN : v
  }
  return { readNode, columns, failed, wanted }
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
 * @param {object} [opts] `{ inputs, tf }` — the INSTANCE's inputs (merged here
 *        over the definition's declared defaults by the plot lane's own
 *        `resolveInputs`) and the chart's timeframe. The document's budget is
 *        read off the definition, never passed in.
 * @returns {{program, readNode, failed, form}} or null when there is nothing to read
 */
export function objectReaderFor(definition, bars, opts = {}) {
  const program = definition && definition.objects
  if (!program || !Array.isArray(program.ops) || !program.ops.length) return null
  // ⭐ ONE RESOLUTION FOR BOTH FORMS, and it is the PLOT lane's function — an
  // object's coordinate and the plot beside it now read the same knob.
  const inputs = resolveInputs(definition, opts.inputs)
  const evalOpts = {
    inputs,
    budget: definition.compute && definition.compute.budget,
    tf: opts.tf,
  }
  const graph = definition.compute && definition.compute.graph
  if (graph && Array.isArray(graph.nodes)) {
    const { readNode, failed } = computeObjectColumns(graph, program, bars, evalOpts)
    return { program, readNode, failed, form: 'graph' }
  }
  const trees = Array.isArray(program.trees) ? program.trees : null
  if (!trees) return null
  // ⭐ IDENTITY BINDING. The program's own `trees` array IS the node table, so
  // tree index i becomes node index i and the runtime's single `{v:'graph'}`
  // vocabulary serves both forms without a second evaluator.
  const bound = bindObjectProgram(program, (i) => i)
  const columns = new Map()
  const failed = []
  for (const i of graphNodesReferenced(bound)) {
    try {
      columns.set(i, interpret(trees[i], bars, evalOpts.inputs, evalOpts.budget,
        undefined, { tf: evalOpts.tf }))
    } catch { failed.push(i) }
  }
  const readNode = (node, bar) => {
    const col = columns.get(node)
    if (!col) return NaN
    const v = col[bar]
    return v === undefined ? NaN : v
  }
  return { program: bound, readNode, failed, form: 'trees' }
}
