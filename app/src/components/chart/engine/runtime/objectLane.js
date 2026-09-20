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
import { runtimeClockOpts, newestBarIsFormingFrom } from '../ast/pineRuntimeClock.js'
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
    ...opts, strict: true, objects: true, objectRawTrees: true, objectIterTrees: true,
  })
  const objects = t.objects
  if (!objects || !Array.isArray(objects.ops) || objects.ops.length === 0) {
    return refuse('objects', t.refusal
      || { guard: 'objects:nothing-drawn', message: 'the script draws nothing' })
  }

  const trees = objects.trees || []

  // ⭐⭐ THE PER-ROW TREES, AND THE BOUNDS THEY MUST BE EVALUATED OVER.
  //
  // A tree the object pass marked `iterated` is read once per ITERATION, so the
  // runtime lane has to evaluate it inside a loop with the same bounds the
  // drawing uses. Those bounds live on the `loop` op that encloses it, which is
  // the only place that knows them — so the ops are walked to pair each counter
  // with its range.
  //
  // ⛔⛔ AND A LOOP THAT IS NOT LAST-BAR GUARDED IS REFUSED, BY NAME. The
  // iteration buffer is overwritten every bar (`iterOutputs.test.js` asserts
  // exactly that), so only the bar that wrote it last can be read back. For a
  // `barstate.islast` drawing — which is how every dashboard in the corpus is
  // written — that bar IS the one being drawn. For anything else the buffer
  // holds another bar's rows, and handing those back would be a table of real
  // numbers from the wrong moment: the most convincing kind of wrong.
  const iterated = objects.iteratedTrees || {}
  const boundsByCounter = new Map()
  let unguardedLoop = null
  const walkLoops = (list) => {
    for (const op of list || []) {
      if (op.k !== 'loop') continue
      if (!op.lastBarOnly) unguardedLoop = op.id
      boundsByCounter.set(op.id, op)
      walkLoops(op.body)
    }
  }
  walkLoops(objects.ops)

  const iterSpecs = []
  const iterTreeIndex = new Map()
  for (const [key, counter] of Object.entries(iterated)) {
    const i = Number(key)
    const loop = boundsByCounter.get(counter)
    if (!loop) {
      return refuse('objects', {
        guard: 'objects:iterated-tree-unbounded',
        message: `a per-row value names counter \`${counter}\`, which no loop in `
          + 'this drawing declares — its range is unknown and cannot be guessed',
      })
    }
    iterTreeIndex.set(i, iterSpecs.length)
    iterSpecs.push({ node: trees[i], counter, from: loop.fromNode, to: loop.toNode })
  }

  if (iterSpecs.length && unguardedLoop !== null) {
    return refuse('objects', {
      guard: 'objects:iterated-tree-not-last-bar',
      message: `the loop on counter \`${unguardedLoop}\` draws per-row values but is `
        + 'not guarded to the last bar — the per-iteration buffer holds only the '
        + 'bar that wrote it last, so those rows would come from another moment',
    })
  }

  // ⭐⭐ THE CLOCK TRI-STATE, ASKED OF THE CALLER FIRST AND THE BARS SECOND.
  //
  // ⚰️ THIS READ `opts.bars` ALONE AND NOTHING ELSE, and a bars ARRAY never
  // carries the field — so `newestBarIsFormingFrom` answered `null` ("nobody
  // told me") for every caller, and every script mentioning `barstate.*` refused
  // at `runtime:realtime-untold`. Measured on the committed corpus: **23 of 78
  // drawing scripts**, which made it the single largest blocker in a census —
  // and it was a property of THIS FUNCTION, not of the corpus. That is exactly
  // the contamination `docs/pine/RVOL-SLICE-RESUME.md` warns a census against,
  // arriving through the adapter instead of the harness.
  //
  // ⚠️ THE SPREAD ORDER IS DEFENSIVE, NOT PROVED — SAID PLAINLY BECAUSE IT WAS
  // CLAIMED AS PROVED FIRST. The fragment goes in AFTER `...opts` so a caller
  // passing a partial `interpretOpts` cannot replace the one the producer just
  // built; the fragment is derived FROM opts, so it can only ever add
  // information. But a mutation swapping the order stayed GREEN against every
  // case here, including one asserting the rendered VALUE: on THIS path
  // `interpretOpts` reaches `interpret` only, and the realtime blanking that
  // would expose a lost nested flag lives in the columns layer, which an
  // objects-only script never reaches. So the ordering is kept because it is
  // correct and free, and is NOT recorded as a guard.
  const told = newestBarIsFormingFrom(opts)
  const clock = runtimeClockOpts(
    told !== null ? told : newestBarIsFormingFrom(opts.bars || null),
    opts.interpretOpts || {},
  )
  const built = buildRuntimeIr(source, {
    ...opts,
    ...clock,
    // ⭐ A PER-ROW TREE IS PASSED AS `null` HERE and supplied through
    // `objectIterTrees` instead — same list, same indices, different channel.
    objectTrees: trees.map((node, i) => (iterTreeIndex.has(i) ? null : node)),
    objectIterTrees: iterSpecs,
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
  return {
    ok: true,
    objects: bindObjectProgram(objects, (i) => i),
    program,
    treeOutputs,
    // tree index → { buffer, counter } for the per-row values.
    iterByTree: new Map([...iterTreeIndex].map(([i, b]) => (
      [i, { buffer: b, counter: iterSpecs[b].counter }]))),
  }
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
  const { outputs, iters } = execute(lane.program, {
    bars,
    series: view.series,
    columns: lane.program.columns,
    confirmed: view.confirmed !== false,
  }, view.limits)

  return evaluateObjects(lane.objects, {
    barCount: bars,
    readNode: readObjectLaneNode(lane, outputs, iters),
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
export function readObjectLaneNode(lane, outputs, iters = []) {
  const map = lane.treeOutputs
  const byTree = lane.iterByTree || new Map()
  return (treeIndex, bar, loopVars) => {
    // ⭐⭐ A PER-ROW TREE IS READ FROM ITS ITERATION BUFFER, BY COUNTER.
    // ⛔ An unbound counter answers `undefined`, never slot 0: reading row
    // zero for every pass is the forty-identical-rows failure this channel
    // exists to prevent, and it looks exactly like data.
    const it = byTree.get(treeIndex)
    if (it) {
      const k = loopVars && loopVars.get ? loopVars.get(it.counter) : undefined
      if (!Number.isInteger(k)) return undefined
      const buf = iters[it.buffer]
      return buf ? buf[k] : undefined
    }
    const out = map[treeIndex]
    if (out === undefined) return NaN
    const series = outputs[out]
    if (!series || bar < 0 || bar >= series.length) return NaN
    return series[bar]
  }
}
