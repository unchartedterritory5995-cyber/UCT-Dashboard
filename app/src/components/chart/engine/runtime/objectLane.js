// app/src/components/chart/engine/runtime/objectLane.js
//
// ─── ⭐⭐ THE LANE SEAM — THE RUNTIME LANE COMPUTES, THE OBJECT PROGRAM DRAWS ──
//
// Two translations of one script have existed side by side for weeks and could
// not talk to each other:
//
//   the HOST/columnar lane  answers "what is the number on this bar", and the
//                           OBJECT PASS over the same source answers "what does
//                           this script DRAW" — but its value references are
//                           pure graph reads, so a table cell can only ever hold
//                           a per-bar number.
//   the RUNTIME lane        has arrays, loops and imperative state, and can
//                           therefore compute a watchlist — but it draws nothing.
//
// ⛔⛔ THE ACCEPTANCE DASHBOARD NEEDS BOTH, AND THAT IS NOT A PREFERENCE. Its
// rows come from `array<string>`/`array<float>` filled inside `for i = 0 to
// slots - 1` and then SORTED with a bubble sort. `OBJECT_FAMILIES` holds only
// objects and the V2 graph is pure, so the object pass can never compute that;
// the runtime lane can, and has no idea what a table is. Whichever lane you pick
// alone, the dashboard is unreachable.
//
// ⭐⭐ AND THE SEAM NEEDED NO NEW MACHINERY, WHICH IS THE POINT. The object
// program's unbound value reference is `{v:'tree', tree:i}` into its own `trees`
// array, and `bindObjectProgram(program, nodeOf)` is the ONE conversion that
// resolves them — it does not care what `nodeOf` answers with, because the
// reader on the other side is `ctx.readNode(node, bar)`, a CALLBACK. So a table
// driven by this lane is nothing more than:
//
//     nodeOf   = (treeIndex) => treeIndex          // the id IS the tree index
//     readNode = (treeIndex, bar) => outputs[outputOf[treeIndex]][bar]
//
// The runtime front end lowers each tree as an extra OUTPUT (`opts.objectTrees`)
// and hands back `objectTreeOutputs`, the tree-index → output-index map. That
// map is the whole adapter.
//
// ⛔ THIS MODULE WIRES NOTHING TO A MEMBER. It is a lane, not a door: ruling D2
// keeps the member pane on the HOST lane's saved definition, and nothing here
// changes that. Anything that wants to SHOW this must be a separate, flagged
// decision.
import { translatePine } from '../ast/pine.js'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
// ⛔ REQUIRED BY `pineRuntimeFrontendGate.test.js`, AND NOT AS A FORMALITY: the
// four CLOCK_REALTIME columns fail CLOSED when nobody says whether the newest
// bar has finished, and a blank column is neither a crash nor a wrong number, so
// no other test would go red. `runtimeClockOptsFrom` fills BOTH
// `newestBarIsForming` and `interpretOpts.newestBarIsForming` — the pair the
// gate and the columns read separately. See docs/pine/barstate.md.
import { runtimeClockOptsFrom } from '../ast/pineRuntimeClock.js'
import { bindObjectProgram } from '../ast/objectProgram.js'
import { evaluateObjects } from '../objectRuntime.js'
import { lowerIrProgram } from './lowerIr.js'
import { execute } from './vm.js'

/** A refusal in the shape both lanes already use, tagged with WHICH lane said
 *  no. ⛔ The tag is load-bearing for anyone reading a failure: "the object pass
 *  found nothing to draw" and "the runtime lane cannot compile this script" are
 *  different problems with different fixes, and a bare message conflates them. */
const refuse = (lane, refusal) => ({ ok: false, lane, refusal })

/**
 * Compile one Pine source into a DRAWING (a bound object program) plus the
 * RUNTIME PROGRAM that feeds it.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {object[]} [opts.bars]     the bars payload, for the clock tri-state
 * @param {object} [opts.inputs]     author-input overrides
 * @returns {{ok:true, objects:object, program:object, treeOutputs:number[]}
 *          |{ok:false, lane:string, refusal:object}}
 */
