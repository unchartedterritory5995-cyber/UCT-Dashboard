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
import { bindObjectProgram, treeRefsOfOp } from '../ast/objectProgram.js'
import { beginObjects } from '../objectRuntime.js'
import { lowerIrProgram } from './lowerIr.js'
import { execute } from './vm.js'

/** A refusal in the shape both lanes already use, tagged with WHICH lane said
 *  no. ⛔ The tag is load-bearing for anyone reading a failure: "the object pass
 *  found nothing to draw" and "the runtime lane cannot compile this script" are
 *  different problems with different fixes, and a bare message conflates them. */
const refuse = (lane, refusal) => ({ ok: false, lane, refusal })

/**
 * ⭐⭐ "NOTHING TO DRAW" IS TWO DIFFERENT ANSWERS, AND ONLY ONE IS A GAP.
 *
 * The object pass returns no program in two unrelated situations, and this
 * module's own header argues that conflating problems with different fixes is
 * how a work queue ends up pointing at the wrong half of a pipeline. The same
 * argument applies one level down:
 *
 *   `objects:no-objects-in-source` — the source creates no `label`, `line`,
 *       `box`, `table` or `linefill` at all. It draws with `plot`/`plotshape`/
 *       `fill`/`hline`, which this lane does not carry and by construction
 *       never will. ⛔ THIS IS A TERMINAL, CORRECT ANSWER, NOT A BLOCKER — no
 *       capability added to the object pass can ever move such a script, and
 *       counting it beside the real refusals overstates what this lane has left
 *       to do.
 *
 *   `objects:object-ops-all-dropped` — the pass DID collect object operations
 *       and none survived. That IS a gap, and `dropReasons` already names which
 *       gate refused them, so the refusal can say so instead of making the next
 *       reader go and instrument it.
 *
 * ⚰️ MEASURED before this split was written: all 13 scripts then on the
 * `objects:nothing-drawn` row reported `droppedOps: 0` with an empty
 * `dropReasons`, and a comment-stripped scan of their sources found ZERO
 * object-family constructors against 2–31 plot calls each. The whole row was
 * the first kind. It read as 13 scripts one capability away from drawing.
 */
function nothingDrawn(diagnostics) {
  const d = diagnostics || {}
  // ⛔ THE SIGNAL IS `collectedOps`, NEVER `droppedOps`. An `update` with no
  // `create` anywhere is KEPT and then refused for creating nothing, so the
  // drop ledger is empty in both cases. Keying the split on drops classified
  // `line.set_width(l, 2)` beside a `plot` as "creates no line" — a sentence
  // contradicted by the line above it in the source.
  if (d.collectedOps) {
    const reasons = d.dropReasons || {}
    const names = Object.keys(reasons).sort()
    const why = names.length
      ? `— ${names.map((k) => `${k} (${reasons[k]})`).join(', ')}`
      : '— none of them creates an object, so there is nothing to draw on'
    return {
      guard: 'objects:object-ops-all-dropped',
      message: `this script writes ${d.collectedOps} object operation(s) and none `
        + `survived to the drawing ${why}`,
    }
  }
  return {
    guard: 'objects:no-objects-in-source',
    message: 'this script creates no line, label, box, table or linefill — it '
      + 'draws with plots, which the object lane does not carry',
  }
}

/**
 * ⭐⭐ THE PER-ROW TREES, RESOLVED ONCE — THE GUARD AND THE COSTING READ THE SAME WALK.
 *
 * Extracted from `buildObjectLane` unchanged so that the instrument which
 * measures what per-bar iteration storage would COST cannot drift from the
 * guard that decides whether it is needed. A second walk over the same ops
 * would be a second authority over one value, and the value in question is
 * "is this drawing reading rows from the wrong moment".
 *
 * ⛔ IT REFUSES NOTHING. It REPORTS `unbounded` and `offender`; the caller
 * turns those into refusals, in the order it always did.
 *
 * @returns {{iterSpecs:object[], iterTreeIndex:Map<number,number>,
 *            orphanTrees:Set<number>, offender:object|null,
 *            unbounded:object|null, iterated:object}}
 */
