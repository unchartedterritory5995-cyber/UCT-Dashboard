// app/src/components/chart/engine/runtime/vm.js
//
// ─── THE BAR-BY-BAR RUNTIME ─────────────────────────────────────────────────
//
// The thing Phase 1 proved the engine did not have: execution that advances one
// bar at a time, so program order, persistence and lifetime are representable.
// This is the FOUNDATION — arithmetic, comparison, logic, history, output — with
// state, loops, arrays, frames and object refs landing on it in 2D/2E/2F. Their
// opcodes are already reserved in `program.js` and their slots already exist in
// the execution context below, so nothing here needs re-cutting when they arrive.
//
// ⭐⭐ THE SCALAR OPERATORS ARE IMPORTED, NEVER COPIED. `interpret.js` owns them,
// and its own comment says why a second table would be a second grammar — the
// NaN rule alone (`cmp` answers 0, `logical` answers NaN) would diverge in a way
// no parity run could catch, because both lanes would be wrong identically. So
// the differential rail is free to test what genuinely differs between a
// whole-series pass and a per-bar walk: history indexing, ordering, emit
// alignment and warm-up NaN patterns.
//
// ⛔ NO CLOCK, NO NETWORK, NO MODULE STATE — the same purity contract
// `interpret.js` states. The same (program, context) produces the same series
// forever, and the budget lives on the call rather than the module so that a
// screener pass over 5,000 symbols cannot let symbol 4,000 inherit 3,999's spend.

import { BINARY, UNARY, TERNARY, POINTWISE_FOR_PARITY, FINITE_WINDOW, CARRIED } from '../ast/interpret.js'
import { OP, OP_NAME, IMPLEMENTED, SERIES_NAMES } from './program.js'
import { TEXT_FNS } from './text.js'
import { COLOUR_FNS, colourArgKind } from './colours.js'
import { ARRAY_FNS, kindOf, argKind } from './collections.js'
import { Budget } from './limits.js'
// ⭐ THE ITERATION CEILING IS THE OBJECT PROGRAM'S OWN COLLECTION CAP, imported
// rather than restated. A drawing cannot hold more objects than that, so a
// buffer sized to anything else would be a second authority on how many rows a
// table may have (`lesson_a_second_authority_over_one_value`).
import { MAX_COLLECTION_CAP as ITER_SLOTS } from '../ast/objectProgram.js'

const ADD = BINARY['+'], SUB = BINARY['-'], MUL = BINARY['*'], DIV = BINARY['/']
const LT = BINARY['<'], GT = BINARY['>'], LE = BINARY['<='], GE = BINARY['>=']
const EQ = BINARY['=='], NE = BINARY['!=']
const AND = BINARY['&&'], OR = BINARY['||']
const NOT = UNARY['!'], NEG = UNARY['u-']
const PW = POINTWISE_FOR_PARITY

export class VmError extends Error {
  constructor(message) { super(message); this.name = 'VmError' }
}

/**
 * The execution context. ⭐ AN OBJECT, NOT A BARE BAR ARRAY, and that is a
 * design commitment rather than tidiness: a forming bar has to be re-executable
 * and a requested series has to be SUPPLIED rather than assumed
 * (PHASE2_RUNTIME_ARCHITECTURE.md §30/§31). Neither is implemented here; the
 * shape is what stops them needing a signature change later.
 *
 * @param {object} o
 * @param {number} o.bars         bar count
 * @param {Float64Array[]} o.series   indexed by SERIES_NAMES
 * @param {Float64Array[]} o.columns  pure subtrees the columnar lane evaluated
 */
export function makeContext({ bars, series, columns, confirmed = true }) {
  if (!Number.isInteger(bars) || bars < 0) throw new VmError(`bars must be a non-negative integer, got ${bars}`)
  if (!Array.isArray(series) || series.length !== SERIES_NAMES.length) {
    throw new VmError(`series must be ${SERIES_NAMES.length} arrays (${SERIES_NAMES.join(', ')})`)
  }
  for (let i = 0; i < series.length; i += 1) {
    if (!series[i] || series[i].length !== bars) {
      throw new VmError(`series[${i}] (${SERIES_NAMES[i]}) must hold ${bars} values, got ${series[i] && series[i].length}`)
    }
  }
  const cols = columns || []
  for (let i = 0; i < cols.length; i += 1) {
    if (!cols[i] || cols[i].length !== bars) {
      throw new VmError(`column ${i} must hold ${bars} values, got ${cols[i] && cols[i].length}`)
    }
  }
  return { bars, series, columns: cols, confirmed }
}

/**
 * Execute `program` over `ctx`, one bar at a time.
 * @returns {{outputs: Float64Array[], budget: Budget}}
 */
/** Run one request's expression over ANOTHER symbol's bars, then line the result
 *  up with the chart's.
 *
 *  ⛔⛔ THE ALIGNMENT IS A MEASURED VENDOR FACT. Taken on a real TradingView
 *  chart, 2026-09-19 (vendor packet M1): on a HISTORICAL bar a `"D"` request
 *  returns the PREVIOUS COMPLETED daily bar — a 5-minute bar at 09-18 12:35 ET
 *  saw 09-17's close, not the forming day's. So a chart bar sees the last
 *  requested bar that had already CLOSED when it opened, and a requested bar
 *  stamped at or after the chart bar's time is still forming.
 *
 *  ⭐ STRICTLY BEFORE, which is what makes this free of lookahead: no chart bar
 *  can ever read a value that did not exist while it was open. A `<=` here would
 *  hand a backtest a number nobody could have traded on — the most
 *  valuable-looking wrong answer this engine could produce.
 */