export function buildObjectLane(source, opts = {}) {
  // ⭐ `strict: true` puts the object pass in HOST mode. The screener mode
  // answers a different question (is this row a match) and would report a
  // different verdict for the same script — see `runObjectPass` in pine.js.
  //
  // ⭐⭐ `objectRawTrees` IS THE HALF THAT MAKES THIS LANE POSSIBLE, and it is
  // set here and nowhere else. Without it the object pass canonicalises every
  // tree through the columnar value model, which has no answer for `array.get`
  // — so the tree is never built and the CELL IS DROPPED (`cell:text`), which
  // is why a dashboard whose rows come from arrays arrives with a header and
  // nothing under it. With it, a tree is the raw parse node and the runtime
  // lane lowers it. See `buildObjectProgram` in pine.js for the full note.
  const t = translatePine(source, {
    ...opts, strict: true, objects: true, objectRawTrees: true,
  })
  const objects = t.objects
  if (!objects || !Array.isArray(objects.ops) || objects.ops.length === 0) {
    return refuse('objects', t.refusal
      || { guard: 'objects:nothing-drawn', message: 'the script draws nothing' })
  }

  const trees = objects.trees || []
  const built = buildRuntimeIr(source, {
    ...runtimeClockOptsFrom(opts.bars || null),
    ...opts,
    objectTrees: trees,
  })
  if (!built.ok) return refuse('runtime', built.refusal)

  const program = lowerIrProgram(built.ir)
  const treeOutputs = program.objectTreeOutputs || []

  // ⛔⛔ A MISSING OUTPUT MUST REFUSE HERE, NOT ANSWER `na` LATER. If a tree
  // never became an output, `readNode` has nothing to read and every cell that
  // referenced it renders BLANK — and a member reads a blank cell as "no data
  // for this symbol" and TRUSTS it. That is a wrong answer presented as a fact,
  // which is the one trade this pipeline refuses to make for coverage. The same
  // reasoning is why `array.get` out of range throws rather than answering `na`.
  if (treeOutputs.length !== trees.length) {
    return refuse('runtime', {
      guard: 'runtime:object-tree-outputs',
      message: `the drawing reads ${trees.length} expression(s) and the program `
        + `carries ${treeOutputs.length} — every cell reading a missing one would `
        + 'render blank, which is indistinguishable from "no data"',
    })
  }

  // ⭐ THE CONVERSION, AND IT IS AN IDENTITY ON PURPOSE. `nodeOf` maps a tree
  // index to whatever the reader understands as a node id; in this lane the
  // reader is `readObjectLaneNode` below, which understands tree indices. Naming
  // the mapping here rather than inlining it keeps ONE authority over what a
  // node id means on this side of the seam.
  return { ok: true, objects: bindObjectProgram(objects, (i) => i), program, treeOutputs }
}

/**
 * Run a built lane over a bar series and return the drawing.
 *
 * @param {object} lane            the `buildObjectLane` result
 * @param {object} view
 * @param {number} view.bars       bar count
 * @param {Float64Array[]} view.series  one per `lane.program.columns` entry
 * @param {boolean} [view.confirmed]
 * @param {(i:number)=>number} [view.readTime]
 * @param {(id:string)=>*} [view.readParam]
 * @param {object} [view.limits]
 */
export function runObjectLane(lane, view) {
  const bars = Math.max(0, view.bars | 0)
  const { outputs } = execute(lane.program, {
    bars,
    series: view.series,
    columns: lane.program.columns,
    confirmed: view.confirmed !== false,
  }, view.limits)

  return evaluateObjects(lane.objects, {
    barCount: bars,
    readNode: readObjectLaneNode(lane, outputs),
    readTime: view.readTime,
    readParam: view.readParam,
    limits: view.limits,
    trace: view.trace,
  })
}

/** tree index → its value on a bar, through the output the front end assigned.
 *
 *  ⛔ AN UNKNOWN INDEX ANSWERS `NaN`, NEVER `0`. Zero is a coordinate, a row
 *  number and a colour; NaN is the only value the object runtime's own finiteness
 *  guards already treat as "do not draw this". `buildObjectLane` refuses the case
 *  where this could happen in bulk — this is the per-read floor under that. */
export function readObjectLaneNode(lane, outputs) {
  const map = lane.treeOutputs
  return (treeIndex, bar) => {
    const out = map[treeIndex]
    if (out === undefined) return NaN
    const series = outputs[out]
    if (!series || bar < 0 || bar >= series.length) return NaN
    return series[bar]
  }
}