export function resolveIterTrees(objects, trees) {
  const iterated = objects.iteratedTrees || {}
  const iterSet = new Set(Object.keys(iterated).map(Number))

  // tree index → the loop enclosing the op that READS it.
  //
  // ⭐ ONE TREE HAS EXACTLY ONE READER, and that is a property of raw-tree mode
  // rather than an assumption: `internTree` dedupes by `printFormula`, which
  // throws on a raw parse node, so every occurrence interns its own index.
  // Measured over the committed corpus — 218 iterated trees across 153
  // scripts, ZERO read by more than one op. `iteratedTreeReaders.test.js`
  // holds that invariant, so if dedupe is ever switched on here the rail names
  // it instead of this quietly keeping whichever loop was walked last.
  // ⛔ A refusal for the two-reader case was written first and then REMOVED: no
  // fixture could make it fire, and a guard that cannot fire reads as
  // protection without being any.
  const readBy = new Map()
  let offender = null
  let unbounded = null
  const walkReads = (list, reachedIn, loop) => {
    for (const op of list || []) {
      if (!op || typeof op !== 'object') continue
      // ⭐ `objectRuntime` skips a `lastBarOnly` op unless `bar === barCount-1`,
      // and a loop's body only runs when the loop op itself runs — so a position
      // is last-bar-only if ANY op enclosing it is, or it is itself.
      const reached = reachedIn || !!op.lastBarOnly
      for (const i of treeRefsOfOp(op)) {
        if (!iterSet.has(i)) continue
        // ⭐ `lastBarOnly` IS RECORDED PER TREE, not just as the one `offender`.
        // Which buffers need a BAR DIMENSION is exactly this set, and a single
        // first-offender field cannot answer "how many" — which is the number
        // the storage decision turns on.
        if (!readBy.has(i)) readBy.set(i, { loop, lastBarOnly: reached })
        // ⛔ SAFETY IS DECIDED HERE, NOT FROM `readBy` — so a second reader (if
        // dedupe is ever enabled) can change which BOUNDS are chosen but can
        // never turn an every-bar read into a compile.
        if (!reached && !offender) offender = { k: op.k, counter: loop && loop.id }
      }
      if (op.k === 'loop') walkReads(op.body, reached, op)
    }
  }
  walkReads(objects.ops, false, null)

  const iterSpecs = []
  const iterTreeIndex = new Map()
  const orphanTrees = new Set()
  for (const i of [...iterSet].sort((a, b) => a - b)) {
    const read = readBy.get(i)
    // ⭐⭐ AN ORPHAN IS DROPPED, NOT REFUSED ON. A tree can be marked `iterated`
    // at intern time and then lose the op that would have read it — the object
    // pass drops an op whose guard, handle or content it cannot read, and the
    // tree it already interned stays behind. Refusing the whole drawing because
    // a value NOTHING READS mentions a loop counter fails a script for a row it
    // does not draw. It keeps its output slot (passed as `null` below) so the
    // tree→output map stays index-aligned.
    if (!read) { orphanTrees.add(i); continue }
    // ⛔ REPORTED, NOT THROWN. This walk is also the costing instrument's only
    // reader (`iterStorageCost.measure.test.js`), and an instrument that cannot
    // see past the first refusal measures the guard instead of the corpus.
    if (!read.loop) { unbounded = { tree: i, counter: iterated[i] }; break }
    iterTreeIndex.set(i, iterSpecs.length)
    iterSpecs.push({
      node: trees[i],
      counter: read.loop.id,
      from: read.loop.fromNode,
      to: read.loop.toNode,
      // ⭐⭐ THE ONE BIT THE STORAGE DECISION TURNS ON. A buffer read only on
      // the last bar can stay flat — the last bar is the bar that wrote it.
      // Everything else needs the value AS OF THE BAR BEING DRAWN.
      tree: i,
      lastBarOnly: read.lastBarOnly === true,
    })
  }

  return { iterSpecs, iterTreeIndex, orphanTrees, offender, unbounded, iterated }
}

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
    return refuse('objects', t.refusal || nothingDrawn(t.objectDiagnostics))
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
  // ⭐⭐ RESOLVED BY THE LOOP THAT ENCLOSES THE *READER*, NOT BY THE COUNTER'S
  // NAME. `objects.iteratedTrees` maps a tree index to the innermost counter
  // that was open when the tree was interned — a NAME, and in this corpus that
  // name is `i` in nearly every script. Keying the bounds off it means a map
  // whose two entries collide, silently keeping whichever loop was walked last.
  //
  // ⚰️ MEASURED ON THE COMMITTED CORPUS BEFORE THIS WAS WRITTEN: of the eleven
  // scripts on the `objects:iterated-tree-not-last-bar` row, TWO
  // (`market-profile-with-tpo`, `volume-delta-oi-delta-kioseff-trading`) carry
  // two different loops both named `i`, one guarded and one not. A name-scoped
  // fix would have declared both of them safe — and the per-op walk below shows
  // the ops that actually read their per-row values run on EVERY bar, so
  // "compiles" would have meant a table of real numbers from the wrong moment.
  // The cheap fix was not merely imprecise; it was wrong in the dangerous
  // direction.
  const {
    iterSpecs, iterTreeIndex, orphanTrees, offender, unbounded, iterated,
  } = resolveIterTrees(objects, trees)
  if (unbounded) {
    return refuse('objects', {
      guard: 'objects:iterated-tree-unbounded',
      message: `a per-row value names counter \`${iterated[unbounded.tree]}\`, which no loop in `
        + 'this drawing declares — its range is unknown and cannot be guessed',
    })
  }
  // ─── ⚰️⭐⭐ `objects:iterated-tree-not-last-bar` WAS HERE, AND WHY IT IS NOT ──
  //
  // The refusal was CORRECT for the engine it was written against. The
  // iteration buffer is overwritten every bar, `vm.js` allocates `iters` once
  // for the whole run indexed by the counter alone, and the drawing ran as a
  // SECOND pass after the VM had finished every bar — so an op reading a
  // per-row value on bar 300 read whatever bar 4,999 left behind. Handing
  // those back is a table of real numbers from the wrong moment, which is the
  // most convincing kind of wrong, and refusing was the right answer.
  //
  // ⛔⛔ AND THE OBVIOUS FIX WAS MEASURED AND IS NOT BUILDABLE. Giving the
  // buffers a bar dimension costs, for ONE corpus script at the 5,000 bars a
  // chart asks for, 1,621MB in full form; 801MB counting only the buffers that
  // are read off a bar other than the last. The runtime's own MEMORY ceiling
  // is 64MB. `iterStorageCost.measure.test.js` holds those numbers.
  //
  // ⭐⭐ WHAT CHANGED IS *WHEN* THE DRAWING STANDS, NOT WHAT IS STORED. The two
  // bar walks are now ONE: `runObjectLane` drives the object program's bar from
  // inside the VM's own bar loop, so a per-row value is read on the bar that
  // wrote it, by construction rather than by a guard. That is also what Pine
  // does — a member's `for` and the `line.new` inside it are one program
  // advancing one bar at a time.
  //
  // ⛔⛔ THE INVARIANT IS ENFORCED WHERE IT CAN FAIL, NOT ASSUMED HERE.
  // `readObjectLaneNode` THROWS if a per-row value is asked for on any bar but
  // the one the VM has just finished, so wiring the two walks apart again is a
  // named crash rather than a quiet table from the wrong moment.
  // ⭐ `offender` is still computed — it is what the costing instrument counts.

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
    //
    // ⛔ AN ORPHAN GOES DOWN THE SAME `null` CHANNEL AND IS SUPPLIED BY NEITHER.
    // It mentions a loop counter, so lowering it as an ordinary tree would
    // resolve that name at ROOT scope, where it does not exist — turning a
    // drawing nothing reads into a runtime refusal for the whole script. It
    // still takes its output slot, which is what keeps `treeOutputs` index
    // aligned with `trees` for the check below.
    objectTrees: trees.map((node, i) => (
      (iterTreeIndex.has(i) || orphanTrees.has(i)) ? null : node)),
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
    // ⭐ THE PER-ROW READ THAT HAPPENS OFF A BAR OTHER THAN THE LAST — `{k,
    // counter}`, or `null`. It is no longer a refusal (see the note above), but
    // it is still the fact that distinguishes a drawing whose rows are rebuilt
    // every bar from one written the dashboard way, and it is what the costing
    // instrument counts. ⛔ IT NAMES THE OP AND THE COUNTER, not merely that a
    // loop exists: resolving a per-row value by its counter's NAME rather than
    // by the loop enclosing its READER is the mistake that declared two corpus
    // scripts safe when both carry two different loops called `i`.
    offLastBarRead: offender,
    // The per-row trees nothing reads. Carried so the reader can answer
    // `undefined` for one rather than the contents of an output nobody filled.
    orphanTrees,
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
  // ─── ⭐⭐⭐ ONE BAR WALK, NOT TWO — AND THAT IS THE WHOLE FIX ─────────
  //
  // ⚰️ THIS RAN `execute` TO COMPLETION AND *THEN* DREW. Every number the
  // drawing read came out of an array indexed by bar, so that was harmless for
  // all of them but one: the per-ITERATION buffers have no bar dimension and
  // are overwritten every bar, so by the time the drawing started they held
  // bar 4,999 and nothing else. A drawing that read a per-row value on any
  // other bar got real numbers from the wrong moment, and `buildObjectLane`
  // refused it rather than draw them — eleven corpus scripts, all of them
  // drawers, the largest genuinely-blocked drawing row in the census.
  //
  // ⛔⛔ THE STORAGE FIX WAS MEASURED FIRST AND REJECTED: 1,621MB full /
  // 801MB sparse for ONE script at 5,000 bars, against a 64MB ceiling
  // (`iterStorageCost.measure.test.js`). Advancing the drawing INSIDE the VM's
  // bar loop costs nothing at all and is exact, because the value is read on
  // the bar that is still standing.
  //
  // ⛔ THE ORDER IS NOT A DETAIL. `onBar` fires after the bar's last
  // instruction and after the history commit, so `outputs[*][bar]` and every
  // iteration buffer hold this bar's finished values and nothing of the next.
  const cursor = { bar: -1 }
  // ⭐ The reader is built on the FIRST bar, because `outputs` and `iters` are
  // the VM's own arrays and it has not allocated them until the run starts.
  // They are allocated ONCE for the whole run, so binding them once is right.
  let read = null
  const drawing = beginObjects(lane.objects, {
    barCount: bars,
    readNode: (treeIndex, bar, loopVars) => (
      read ? read(treeIndex, bar, loopVars) : NaN),
    readTime: view.readTime,
    readParam: view.readParam,
    limits: view.limits,
    trace: view.trace,
  })
  // ⛔⛔ `barTimes` AND `requestBars` ARE NOT OPTIONAL EXTRAS FOR THIS LANE.
  //
  // A watchlist dashboard is made ENTIRELY of `request.security` — its every
  // number belongs to another symbol — and its session columns read the ET
  // clock off the bar's own instant. Without these two the program still runs
  // and still draws: every request answers `na`, every clock read answers `na`,
  // and the table paints its "no data" state. ⭐ That is the worst shape a gap
  // can take here, because it is indistinguishable from a quiet market, and it
  // is exactly what this runner produced before they were forwarded.
  //
  // ⚠️ They stay OPTIONAL on `view` on purpose: a drawing that reads neither
  // (a label on this chart's own price) must not have to invent them. What is
  // fixed is that a caller which HAS them can no longer fail to pass them.
  const { requested } = execute(lane.program, {
    bars,
    series: view.series,
    columns: lane.program.columns,
    confirmed: view.confirmed !== false,
    barTimes: view.barTimes,
    requestBars: view.requestBars,
  }, view.limits, {
    onBar: (bar, iters, outputs) => {
      if (!read) read = readObjectLaneNode(lane, outputs, iters, cursor)
      cursor.bar = bar
      drawing.step(bar)
    },
  })
  const drawn = drawing.finish()
  // ⭐⭐ WHAT THE RUN ASKED FOR AND COULD NOT GET, CARRIED OUT WITH THE DRAWING.
  // A watchlist dashboard discovers its symbols WHILE it runs, so the host
  // cannot know what to fetch until the first pass reports it — that is the
  // fixed-point the request lane was built for. Dropping the report here made
  // the second pass impossible and left the caller with a table of `na` and no
  // way to learn why.
  return { ...drawn, requested: [...(requested || [])] }
}