function runRequest(program, site, otherBars, ctx, budget, requested, requestCache, results) {
  const n = otherBars.length
  const pick = (k) => Float64Array.from(otherBars.map((b) => b[k]))
  const sub = execute(program, {
    bars: n,
    series: [pick('o'), pick('h'), pick('l'), pick('c'), pick('v')],
    columns: ctx.columns,
    confirmed: true,
    barTimes: otherBars.map((b) => b.t),
    requestBars: ctx.requestBars,
  }, undefined, {
    entry: site.entry, budget, requested, requestCache,
  })

  const chartTimes = ctx.barTimes || []
  const otherTimes = otherBars.map((b) => b.t)
  const aligned = []
  for (let k = 0; k < results; k += 1) aligned.push(new Float64Array(ctx.bars).fill(NaN))
  let j = -1
  for (let i = 0; i < ctx.bars; i += 1) {
    const tNow = chartTimes[i]
    // ⭐ ONE FORWARD WALK, not a search per bar: both series are in time order,
    // so the pointer only ever moves forward across the whole alignment.
    while (j + 1 < n && otherTimes[j + 1] < tNow) j += 1
    if (j >= 0) for (let k = 0; k < results; k += 1) aligned[k][i] = sub.outputs[k][j]
  }
  return aligned
}

