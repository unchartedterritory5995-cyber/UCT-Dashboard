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

import { BINARY, UNARY, TERNARY, POINTWISE_FOR_PARITY } from '../ast/interpret.js'
import { OP, OP_NAME, IMPLEMENTED, SERIES_NAMES } from './program.js'
import { Budget } from './limits.js'

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
export function execute(program, ctx, limits) {
  const budget = new Budget(limits)
  budget.peak('IR_SIZE', program.instructions)
  budget.peak('HISTORY', ctx.bars)

  const code = program.code
  const consts = program.consts
  const nOut = program.outputs.length
  const outputs = []
  for (let i = 0; i < nOut; i += 1) outputs.push(new Float64Array(ctx.bars).fill(NaN))

  // ⛔ THE STACK IS ALLOCATED ONCE FOR THE WHOLE RUN, not per bar. A per-bar
  // allocation is what made Phase 1's "columnar" shape look 4x slower than it
  // is — allocation dominates dispatch at this granularity, and measuring the
  // allocator instead of the architecture is exactly the error that probe's
  // reused-buffer control exists to prevent.
  const stack = new Float64Array(256)
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
  const locals = new Float64Array(program.locals + depthLimit * maxFrame).fill(NaN)
  const persist = new Float64Array(Math.max(program.persists, 1)).fill(NaN)
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

  for (let bar = 0; bar < ctx.bars; bar += 1) {
    // ⛔ ONLY THE MAIN FRAME IS CLEARED PER BAR. A function's locals are cleared
    // per INVOCATION (see CALL) — which is stronger, and is what stops one bar's
    // call from seeing the previous bar's leftovers.
    locals.fill(NaN, 0, program.locals)
    let sp = 0
    let pc = 0
    let perBar = 0
    let depth = 0
    let localsBase = 0
    let localsTop = program.locals
    let persistBase = 0
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
          const plan = histPlan[a]
          const cell = histOffset[a] + ((committed - b) % plan.depth)
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
        case OP.RET: {
          const value = stack[--sp]
          depth -= 1
          pc = frRetPc[depth]
          localsBase = frLocalsBase[depth]
          localsTop = frLocalsTop[depth]
          persistBase = frPersistBase[depth]
          stack[sp++] = value
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
          outputs[a][bar] = Number.isFinite(v) ? v : NaN
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
        hist[cell] = plan.persist ? persist[plan.slot] : locals[plan.slot]
      }
      committed += 1
    }
  }

  return { outputs, budget }
}