/** tree index → its value on a bar, through the output the front end assigned.
 *
 *  ⛔ AN UNKNOWN INDEX ANSWERS `NaN`, NEVER `0`. Zero is a coordinate, a row
 *  number and a colour; NaN is the only value the object runtime's own finiteness
 *  guards already treat as "do not draw this". `buildObjectLane` refuses the case
 *  where this could happen in bulk — this is the per-read floor under that. */
export function readObjectLaneNode(lane, outputs, iters = [], cursor = null) {
  const map = lane.treeOutputs
  const byTree = lane.iterByTree || new Map()
  const orphans = lane.orphanTrees || new Set()
  return (treeIndex, bar, loopVars) => {
    // ⛔ AN ORPHAN PER-ROW TREE ANSWERS `undefined`, NEVER ITS OUTPUT SLOT.
    // It was supplied to neither channel, so its slot exists to keep the
    // tree→output map aligned and was never written — and an unwritten numeric
    // output reads back as ZERO, which this module's own floor note calls out
    // as a coordinate, a row number and a colour. Nothing should reach here
    // (the build classifies a tree as an orphan precisely because no op reads
    // it); if the classification is ever wrong, this fails to "draw nothing"
    // rather than to a plausible number.
    if (orphans.has(treeIndex)) return undefined
    // ⭐⭐ A PER-ROW TREE IS READ FROM ITS ITERATION BUFFER, BY COUNTER.
    // ⛔ An unbound counter answers `undefined`, never slot 0: reading row
    // zero for every pass is the forty-identical-rows failure this channel
    // exists to prevent, and it looks exactly like data.
    const it = byTree.get(treeIndex)
    if (it) {
      // ⛔⛔ THE ITERATION BUFFER HAS NO BAR DIMENSION, SO THE READER CHECKS
      // WHICH BAR IT IS STANDING ON.
      //
      // `vm.js` allocates `iters` once for the whole run and overwrites it
      // every bar, which is exactly why `objects:iterated-tree-not-last-bar`
      // used to refuse these drawings. `runObjectLane` now advances the drawing
      // INSIDE the VM's bar loop, so the buffer always holds the bar being
      // drawn — and this is the assertion that says so rather than assuming it.
      //
      // ⛔ IT THROWS, IT DOES NOT DRAW NOTHING. The two walks being wired apart
      // is a defect in this repository, not a shape a member can write, and the
      // failure it would otherwise produce is a table of plausible numbers from
      // another moment — which is what a silent `undefined` would hide.
      if (!cursor || cursor.bar !== bar) {
        throw new Error(
          `objects: a per-row value was asked for on bar ${bar} while the runtime `
          + `stands on bar ${cursor ? cursor.bar : 'no'} — the iteration buffer `
          + 'holds only the bar that wrote it, so that row would come from '
          + 'another moment')
      }
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