export function execute(program, ctx, limits, opts) {
  const budget = (opts && opts.budget) || new Budget(limits)
  // ⭐ A REQUEST RUNS THE SAME PROGRAM FROM A DIFFERENT ENTRY, over another
  // symbol's series. Sharing the BUDGET is deliberate: a script that requests
  // forty symbols has done forty symbols' worth of work, and a per-run budget
  // would let it do that forty times over inside one bar's allowance.
  const entryPc = (opts && Number.isInteger(opts.entry)) ? opts.entry : 0
  // ⛔ WHAT THE RUN ASKED FOR AND COULD NOT GET. Shared with nested runs, so a
  // request made inside a request is reported to the same caller.
  const requested = (opts && opts.requested) || new Set()
  const requestCache = (opts && opts.requestCache) || new Map()
  budget.peak('IR_SIZE', program.instructions)
  budget.peak('HISTORY', ctx.bars)

  const code = program.code
  const consts = program.consts
  const nOut = program.outputs.length
  const outputs = []
  for (let i = 0; i < nOut; i += 1) outputs.push(new Float64Array(ctx.bars).fill(NaN))
  // ⭐⭐ PER-ITERATION BUFFERS — INDEXED BY LOOP COUNTER, NOT BY BAR.
  //
  // ⛔ SIZED INDEPENDENTLY OF `ctx.bars`, DELIBERATELY. The obvious thing is
  // to reuse an output's `Float64Array`, and it is wrong in the direction that
  // hurts: a four-bar unit test would give a forty-row table four slots and
  // drop thirty-six rows, while passing every large-series test. The cap is the
  // object program's own collection ceiling, which is TradingView's.
  //
  // ⛔ AND IT IS OVERWRITTEN EVERY BAR. Only the bar that wrote it last can be
  // read back, which is why the lane refuses a drawing that is not last-bar
  // guarded instead of handing back a stale buffer.
  const iterSpecs = program.iterOutputs || []
  const iters = iterSpecs.map((o) => (o.kind === 'text'
    ? new Array(ITER_SLOTS).fill(undefined)
    : new Float64Array(ITER_SLOTS).fill(NaN)))

  // ⛔ THE STACK IS ALLOCATED ONCE FOR THE WHOLE RUN, not per bar. A per-bar
  // allocation is what made Phase 1's "columnar" shape look 4x slower than it
  // is — allocation dominates dispatch at this granularity, and measuring the
  // allocator instead of the architecture is exactly the error that probe's
  // reused-buffer control exists to prevent.
  //
  // ⭐⭐ AND IT HOLDS VALUES, NOT DOUBLES. A member's own values include
  // strings, so the stack, the bar frame and the persistent slots are plain
  // arrays. ⛔ `series`, `columns`, the history ring, the window buffers and the
  // carried-state store below stay `Float64Array`: they serve numeric builtins
  // and are numeric BY CONSTRUCTION, so boxing them would cost the numeric path
  // and buy nothing. The decision, and what it measured, is in
  // `VALUE_MODEL_DECISION.md`.
  const stack = new Array(256).fill(NaN)
  const series = ctx.series
  const columns = ctx.columns
  const n = program.instructions

  // ⭐ THE TWO LIFETIMES, AND THEY ARE THE WHOLE POINT OF A BAR LOOP.
  // `locals` is the bar frame: reset to `na` at the top of every bar, because a
  // Pine local read before assignment is `na` and NOT last bar's value — carrying
  // it over would turn every ordinary binding into an accidental `var`.
  // `persist` survives, which is what `var` means.
  // ⭐⭐ ONE LOCALS ARRAY, ADDRESSED THROUGH A FRAME BASE. Every LOAD_LOCAL is
  // frame-relative, so the SAME opcode serves the main program (base 0) and any
  // invocation, and a nested call cannot reach its caller's slots — the isolation
  // §5 requires is a property of the addressing rather than of a rule somebody
  // has to remember.
  const maxFrame = program.functions.length
    ? Math.max(...program.functions.map((f) => f.frameSize)) : 0
  const depthLimit = Math.max(1, budget.limits.CALL_DEPTH)
  // ⭐ VALUES, for the reason given at the stack above. `NaN` is still how a
  // number spells `na`, so every existing numeric op is unaffected by the
  // change of container.
  const locals = new Array(program.locals + depthLimit * maxFrame).fill(NaN)
  const persist = new Array(Math.max(program.persists, 1)).fill(NaN)
  // ⛔ INITIALISATION IS TRACKED SEPARATELY FROM VALUE. `na` is a legitimate
  // value for an initialised slot (`var float x = na` is real Pine), so "is it
  // still NaN" cannot answer "has it been initialised" — that conflation would
  // re-run an initialiser every bar for any slot legitimately holding `na`.
  const initialised = new Uint8Array(Math.max(program.persists, 1))

  // ⭐⭐⭐ THE HISTORY RINGS — 2F-2, and the second of the runtime's two lifetimes
  // becomes three. `locals` is this bar. `persist` is across bars, live. This is
  // across bars, COMMITTED: what each past bar's FINAL value was.
  //
  // ⛔⛔ IT IS A SEPARATE STORE ON PURPOSE. The tempting implementation is to let
  // `x[1]` read the slot and rely on it not having been assigned yet — which
  // works for exactly one shape (`x := f(x[1])` as the first statement) and is
  // wrong for every other, silently. `trend := trend[1]` after `trend` was
  // already touched this bar would read the CURRENT bar and the state machine
  // would never advance a bar behind, which is what SuperTrend actually means.
  //
  // ⭐ ONE FLAT Float64Array WITH PER-SLOT OFFSETS, not an array of arrays: a
  // ring per slot allocated separately would put N allocations and N pointer
  // hops in a loop that runs once per bar per slot across 5,000 symbols.
  const histPlan = program.history
  const nHist = histPlan.length
  const histOffset = new Int32Array(nHist + 1)
  for (let i = 0; i < nHist; i += 1) histOffset[i + 1] = histOffset[i] + histPlan[i].depth
  const histTotal = histOffset[nHist]
  budget.peak('HISTORY_SLOTS', nHist)
  budget.peak('HISTORY_VALUES', histTotal)
  const hist = new Float64Array(histTotal).fill(NaN)
  // How many bars have been committed, so a ring position is `(committed - k) % depth`.
  let committed = 0

  // ⭐⭐⭐ P7.2 — THE HELD CELL, AND IT IS TRADINGVIEW'S RULING IN ONE ARRAY.
  //
  // A function-local series belongs to a CALL SITE, and its frame local does not
  // exist between invocations. So the value a site will contribute to this bar is
  // stashed here when the call RETURNS, and the end-of-bar phase commits from
  // here rather than from a frame that has gone.
  //
  // ⛔⛔ AND A SKIPPED CALL RE-COMMITS WHAT IT HELD. Vendor-pinned v5 and v6
  // (`skipped-callsite-history-spy-1d-2026-09-08`): with a call site firing every
  // third bar, `v[1] = v[2] = v[3] = A-3` and `v[4] = A-6` — the series is
  // indexed by CHART BAR and HOLDS across the bars the site did not run. Not
  // per-invocation (that gives `A-6` at `v[2]`), not clamped (that gives `A-3` at
  // `v[4]`), not blank. Because `held` is simply not overwritten on a skipped
  // bar, holding is what this array does by construction rather than by a rule.
  const held = new Float64Array(histTotal ? nHist : 1).fill(NaN)

  // ⭐⭐⭐ 2F-2B — ONE SCRATCH WINDOW PER SITE, ALLOCATED ONCE.
  //
  // The reducers in `interpret.js` take `(series, lo, hi)` over a CONTIGUOUS
  // array, and a ring is not contiguous — so each site owns a buffer the width
  // of its span, refilled per bar in bar order. Allocating it per bar would put
  // the collector inside the hot loop, which is the error Phase 1 measured.
  //
  // ⛔ THE BUFFER IS THE ONLY THING THIS RUNTIME ADDS. The arithmetic is
  // `FINITE_WINDOW[fn].reduce` — the SAME function object the columnar lane's
  // `rolling` calls — so there is no second SMA to keep in step.
  const winPlan = program.windows || []
  const winBuf = winPlan.map((w) => new Float64Array(w.span))
  // ⭐⭐⭐ 2F-2C — THE CARRIED-STATE STORE. One flat Float64Array for every
  // instance in the program, laid out as `cells` scalars per instance at a
  // static offset. Allocated ONCE per execution, so a 5,000-symbol scan pays for
  // it 5,000 times and never per bar.
  //
  // ⛔ A CARRIED INSTANCE IS NOT A `var`. It uses the same KIND of storage as
  // 2E's persistent block and is a SEPARATE region on purpose: a member's `var x`
  // and a builtin's private recurrence have different lifetimes to reason about,
  // and sharing one array would make a slot-allocation bug in either look like a
  // bug in the other.
  const carPlan = program.carried || []
  const carSpec = carPlan.map((c) => {
    const spec = CARRIED[c.fn]
    if (!spec) throw new VmError(`no carried-state implementation for \`${c.fn}\``)
    return spec
  })
  // ⭐ `alpha` IS OPTIONAL AND COMES FROM THE TABLE. `ema`/`rma` declare a
  // decay; `rising`/`falling` carry a COUNT and read nothing from that slot.
  // This line used to call `.alpha(c.n)` unconditionally, which is exactly how a
  // second member shape announces itself — with a TypeError rather than a wrong
  // number, which is the good version of that failure.
  //
  // ⛔ THERE IS DELIBERATELY NO WARM-UP GATE HERE. A member that withholds its
  // first values does it inside its own `step`, from a cell it counts itself, so
  // the gate rides the INVOCATION clock rather than this loop's chart-bar one.
  const carAlpha = carPlan.map((c, i) => (carSpec[i].alpha ? carSpec[i].alpha(c.n) : undefined))
  const carOffset = new Int32Array(carPlan.length)
  let carCells = 0
  for (let i = 0; i < carPlan.length; i += 1) { carOffset[i] = carCells; carCells += carSpec[i].cells }
  const carState = new Float64Array(carCells)
  for (let i = 0; i < carPlan.length; i += 1) carSpec[i].init(carState, carOffset[i])
  if (carPlan.length) {
    budget.peak('CARRIED_INSTANCES', carPlan.length)
    budget.peak('CARRIED_CELLS', carCells)
  }
  // ⭐⭐⭐ THE NA POLICY IS READ FROM `FINITE_WINDOW`, NOT STORED IN THE ARTIFACT.
  // The columnar lane reaches the same field for the same member, so the two
  // cannot disagree about what an `na` means — which is the whole reason the
  // policy lives in the table rather than beside each driver.
  const winNa = winPlan.map((w) => FINITE_WINDOW[w.fn].na)
  // ⛔ `skip` NEEDS THE LAST n FINITE OBSERVATIONS, AND THEY MAY LIE FURTHER
  // BACK THAN n BARS. The history ring is `span - 1` deep and cannot answer
  // that, so a skip window keeps its OWN ring of finite values — exactly n
  // cells, appended only when a finite value arrives. Bounded by construction:
  // the gap between observations can be arbitrary, the STORAGE cannot.
  const winObs = winPlan.map((w) => (FINITE_WINDOW[w.fn].na === 'skip' ? new Float64Array(w.span) : null))
  const winObsN = new Int32Array(winPlan.length)
  const winReduce = winPlan.map((w) => {
    const spec = FINITE_WINDOW[w.fn]
    if (!spec) throw new VmError(`no finite-window reducer for \`${w.fn}\``)
    return spec.reduce
  })
  // ⚰️⚰️ THERE WAS A `histPresent` FLAG ARRAY HERE, AND MEASURING IT KILLED IT.
  //
  // The reasoning for it was good and is the `var float x = na` lesson: a
  // committed bar's value may legitimately BE `na`, so "is this cell NaN" cannot
  // answer "did that bar happen". It was written, it was commented, and the
  // mutation control that deleted it left ALL 160 runtime tests green — because
  // in THIS design the distinction is unreachable three times over. Warm-up is
  // already answered by `b > committed`; the ring is `fill(NaN)` so an unwritten
  // cell already reads `na`; and `b <= depth` guarantees the cell a read lands on
  // was written by exactly the bar it names, never by an older one.
  //
  // ⛔ SO IT WAS AN UNFALSIFIABLE GUARD, which is the thing this repo keeps
  // paying for (`lesson_gate_that_cannot_fail`, `lesson_built_tested_green_and_unreachable`):
  // it cost a reader's attention and a write per slot per bar, and bought a
  // feeling of protection no test could confirm. Removed rather than kept "for
  // later". ⚠️ 2F-2B WILL NEED THE DISTINCTION FOR REAL — a finite window has to
  // count how many genuine bars it has seen, and there `na` and absent give
  // different answers — and it should introduce it THEN, where a test can see it.

  // The frame stack. ⛔ Parallel typed arrays rather than objects: a frame is
  // pushed and popped on every call, and allocating one per invocation would put
  // the garbage collector inside the hot loop.
  const frRetPc = new Int32Array(depthLimit + 1)
  const frLocalsBase = new Int32Array(depthLimit + 1)
  const frLocalsTop = new Int32Array(depthLimit + 1)
  const frPersistBase = new Int32Array(depthLimit + 1)
  const frHistoryBase = new Int32Array(depthLimit + 1)
  const frCarriedBase = new Int32Array(depthLimit + 1)
  const frWindowBase = new Int32Array(depthLimit + 1)
  const frFn = new Int32Array(depthLimit + 1)

  for (let bar = 0; bar < ctx.bars; bar += 1) {
    // ⛔ ONLY THE MAIN FRAME IS CLEARED PER BAR. A function's locals are cleared
    // per INVOCATION (see CALL) — which is stronger, and is what stops one bar's
    // call from seeing the previous bar's leftovers.
    locals.fill(NaN, 0, program.locals)
    let sp = 0
    let pc = entryPc
    let perBar = 0
    let depth = 0
    let localsBase = 0
    let localsTop = program.locals
    let persistBase = 0
    let historyBase = 0
    let carriedBase = 0
    let windowBase = 0
    for (;;) {
      const base = pc * 3
      const op = code[base]
      const a = code[base + 1]
      const b = code[base + 2]
      pc += 1
      perBar += 1
      if (perBar > budget.limits.INSTRUCTIONS_PER_BAR) {
        budget.charge('INSTRUCTIONS_PER_BAR', perBar)
      }

      switch (op) {
        case OP.CONST: stack[sp++] = consts[a]; break
        case OP.READ_SERIES: stack[sp++] = series[a][bar]; break
        case OP.READ_SERIES_HIST:
          // ⛔ BEFORE THE FIRST BAR IS `na`, never a wrapped index. Reading
          // `series[bar - b]` with a negative index would answer `undefined`
          // and poison every later comparison silently.
          stack[sp++] = bar - b >= 0 ? series[a][bar - b] : NaN
          break
        case OP.READ_COLUMN: stack[sp++] = columns[a][bar]; break
        case OP.READ_HIST: {
          // ⛔ `bar - b`, AND OUT OF RANGE IS `na` — NEVER a clamp to bar 0.
          // Clamping is how a warm-up window silently becomes a real number:
          // `close[50]` on bar 3 would answer with bar 0's close and every
          // downstream average would be confidently wrong for fifty bars.
          const idx = bar - b
          stack[sp++] = idx >= 0 ? columns[a][idx] : NaN
          break
        }
        case OP.ADD: { const y = stack[--sp]; stack[sp - 1] = ADD(stack[sp - 1], y); break }
        case OP.SUB: { const y = stack[--sp]; stack[sp - 1] = SUB(stack[sp - 1], y); break }
        case OP.MUL: { const y = stack[--sp]; stack[sp - 1] = MUL(stack[sp - 1], y); break }
        case OP.DIV: { const y = stack[--sp]; stack[sp - 1] = DIV(stack[sp - 1], y); break }
        case OP.NEG: stack[sp - 1] = NEG(stack[sp - 1]); break
        case OP.CONCAT: {
          const y = stack[--sp]
          const x = stack[sp - 1]
          // ⛔ BOTH SIDES MUST ALREADY BE STRINGS. Pine's `+` across a string
          // and a number is a TYPE ERROR, not an implicit conversion, so
          // coercing here would accept a script TradingView rejects and then
          // disagree with it about the result. The front end routes a text `+`
          // here on a STATIC read of the operands; this is what catches the case
          // where that read was wrong.
          if (typeof x !== 'string' || typeof y !== 'string') {
            throw new VmError(
              `pc ${pc - 1}: concat needs two strings, got ${typeof x} and ${typeof y} — `
              + "Pine's `+` across a string and a number is a type error, not a conversion")
          }
          stack[sp - 1] = x + y
          break
        }
        case OP.LT: { const y = stack[--sp]; stack[sp - 1] = LT(stack[sp - 1], y); break }
        case OP.GT: { const y = stack[--sp]; stack[sp - 1] = GT(stack[sp - 1], y); break }
        case OP.LE: { const y = stack[--sp]; stack[sp - 1] = LE(stack[sp - 1], y); break }
        case OP.GE: { const y = stack[--sp]; stack[sp - 1] = GE(stack[sp - 1], y); break }
        case OP.EQ: { const y = stack[--sp]; stack[sp - 1] = EQ(stack[sp - 1], y); break }
        case OP.NE: { const y = stack[--sp]; stack[sp - 1] = NE(stack[sp - 1], y); break }
        case OP.AND: { const y = stack[--sp]; stack[sp - 1] = AND(stack[sp - 1], y); break }
        case OP.OR: { const y = stack[--sp]; stack[sp - 1] = OR(stack[sp - 1], y); break }
        case OP.NOT: stack[sp - 1] = NOT(stack[sp - 1]); break
        case OP.SELECT: {
          // ⛔ ARGUMENTS ARE ALREADY EVALUATED, which is correct HERE and will
          // NOT be correct once a branch can have an effect. Pine's `?:` on pure
          // values has no observable order, and this mirrors `interpret.js`'s
          // `lift3`. When 2D lands `if`/`else` as statements, the branch that is
          // not taken must not RUN — that is JUMP_IF_FALSE's job, not this
          // opcode's, and conflating them is how a side effect fires twice.
          const bb = stack[--sp]; const aa = stack[--sp]
          stack[sp - 1] = TERNARY(stack[sp - 1], aa, bb)
          break
        }
        case OP.READ_HIST_SLOT: {
          // ⛔ BEYOND WHAT HAS BEEN COMMITTED IS `na`, NEVER A CLAMP. On bar 0
          // nothing has been committed, so `x[1]` is `na` — the same answer
          // READ_HIST gives a column, and for the same reason: clamping to the
          // earliest bar is how a warm-up silently becomes a real number.
          if (b > committed) { stack[sp++] = NaN; break }
          // ⭐ FRAME-RELATIVE, exactly like a persist slot: the main program
          // reads at base 0 and an invocation reads at its SITE’s base, so one
          // compiled body serves every call site without sharing a ring.
          const hi = historyBase + a
          const plan = histPlan[hi]
          const cell = histOffset[hi] + ((committed - b) % plan.depth)
          stack[sp++] = hist[cell]
          break
        }
        case OP.LOAD_LOCAL: stack[sp++] = locals[localsBase + a]; break
        case OP.STORE_LOCAL: locals[localsBase + a] = stack[--sp]; break
        case OP.LOAD_PERSIST: stack[sp++] = persist[persistBase + a]; break
        case OP.STORE_PERSIST:
          persist[persistBase + a] = stack[--sp]
          initialised[persistBase + a] = 1
          break
        case OP.JUMP: pc = a; break
        case OP.JUMP_IF_FALSE: {
          // ⛔ `na` IS FALSE HERE, and that is a decision rather than an accident.
          // Pine will not branch on `na`; treating it as true would run a body
          // whose condition is unknown. It matches `TERNARY`'s refusal to pick a
          // branch on a NaN test — the same question, answered the same way.
          const t = stack[--sp]
          if (t !== t || t === 0) pc = a
          break
        }
        case OP.JUMP_IF_INIT: if (initialised[persistBase + a]) pc = b; break
        case OP.CALL: {
          const fn = program.functions[a]
          const site = program.callSites[b]
          budget.peak('CALL_DEPTH', depth + 1)
          budget.charge('CALL_COUNT', 1)
          const newBase = localsTop
          // ⭐ ARGUMENTS COME OFF THE STACK IN REVERSE — they were pushed
          // left-to-right, so the last parameter is on top.
          for (let k = fn.params - 1; k >= 0; k -= 1) locals[newBase + k] = stack[--sp]
          // ⛔⛔ AND THE REST OF THE FRAME IS CLEARED ON EVERY INVOCATION. A Pine
          // function local read before assignment is `na`; leaving the previous
          // invocation's values there would make an ordinary local behave like a
          // `var` that is also shared between call sites — two defects at once,
          // and both silent.
          locals.fill(NaN, newBase + fn.params, newBase + fn.frameSize)
          frRetPc[depth] = pc
          frLocalsBase[depth] = localsBase
          frLocalsTop[depth] = localsTop
          frPersistBase[depth] = persistBase
          depth += 1
          localsBase = newBase
          localsTop = newBase + fn.frameSize
          // ⭐⭐ THE PERSISTENT BASE COMES FROM THE CALL SITE, NOT THE FUNCTION.
          // This one line is §6: the code is shared, the `var` state is not.
          persistBase = site.persistBase
          frFn[depth - 1] = a
          frHistoryBase[depth - 1] = historyBase
          historyBase = site.historyBase
          frCarriedBase[depth - 1] = carriedBase
          carriedBase = site.carriedBase
          frWindowBase[depth - 1] = windowBase
          windowBase = site.windowBase
          pc = fn.entry
          break
        }
        case OP.POINTWISE: {
          // ⭐⭐ THE SCALAR IMPLEMENTATION IS THE COLUMNAR LANE'S OWN. `POINTWISE`
          // is the very table `interpret.js` applies elementwise to build a
          // column, so a pointwise call over runtime state and the same call over
          // a pure series are the SAME arithmetic by construction — including the
          // na rules, which is where a re-implementation would have diverged
          // first and least visibly.
          const fn = PW[program.pointwise[a]]
          if (!fn) throw new VmError(`pc ${pc - 1}: no pointwise implementation for ${program.pointwise[a]}`)
          sp -= b
          let v
          if (b === 1) v = fn(stack[sp])
          else if (b === 2) v = fn(stack[sp], stack[sp + 1])
          else v = fn(...Array.prototype.slice.call(stack, sp, sp + b))
          stack[sp++] = v
          break
        }
        case OP.COLOUR: {
          // ⭐ ONE CHECK SITE, FROM THE ENTRY'S OWN DECLARATION — the rule
          // `OP.TEXT` states below. A colour is a packed integer at run time, so
          // every operand here is a `number` as far as this VM is concerned;
          // whether it is a COLOUR is the front end's question.
          const cname = program.colourOps[a]
          const cspec = COLOUR_FNS[cname]
          sp -= b
          for (let i = 0; i < b; i += 1) {
            const want = colourArgKind(cspec, i)
            const v = stack[sp + i]
            if (kindOf(v) !== want) {
              throw new VmError(
                `pc ${pc - 1}: \`${cname}\` argument ${i + 1} takes a ${want}, got ${kindOf(v)}`)
            }
          }
          stack[sp] = cspec.fn(Array.prototype.slice.call(stack, sp, sp + b))
          sp += 1
          break
        }
        case OP.TEXT: {
          // ⭐⭐ THE KINDS ARE CHECKED FROM THE ENTRY'S OWN DECLARATION, not by
          // each function. Seven hand-written checks drift; one check site
          // cannot, and the one that would have drifted is the one nobody reads
          // again. `text.js` declares `args` per builtin and this reads it.
          const name = program.textOps[a]
          const spec = TEXT_FNS[name]
          sp -= b
          for (let i = 0; i < b; i += 1) {
            const kind = spec.args[i]
            const v = stack[sp + i]
            // ⛔ ONE KIND VOCABULARY ACROSS BOTH TABLES. `typeof []` is
            // "object", so a member who handed `str.length` the result of
            // `str.split` was told "got object" — a JavaScript word for a Pine
            // mistake. `kindOf` says "array", which is the thing they wrote.
            if (kindOf(v) !== kind) {
              // ⛔ NAMED TO THE BUILTIN AND THE POSITION. "a string was expected"
              // sends a member hunting through a whole watchlist parser; naming
              // `str.replace_all` argument 2 points at the line.
              throw new VmError(
                `pc ${pc - 1}: \`${name}\` argument ${i + 1} takes a ${kind}, got ${kindOf(v)}`)
            }
          }
          let v
          if (b === 1) v = spec.fn(stack[sp])
          else if (b === 2) v = spec.fn(stack[sp], stack[sp + 1])
          else v = spec.fn(...Array.prototype.slice.call(stack, sp, sp + b))
          stack[sp++] = v
          break
        }
        case OP.ARRAY: {
          const op = program.arrayOps[a]
          const spec = ARRAY_FNS[op.fn]
          sp -= b
          for (let i = 0; i < b; i += 1) {
            const want = argKind(spec, i)
            // ⭐ 'any' IS A REAL KIND HERE, not a missing check: `array.push`
            // takes whatever the array holds, and a typed array's element type
            // is the FRONT END's to police, not the VM's.
            if (want !== 'any' && kindOf(stack[sp + i]) !== want) {
              throw new VmError(
                `pc ${pc - 1}: \`${op.fn}\` argument ${i + 1} takes ${want === 'array' ? 'an' : 'a'} `
                + `${want}, got ${kindOf(stack[sp + i])}`)
            }
          }
          const args = Array.prototype.slice.call(stack, sp, sp + b)
          const out = spec.fn(args, budget, op.typeArg)
          // ⛔ A VOID CALL PUSHES NOTHING. `array.push` is a statement in Pine;
          // pushing an `undefined` for it would put a value on the stack that
          // nothing pops and that no kind check would recognise later.
          if (spec.returns !== 'void') stack[sp++] = out
          break
        }
        case OP.WINDOW: {
          // ⭐⭐ FRAME-RELATIVE, like every other per-site store. `windowBase` is
          // what keeps two call sites of one function from sharing an
          // observation ring — the fourth time this addressing has been needed.
          const wi = windowBase + a
          const w = winPlan[wi]
          const span = w.span
          const live = stack[--sp]
          const policy = winNa[wi]

          if (policy === 'skip') {
            // ⭐ THE MEASURED RULE: the last `span` FINITE observations, however
            // many BARS that spans, answering even ON the `na` bar.
            const obs = winObs[wi]
            if (Number.isFinite(live)) {
              for (let k = 0; k < span - 1; k += 1) obs[k] = obs[k + 1]
              obs[span - 1] = live
              if (winObsN[wi] < span) winObsN[wi] += 1
            }
            budget.charge('WINDOW_CELLS', span)
            stack[sp++] = winObsN[wi] < span ? NaN : winReduce[wi](obs, 0, span - 1)
            break
          }

          // ⛔ `propagate` AND `restart` BOTH READ THE COMMITTED RING, so they
          // keep 2F-2B's warm-up rule: `rolling` starts at bar n-1 and so does
          // this. What differs is only WHERE the window begins.
          if (committed < span - 1) { stack[sp++] = NaN; break }
          const buf = winBuf[wi]
          buf[span - 1] = live
          if (span > 1) {
            const hi = historyBase + w.historySlot
            const plan = histPlan[hi]
            const off = histOffset[hi]
            const depth = plan.depth
            for (let k = 1; k < span; k += 1) {
              buf[span - 1 - k] = hist[off + ((committed - k) % depth)]
            }
          }
          budget.charge('WINDOW_CELLS', span)
          if (policy === 'restart') {
            // ⭐ THE WINDOW BEGINS AGAIN AFTER A HOLE. The current bar must be
            // finite (the vendor blanks ON the hole); the run then reaches back
            // only as far as the last non-finite value.
            if (!Number.isFinite(live)) { stack[sp++] = NaN; break }
            let lo = span - 1
            while (lo > 0 && Number.isFinite(buf[lo - 1])) lo -= 1
            stack[sp++] = winReduce[wi](buf, lo, span - 1)
            break
          }
          stack[sp++] = winReduce[wi](buf, 0, span - 1)
          break
        }
                case OP.CARRIED: {
          // ⭐⭐ THE INSTANCE IS FRAME-RELATIVE. `a` addresses the compiled body;
          // `carriedBase` says WHOSE state that body is stepping on this
          // invocation. Two call sites of one function therefore keep two
          // recurrences through one instruction — vendor-confirmed: `f(close)`
          // and `f(close*2)` satisfy b == 2*a EXACTLY on every captured bar,
          // which shared state cannot produce.
          const ci = carriedBase + a
          const v = stack[--sp]
          // ⛔ STEPPING HAPPENS HERE, IN THE CALL. Not at end of bar. A skipped
          // call site never reaches this instruction and therefore never advances
          // — which is the measured TradingView rule, and the opposite of what
          // the history commit phase does for a skipped site (it re-commits a
          // HELD value). Two lifetimes, two rules, one wave apart.
          budget.charge('CARRIED_STEPS', 1)
          stack[sp++] = carSpec[ci].step(carState, carOffset[ci], v, carPlan[ci].n, carAlpha[ci])
          break
        }
                case OP.RET: {
          // ⭐⭐ THE RESULT IS ALREADY WHERE THE CALLER WANTS IT, AND THIS CASE
          // DELIBERATELY DOES NOT TOUCH THE STACK. `sp` is not part of a frame
          // — CALL consumes the arguments as it binds them, so by the time a
          // body finishes, the only thing above the caller's own values is what
          // this invocation produced. One value or five, they are contiguous
          // and in written order, and moving them would be work that changes
          // nothing.
          //
          // ⚰️ IT DID MOVE THEM, briefly, and a mutation proof showed the move
          // was decoration: cutting it to a single value left every tuple test
          // green, because the values never needed relocating. What actually
          // fixes the ORDER is the pair that does the real work — the tuple
          // pushes its elements left to right (`lowerIr`'s EXPR.TUPLE) and the
          // destructuring fills its slots right to left, because a stack pops
          // in reverse. Both are mutation-proved. A no-op kept here would read
          // to the next engineer as the mechanism, and they would look for the
          // bug in the wrong place.
          // ⭐⭐ P7.2 — THE HAND-OFF. The frame is about to disappear, so
          // whatever this invocation produced for its history-bearing locals is
          // stashed in the SITE’s held cells now. The end-of-bar phase commits
          // from there — which is why a bar on which this site never runs
          // re-commits the previous value instead of blanking it.
          {
            const rf = program.functions[frFn[depth - 1]]
            const hc = rf.historyCount
            for (let k = 0; k < hc; k += 1) {
              held[historyBase + k] = rf.historyPersist[k]
                ? persist[persistBase + rf.historySlots[k]]
                : locals[localsBase + rf.historySlots[k]]
            }
          }
          depth -= 1
          pc = frRetPc[depth]
          localsBase = frLocalsBase[depth]
          localsTop = frLocalsTop[depth]
          persistBase = frPersistBase[depth]
          historyBase = frHistoryBase[depth]
          carriedBase = frCarriedBase[depth]
          windowBase = frWindowBase[depth]
          break
        }
        case OP.EMIT: {
          // ⚰️ A NON-FINITE RESULT IS `na`, AND THE DIFFERENTIAL RAIL IS WHY
          // THIS LINE EXISTS. `close / (close - close)` is Infinity in raw IEEE
          // and the first version of this loop emitted exactly that; the
          // columnar lane answers NaN, because `interpret`'s `toColumn` launders
          // every non-finite value at the moment it becomes a column
          // (`typeof v === 'number' && Number.isFinite(v) ? v : NaN`).
          //
          // ⛔ SO THE RULE IS MIRRORED AT THE RUNTIME'S OWN COLUMN BOUNDARY,
          // which is EMIT — not inside DIV. Putting it in DIV would have fixed
          // this one expression and left every other route to an infinity
          // (overflow through `*`, a pow, a builtin) still disagreeing, which is
          // the difference between mirroring a rule and patching a symptom.
          // An Infinity that reached a screener comparison would win every `<`
          // test in the universe while meaning "we could not compute this".
          const v = stack[--sp]
          // ⛔⛔ AND SINCE A SLOT CAN NOW HOLD A STRING, THE KIND IS CHECKED
          // BEFORE THE FINITENESS IS. `Number.isFinite('abc')` is false, so the
          // laundering line below would have turned a string into `na` — the
          // exact silent coercion boxing the slots was meant to end, reappearing
          // one line later. An output series is a `Float64Array` and that is a
          // contract the chart and the columnar lane both read; a value that
          // cannot live in one is a translator defect, and it says so.
          if (typeof v !== 'number') {
            throw new VmError(
              `pc ${pc - 1}: output ${a} must carry a number, got ${typeof v} — `
              + 'a non-numeric value reached a plot')
          }
          outputs[a][bar] = Number.isFinite(v) ? v : NaN
          break
        }
        case OP.EMIT_ITER: {
          const v = stack[--sp]
          const idx = stack[--sp]
          // ⛔ AN OUT-OF-RANGE SLOT IS DROPPED, NEVER WRAPPED OR GROWN. A
          // counter past the ceiling means the drawing asked for more rows
          // than the object program may hold, and the envelope that already
          // bounds objects is the one authority on that — silently growing
          // here would route around it.
          if (typeof idx !== 'number' || !Number.isInteger(idx)
              || idx < 0 || idx >= ITER_SLOTS) break
          const buf = iters[a]
          // ⛔⛔ A TEXT BUFFER TAKES STRINGS AND A NUMERIC ONE TAKES NUMBERS.
          // The kind was declared and validated at build; a value of the other
          // kind arriving here is a translator defect, and it says so rather
          // than coercing — `String(NaN)` in a dashboard cell reads as data.
          if (Array.isArray(buf)) {
            if (typeof v !== 'string') {
              throw new VmError(`pc ${pc - 1}: iteration buffer ${a} is text and got ${typeof v}`)
            }
            buf[idx] = v
          } else {
            if (typeof v !== 'number') {
              throw new VmError(`pc ${pc - 1}: iteration buffer ${a} is numeric and got ${typeof v}`)
            }
            buf[idx] = Number.isFinite(v) ? v : NaN
          }
          break
        }
        case OP.LOOP_TICK:
          // ⛔ CHARGED PER ITERATION, ACROSS THE WHOLE RUN. A loop whose step
          // never reaches its bound — `by 0`, or a bound a body keeps moving —
          // is stopped here, by a limit that names itself, rather than hanging
          // the browser tab a member is looking at.
          budget.charge('LOOP_ITERATIONS', 1)
          budget.peak('LOOP_NESTING', a)
          break
        case OP.REQUEST: {
          const site = program.requests[a]
          const symbol = stack[--sp]
          if (typeof symbol !== 'string') {
            throw new VmError(
              `pc ${pc - 1}: request.security takes a symbol as text, got ${kindOf(symbol)}`)
          }
          const key = `${symbol}|${site.timeframe}`
          let series2 = requestCache.get(`${a}::${key}`)
          if (series2 === undefined) {
            const other = ctx.requestBars && ctx.requestBars[key]
            if (!other || !other.length) {
              // ⛔ NOT AN ERROR AND NOT A GUESS — a symbol this run has no bars
              // for is RECORDED and answers `na`. The script's symbols come out
              // of a pasted watchlist, so the only way to know what to fetch is
              // to run it and read back what it asked for.
              budget.peak('REQUEST_COUNT', requested.size + 1)
              requested.add(key)
              series2 = null
            } else {
              budget.peak('REQUEST_COUNT', requestCache.size + 1)
              series2 = runRequest(program, site, other, ctx, budget, requested, requestCache, b)
            }
            requestCache.set(`${a}::${key}`, series2)
          }
          if (series2 === null) {
            for (let k = 0; k < b; k += 1) stack[sp++] = NaN
          } else {
            for (let k = 0; k < b; k += 1) stack[sp++] = series2[k][bar]
          }
          break
        }
        case OP.HALT: break
        default:
          throw new VmError(
            `pc ${pc - 1}: ${IMPLEMENTED.has(op) ? 'unhandled' : 'reserved'} opcode `
            + `${OP_NAME[op] || op} reached the dispatch loop`)
      }
      if (op === OP.HALT) break
      if (pc >= n) throw new VmError('ran off the end of the program without HALT')
    }
    budget.charge('TOTAL_INSTRUCTIONS', perBar)
    budget.peak('INSTRUCTIONS_PER_BAR', perBar)

    // ⛔⛔ A BAR MUST LEAVE THE STACK AS IT FOUND IT. The stack is allocated ONCE
    // for the whole run, so a value pushed and never popped is not a leak that
    // clears next bar — it accumulates, and the run dies of a full stack
    // thousands of bars from the instruction that caused it.
    //
    // ⚰️ THIS EXISTS BECAUSE A MUTATION PROOF FOUND NOTHING WATCHING. Making a
    // VOID collection call push its `undefined` anyway left EVERY test green:
    // four-bar fixtures simply do not run long enough to notice, and the defect
    // would have surfaced as an unexplained stack overflow on a member's real
    // chart. It is an invariant, so it is asserted rather than tested around.
    if (sp !== 0) {
      throw new VmError(
        `bar ${bar}: the program left ${sp} value(s) on the stack — every value a `
        + 'bar pushes must be consumed by the end of it')
    }

    // ─── ⭐⭐⭐ THE END-OF-BAR COMMIT ───────────────────────────────────────
    //
    // The bar has finished. Whatever each history-bearing slot holds NOW is that
    // slot's value FOR THIS BAR, and that is what the next bar will see as `[1]`.
    //
    // ⛔⛔ IT IS A PHASE, NOT A SIDE EFFECT OF STORING. Committing inside
    // STORE_LOCAL/STORE_PERSIST would make `x[1]` mean "the value before the most
    // recent assignment", so a script that writes `x` twice on one bar would read
    // its own first write as history — program order masquerading as bar history.
    // Pine's `[]` counts BARS. This is the one place that advances them.
    //
    // ⭐ AND BECAUSE IT IS KEYED TO BAR ADVANCE RATHER THAN TO EXECUTION, the two
    // futures this runtime is shaped for already work: a loop body that runs a
    // call site fifty times inside one bar commits ONCE (§26), and a forming bar
    // re-executed on every tick must not advance `committed` until the bar is
    // confirmed (§27) — the counter is the only thing those features need to
    // touch, not the storage model.
    if (nHist) {
      for (let i = 0; i < nHist; i += 1) {
        const plan = histPlan[i]
        // ⭐ `committed` IS THIS BAR'S ORDINAL, which is what makes the read side
        // `(committed - back)` with no correction term. Writing at `committed+1`
        // and reading at `committed-back` is the off-by-one this comment exists
        // to stop somebody reintroducing: it is invisible on bar 0 and wrong on
        // every bar after.
        const cell = histOffset[i] + (committed % plan.depth)
        // ⭐ THE LIVE VALUE IS READ FROM ITS OWN LIFETIME'S ARRAY. A history slot
        // names a `local` or a `persist`; the plan says which, so this never has
        // to guess and a local can never be silently promoted to a `var` (§21).
        // ⭐ A MAIN series reads its LIVE slot; a call-site series commits what
        // that site HELD. One loop, two lifetimes, and the branch is the
        // vendor ruling rather than an optimisation.
        hist[cell] = plan.site === null
          ? (plan.persist ? persist[plan.slot] : locals[plan.slot])
          : held[i]
      }
      committed += 1
    }
  }

  return { outputs, iters, budget, requested: Array.from(requested).sort() }
}
