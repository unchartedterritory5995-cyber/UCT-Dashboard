// app/src/components/chart/engine/objectRuntime.js
//
// ─── ⭐⭐ C3B — THE OBJECT STATE EVALUATOR ───────────────────────────────────
//
// One bar at a time, in source order, exactly as Pine executes. Everything hard
// about graphical objects is here: identity that survives bars, a lifetime with
// an end, a resource envelope, and a deterministic answer to "what is on the
// chart right now".
//
// ⛔⛔ NO FUTURE LEAKAGE. Bar *i* sees values at bar *i* and object state built
// by bars 0..i. There is no second pass, no lookahead, and no "settle" step —
// because the one thing a member cannot forgive is a drawing that knew what
// happened next. The runtime therefore never reads a column at an index it has
// not reached, and `evaluateObjects` walks strictly forward.
//
// ⛔⛔ IDENTITY IS A COUNTER, NOT A FINGERPRINT. Every create mints the next
// integer. Two objects with identical geometry are two objects; the same object
// moved twice is still one. This is the rule the whole wave rests on and it is
// enforced by construction — there is no code path that looks at props to
// decide which object something is.
//
// ⭐ DELETION REALLY DELETES. The instance leaves the live map, its slot in the
// per-family counter is returned, and the render state that follows cannot see
// it. `CREATE → DELETE` repeated across thousands of bars must leave the live
// count flat, which is what `objectRuntime.gc.test.js` measures rather than
// assumes.
//
// ⚠️ A MUTATION OF A DELETED OBJECT IS A COUNTED NO-OP, NOT A CRASH. Pine lets a
// reference outlive the object it named; the honest model of that is "the write
// went nowhere", and hiding it would make a real authoring bug invisible, so it
// is tallied in `stats.writesToDeleted` and surfaced.
import {
  OBJECT_FAMILIES, DEFAULT_OBJECT_LIMITS, assertObjectProgram, graphNodesReferenced, opValueRefs,
  withObjectTransparency,
} from './ast/objectProgram'
// ⭐ C20 — a colour the runtime lane computed is a packed integer; the ONE unpacker.
import { unpackColor, wholeTransparency } from './colorInt.js'
// ⭐ C37 — the gradient's one curve, and the object colour string's one packer.
import { fromGradient, objectHexToPacked, packedToObjectHex } from './runtime/colours.js'
// ⭐ PINE'S CAPACITY TABLE, WIRED. `objectPool` has held the correct rule
// (fallback 50, ceiling 500, per family) with tests since R0.2 and was imported
// by nothing — parked on the reachability allowlist with an expiry that had
// passed. This is the seam it was built for.
import { POOL_LIMITS, resolveCapacity, collectsAbove } from './objectPool'
// ⭐ A GUARD THAT READS OBJECT STATE (`{v:'bool'|'cmp'|'cross'|'get'|'size'}`, see
// `LIVE_GUARD_KINDS`) is combined with `interpret`'s OWN operator table and its
// OWN carried crossing step — never a second copy of either.
import { BINARY, UNARY, CARRIED2, POINTWISE_FOR_PARITY as PW } from './ast/interpret'
// ⭐ `str.format`'s number rendering — the SAME module whose grammar the
// translator compiled the pattern with (C15, objects-triage step 13).
import { formatMessageNumber } from './pineTextFormat'

/** Own-property test — a family name must not reach `POOL_LIMITS` through the
 *  prototype chain (`constructor`, `toString`) and read as a declared pool. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export const OBJECT_STATUS = Object.freeze({
  OK: 'ok',
  LIMIT_EXCEEDED: 'OBJECT_LIMIT_EXCEEDED',
  // ⭐ C9 — a Pine RUNTIME error (a history read past the buffer, or at a
  // negative / fractional offset). TradingView stops the script and draws
  // nothing, so `finish` holds nothing — never the objects made before it.
  RUNTIME_ERROR: 'OBJECT_RUNTIME_ERROR',
})

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Pine's own ceiling on an array's length (the reference: "the maximum size of
 *  an array is 100,000"). A collection that would pass it stops the run, as
 *  Pine's runtime error stops the script. */
export const PINE_ARRAY_MAX = 100000

/** A latch whose condition read the warm-up curtain (`readUnknown`). */
const LATCH_UNKNOWN = Symbol('latch-unknown')

/** ⭐ C17 — the fields that decide WHETHER an op runs, or WHAT it acts on
 *  (`guardTainted`). */
const GUARD_FIELDS = Object.freeze(['when', 'col', 'row', 'index', 'col2', 'row2',
  'startCol', 'startRow', 'endCol', 'endRow', 'from', 'to', 'step'])
const NO_PROPS = Object.freeze([])

/** The most addresses one `table.merge_cells` may span — Pine's own table is at
 *  most 100 × 100 and anything larger is an argument that was never a size. */
const MAX_MERGE_AREA = 10000

/** Truthiness for a guard column. ⛔ `NaN` IS FALSE, deliberately: a condition
 *  that has not warmed up yet has not fired, and treating an unknown as a fire
 *  is how an object appears on bar 0 of every chart. */
function truthy(v) {
  if (v === true) return true
  if (v === false || v === null || v === undefined) return false
  return Number.isFinite(v) && v !== 0
}

/**
 * ⭐⭐ THE DRAWING, ONE BAR AT A TIME — SO SOMETHING ELSE CAN OWN THE BAR LOOP.
 *
 * `evaluateObjects` below is this driven to completion, and it is the only
 * caller that needs to be. The stepper exists because of ONE measured fact:
 * the runtime lane's per-iteration buffers are written by the VM as it walks
 * bars and are OVERWRITTEN every bar, so a drawing that reads a per-row value
 * on any bar but the last was reading whatever the last bar left behind.
 *
 * ⛔⛔ THE ALTERNATIVE WAS MEASURED AND IS NOT BUILDABLE. Giving those buffers
 * a bar dimension costs, for ONE corpus script at the 5,000 bars a chart asks
 * for, 1,621MB in full form and 801MB counting only the buffers that need it,
 * against a 64MB runtime ceiling — see `iterStorageCost.measure.test.js`. The
 * value does not have to be STORED per bar if the drawing is standing on the
 * bar that produced it, which is what this makes possible.
 *
 * ⭐ AND IT IS WHAT PINE ACTUALLY DOES. A member's `for` loop and the
 * `line.new` inside it are one program advancing one bar at a time; the two
 * separate passes were this engine's convenience, never the vendor's model.
 *
 * @param {object} program        a validated object program
 * @param {object} ctx
 * @param {number} ctx.barCount
 * @param {(node:number, bar:number)=>*} ctx.readNode   V2 graph node value at a bar
 * @param {(id:string)=>*}               [ctx.readParam] logical parameter value
 * @param {(bar:number)=>number}         [ctx.readTime]  Pine's `time` for the bar:
 *        its opening instant in MILLISECONDS (`objectReaderFor` builds it)
 * @param {object}                       [ctx.limits]    override the envelope
 * @param {boolean}                      [ctx.trace]     keep a per-bar event log
 * @returns {{barCount:number, ok:()=>boolean, step:(bar:number)=>void,
 *            finish:()=>object}}
 */
export function beginObjects(program, ctx) {
  assertObjectProgram(program)
  // ⭐⭐ CAPACITY IS PINE'S, AND `objectPool` OWNS THAT KNOWLEDGE.
  //
  // `DEFAULT_OBJECT_LIMITS` is this module's own envelope (a flat 500) and it is
  // NOT Pine's rule: Pine defaults each drawing family to **50** when the script
  // declares no `max_*_count`, and clamps a declared one to 500.
  // `objectPool.resolveCapacity` is the one place that table lives.
  //
  // ⛔ ONE OWNER PER QUESTION. The pool owns CAPACITY; the `live` Map below owns
  // LIVENESS. The pool also ships a FIFO store, and using it here would give us
  // two truths about what is live — registers, collections, table cells and the
  // output ordering all read `live`, so the two would drift on the first delete.
  //
  // ⚠️ `table` AND `linefill` ARE NOT IN THE POOL, AND THAT IS CORRECT. Pine
  // publishes no `max_tables_count`/`max_linefills_count`; those two keep this
  // module's own envelope rather than being given an invented Pine rule.
  const limits = { ...DEFAULT_OBJECT_LIMITS, ...(program.limits || {}), ...(ctx.limits || {}) }
  const pineVersion = Number.isFinite(program.pineVersion) ? program.pineVersion : 6
  for (const fam of OBJECT_FAMILIES) {
    if (!own(POOL_LIMITS, fam)) continue
    if (ctx.limits && ctx.limits[fam] !== undefined) continue   // an explicit test override wins
    const declared = (program.limits || {})[fam]
    limits[fam] = resolveCapacity(fam, declared === undefined ? null : declared, pineVersion).capacity
  }
  const barCount = Math.max(0, ctx.barCount | 0)
  const readNode = ctx.readNode || (() => NaN)
  const readParam = ctx.readParam || (() => undefined)
  const readTime = ctx.readTime || ((i) => i)
  /** ⭐⭐ C12 — A VALUE THE LANE CANNOT COMPUTE YET IS NOT A VALUE THAT IS `na`.
   *
   *  A `var` folds to `accum(seed, body, W)`, which is `NaN` on every bar before
   *  its warm-up (`interpret.js::runRecurrence`) — and Pine's `var` is a real
   *  number there. The two are the same `NaN` in a column, so a guard written
   *  `if pivHi >= prevHigh … else lh := true` takes its `else` on bar 222 and a
   *  label says "LH" where TradingView's says "HH" (measured,
   *  `market-structure-by-leviathan`, NYSE:RDDT 1D 2026-09-28). A missing
   *  object is a gap; a wrong one is a lie.
   *
   *  ⛔ SO AN OP THAT READS ANY SUCH NODE ON SUCH A BAR DOES NOT RUN — its guard,
   *  its coordinates and its text are all unknowable there, and the count of
   *  what was withheld is reported (`stats.withheldUnknown`), never hidden.
   *  `objectColumns.objectReaderFor` answers `readUnknown`; a caller with no
   *  bounded state (the runtime lane runs its `var`s from bar 0) passes none. */
  const readUnknown = typeof ctx.readUnknown === 'function' ? ctx.readUnknown : null
  const opNodes = new Map()
  const nodesOfOp = (op) => {
    let found = opNodes.get(op)
    if (found) return found
    // a loop's own bounds only — each body op is asked on its own when it runs
    found = graphNodesReferenced({ ops: [op.k === 'loop' ? { ...op, body: [] } : op] })
    opNodes.set(op, found)
    return found
  }
  const unknownAt = (op, bar) => {
    if (!readUnknown) return false
    for (const n of nodesOfOp(op)) if (readUnknown(n, bar)) return true
    return false
  }
  let withheldUnknown = 0
  /** ⭐ C22 — properties marked because their value read an unmeasured reduction. */
  let propsUnmeasured = 0

  /** instanceId → { family, id, site, createdBar, props } */
  const live = new Map()
  /** table instanceId → Map<"col,row", props> — cells are addressed, not listed */
  const cells = new Map()
  const regs = new Map((program.regs || []).map((r) => [r.id, null]))
  /** ⭐ C14 — scalars only getters write (`program.nums`), written in op order.
   *  ⛔ Where a getter can be answered exactly is the CONVERTER's ruling
   *  (`pine.js` `staleReads` / `statePass`): this runtime only holds them. */
  const nums = new Map((program.nums || []).map((n) => [n.id, n.init ?? NaN]))
  /** ⭐⭐ REGISTER HISTORY — what each register held at the END of each recent
   *  bar, newest last, for Pine's `l[n]` on a drawing variable (see
   *  `MAX_HANDLE_BACK`). ⛔ Sized by the deepest `back` the PROGRAM reads, so a
   *  program that never reads history keeps no ring at all. */
  const histDepth = deepestBack(program.ops)
  const regHist = histDepth > 0
    ? new Map((program.regs || []).map((r) => [r.id, []])) : null
  const colls = new Map((program.colls || []).map((c) => [c.id, []]))
  const collCap = new Map((program.colls || []).map((c) => [c.id, c.cap]))

  /** ⭐⭐ C17 — REGISTER TAINT: WHAT A WITHHELD OP WOULD HAVE WRITTEN IS UNKNOWN.
   *
   *  An op withheld on a bar because it reads the warm-up curtain
   *  (`readUnknown`), or because it reads something already tainted, is an op
   *  Pine may have run there. Whatever it would have written — a handle, a
   *  scalar, an object's properties, a list, a latch — is then not known to be
   *  what this run holds, so it is marked here, PER BAR and PER PROPERTY, and
   *  anything that later READS it is withheld on that bar in turn. A clean write
   *  (the op ran, and everything it read was known) clears the mark.
   *
   *  ⚰️ MEASURED on `rsi-swing-indicator` (NYSE:RDDT 1D, 2026-09-28): with the
   *  converter's blanket `state:lost` lifted, the run drew 8 labels / 8 lines
   *  whose x and y are TradingView's last 8 — and the first two label TEXTS and
   *  the first line's x2/y2 were WRONG, because they read `label.get_y` of labels
   *  Pine made before the curtain and this run never could. A missing object is
   *  a gap; a wrong one is a lie.
   *
   *  ⛔ KEYED ON "UNKNOWN AT THIS BAR", NEVER ON A BAR NUMBER. The curtain is
   *  whatever `readUnknown` answers (and a caller whose `var`s run from bar 0
   *  passes none), so a series that starts at the symbol's first bar makes the
   *  same ops known and the taint simply never forms.
   *
   *  ⭐ A GUARD-LEVEL read (a guard, a handle an op acts on, an address, a loop
   *  bound) withholds the op and taints its outputs. A VALUE read (a property a
   *  create or update writes, a scalar's source) lets the op run — Pine ran it —
   *  and taints only that property, so the NEXT reader of the clean ones is
   *  exact. ⛔ An object still carrying a tainted property at the end of the run
   *  is not drawn (`finish`): it is held, and counted, as withheld. */
  const regTaint = new Set()
  /** instanceId → Set<prop> | '*' ('*': its existence or every property). */
  const instTaint = new Map()
  const numTaint = new Set()
  /** A list whose length (and so every slot) is unknown. */
  const collLenTaint = new Set()
  /** Per list, a boolean per slot, kept in step with `colls`. */
  const collSlotTaint = new Map((program.colls || []).map((c) => [c.id, []]))
  /** table instanceId → Set<"col,row"> | '*'. */
  const cellTaint = new Map()
  /** A `var` initialiser withheld where it stood: Pine may already have run it. */
  const onceUnknown = new Set()
  /** A crossing stepped with an unknown operand: its carried pair is unknown
   *  through the NEXT bar. `cross` node → last bar it is unknown on. */
  const crossTaintUntil = new Map()
  const regHistTaint = regHist ? new Map((program.regs || []).map((r) => [r.id, []])) : null
  let withheldTainted = 0
  /** The graph nodes one value reads, once per value object. */
  const valueNodes = new WeakMap()
  const nodesOfValue = (v) => {
    let found = valueNodes.get(v)
    if (!found) { found = graphNodesReferenced({ ops: [{ k: 'setnum', when: v }] }); valueNodes.set(v, found) }
    return found
  }
  /** ⭐ THE FAST PATH: until the first mark forms, nothing can read one, so no
   *  op pays for asking. A run with no curtain (the runtime lane) never forms
   *  one. ⛔ Set by every writer of a mark below, never cleared. */
  let taintSeen = false
  const taintInst = (id, props) => {
    if (id === null || id === undefined || !live.has(id)) return
    const cur = instTaint.get(id)
    if (cur === '*') return
    taintSeen = true
    if (props === '*') { instTaint.set(id, '*'); return }
    if (!props.length) return
    const s = cur || new Set()
    for (const p of props) s.add(p)
    instTaint.set(id, s)
  }
  const cleanInstProp = (id, prop) => {
    const cur = instTaint.get(id)
    if (!cur || cur === '*') return
    cur.delete(prop)
    if (!cur.size) instTaint.delete(id)
  }
  const instPropTainted = (id, prop) => {
    const cur = instTaint.get(id)
    return !!cur && (cur === '*' || cur.has(prop))
  }
  /** A cell a clean clear removed is not drawn, so its mark goes with it. */
  const pruneCellTaint = (id, map) => {
    const cur = cellTaint.get(id)
    if (!cur || cur === '*') return
    for (const k of [...cur]) if (!map.has(k)) cur.delete(k)
    if (!cur.size) cellTaint.delete(id)
  }
  const taintCell = (id, key) => {
    if (id === null || id === undefined || !live.has(id)) return
    const cur = cellTaint.get(id)
    if (cur === '*') return
    taintSeen = true
    if (key === '*') { cellTaint.set(id, '*'); return }
    const s = cur || new Set()
    s.add(key)
    cellTaint.set(id, s)
  }
  const counts = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0]))
  const peak = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0]))
  /** How many objects Pine's collector cut, per family — see `collect` and
   *  `lostCreates` in `finish`. */
  const collectedBy = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0]))

  /** site ids whose ONCE create has already fired. ⭐ Pine's `var x = expr`
   *  initialises the first time the path is reached and never again. */
  const firedOnce = new Set()
  /** ⭐⭐ A CROSSING THAT READS OBJECT STATE, OBSERVED ONCE PER BAR.
   *
   *  `ta.crossunder(high, box1.get_bottom())` needs the getter's value on the
   *  PREVIOUS bar too, and the getter is a read of the register AS IT STANDS
   *  WHEN THE STATEMENT RUNS. So each `cross` node is stepped exactly once per
   *  bar, at its op's position in the op order — before any of that op's own
   *  skip rules — which is the columnar lane's rule for a `ta.*` in a guard
   *  (computed on every bar) applied to a value only the runtime holds.
   *  The previous pair is carried by `interpret`'s own `CARRIED2` step.
   *
   *  ⛔⛔ AN `na` OPERAND ANSWERS FALSE, NOT `na`. Pine's comparisons are false on
   *  `na`, so `ta.crossunder(high, na)` is `false` and `not` of it is `true`.
   *  MEASURED against TradingView 2026-09-27 (Zero-Lag, NYSE:RDDT 1D): its
   *  first "▲" label follows a box whose bottom is `na` (`ta.atr(200)` warming),
   *  so the `▼` arm above it evaluated FALSE there — an `na` there would have
   *  blocked the arm TradingView drew. */
  const crossAtoms = new Map()
  const crossState = new Map()
  const crossNodesOf = (op) => {
    let found = crossAtoms.get(op)
    if (found) return found
    found = []
    const walk = (v) => {
      if (!isObj(v)) return
      if (v.v === 'cross') found.push(v)
      if (Array.isArray(v.args) && (v.v === 'bool' || v.v === 'cmp' || v.v === 'cross')) v.args.forEach(walk)
    }
    walk(op.when)
    walk(op.cond)
    crossAtoms.set(op, found)
    return found
  }
  /** A guard operand as a number: `true`/`false` as 1/0, anything else not a
   *  finite-or-NaN number as NaN. */
  const numOf = (x) => (typeof x === 'number' ? x : x === true ? 1 : x === false ? 0 : NaN)
  let nextId = 1
  let created = 0; let updated = 0; let deleted = 0; let evicted = 0
  let writesToDeleted = 0; let opsExecuted = 0; let maxOpsInABar = 0
  /** Tables removed because a newer one was created at the same position — see
   *  `replaceTableAt`. Counted apart from `deleted`, which the SCRIPT did. */
  let tablesReplaced = 0
  /** Fills removed because a newer `linefill.new` named the same two lines, and
   *  fills never made because a line they name is not on the chart — see
   *  `fillBetween`. */
  let fillsReplaced = 0
  let fillsWithoutLines = 0
  /** ⭐ TEXT EVALUATIONS THAT CAME BACK WITHHELD — a `str.format` number no
   *  capture pins a rendering for (`formatMessageNumber` → `null`). The object's
   *  text is then `null` and the render state does not draw it. */
  let textsWithheld = 0
  // ⭐ C29 — history reads past the measured automatic buffer, withheld (not read).
  let atBeyondAuto = 0
  /** ⭐ CELLS REMOVED BY `table.clear`, counted separately from `deleted` —
   *  which counts OBJECTS. A dashboard that clears and rewrites every bar makes
   *  this number large and `deleted` zero, and conflating them would make both
   *  unreadable. */
  let cellsCleared = 0
  const events = []
  let status = OBJECT_STATUS.OK
  let reason = null

  const fail = (why) => {
    if (status === OBJECT_STATUS.OK) { status = OBJECT_STATUS.LIMIT_EXCEEDED; reason = why }
  }
  const runtimeError = (why) => {
    if (status === OBJECT_STATUS.OK) { status = OBJECT_STATUS.RUNTIME_ERROR; reason = why }
  }
  /** ⭐⭐ C9 — every `{v:'at'}` history read an op's values carry (see
   *  `MAX_BARS_BACK_CAP` in objectProgram.js), once per op. */
  const atAtoms = new Map()
  const atNodesOf = (op) => {
    let found = atAtoms.get(op)
    if (found) return found
    found = []
    const walk = (v) => {
      if (!isObj(v)) return
      if (v.v === 'at') found.push(v)
      if (Array.isArray(v.args)) v.args.forEach(walk)
    }
    for (const v of opValueRefs(op)) walk(v)
    for (const v of Object.values(op.props || {})) if (isObj(v) && !v.r) walk(v)
    atAtoms.set(op, found)
    return found
  }

  /**
   * ⭐⭐ THE ONE WAY AN OBJECT STOPS EXISTING.
   *
   * An explicit `*.delete()` and a quota EVICTION are two different reasons for
   * the same event, and they must leave the world in the same state. This is
   * that state, in one place:
   *
   *   · it leaves `live`, so nothing renders it
   *   · its table cells go with it
   *   · its family's slot is returned
   *   · ⛔ AND IT LEAVES EVERY REGISTER THAT NAMED IT. A register still holding
   *     the id is a handle to nothing, and the next write against it lands
   *     nowhere without a word — the "why did my update stop working" bug.
   *     That rule predates eviction; eviction now owes it too.
   *   · ⭐ A COLLECTION IS THE EXCEPTION, BY PINE'S RULE (C16): an `array<box>`
   *     keeps a deleted box's slot — see the note in the body.
   *
   * ⚠️ A SECOND COPY OF THIS IS THE DEFECT IT PREVENTS. Two teardown paths drift
   * the first time either is touched, and the half that forgets a container
   * fails silently rather than loudly.
   */
  /**
   * ⛔⛔ A LINEFILL IS NOT AN INDEPENDENT OBJECT — IT IS BOUND TO TWO LINES.
   *
   * Pine destroys a linefill when either of its lines is deleted, so the fill
   * count can never outrun the line count and Pine publishes no
   * `max_linefills_count` at all. This index is how that lifetime is enforced
   * here without walking every live object on each reap.
   *
   * ⚰️ MEASURED ON `liquidity-pools` AGAINST THE VENDOR CAPTURE, 2026-09-22:
   * the run REFUSED at bar 250 — "more than 500 live linefill objects" — while
   * only 74 lines were live. Five hundred fills hanging off seventy-four lines,
   * because reaping a line left its fills behind. The run then stopped
   * stepping, so every object it had drawn was older than 2025-04-15 on a
   * series running to 2026-09-11. That is the year-stale chart the vendor
   * comparison found, and it is NOT the line-cap defect RC-B fixed: the script
   * declares `max_lines_count=500` and never came close to it.
   */
  /**
   * ⛔⛔ WHICH FAMILIES EVICT AT THE CAP, AND WHY `linefill` IS HERE.
   *
   * `POOL_LIMITS` is Pine's own roster — the kinds with a `max_*_count` and a
   * documented FIFO. `linefill` is not one of them, and it is added anyway for
   * a MEASURED reason rather than a symmetry argument.
   *
   * ⚰️ `liquidity-pools`, against the vendor capture on 2026-09-22: our run
   * REFUSED at bar 250 on "more than 500 live linefill objects" and stopped
   * stepping, so nothing after 2025-04-15 was drawn on a series reaching
   * 2026-09-11. TradingView renders the same script across the whole window.
   * Pine publishes NO linefill ceiling, so whatever Pine does at 500 fills, it
   * certainly does not abandon the drawing — and abandoning it is the one
   * behaviour we could be sure was wrong.
   *
   * ⭐ So the house envelope stays (a runaway is still bounded) and its
   * behaviour at the ceiling changes from REFUSE to EVICT THE OLDEST, which is
   * what Pine does for every drawing family that does have a limit.
   *
   * ⛔ `table` is deliberately NOT here. Its ceiling is 8 — a number no honest
   * script approaches — so reaching it means something is wrong rather than
   * something is busy, and a refusal with a named reason is the useful answer.
   */
  const EVICTS = new Set([...Object.keys(POOL_LIMITS), 'linefill'])

  const fillsOfLine = new Map()
  const fillRefs = (inst) => {
    const p = inst.props || {}
    const out = []
    for (const k of ['line1', 'line2']) {
      const r = p[k]
      const id = r && typeof r === 'object' ? r.__ref : null
      if (Number.isFinite(id)) out.push(id)
    }
    return out
  }
  const indexFill = (inst) => {
    for (const lineId of fillRefs(inst)) {
      let s = fillsOfLine.get(lineId)
      if (!s) { s = new Set(); fillsOfLine.set(lineId, s) }
      s.add(inst.id)
    }
  }
  const unindexFill = (inst) => {
    for (const lineId of fillRefs(inst)) {
      const s = fillsOfLine.get(lineId)
      if (s) { s.delete(inst.id); if (s.size === 0) fillsOfLine.delete(lineId) }
    }
  }

  function reap(inst) {
    live.delete(inst.id)
    cells.delete(inst.id)
    // ⭐ C17 — a gone object carries no taint: nothing can draw or read it.
    instTaint.delete(inst.id)
    cellTaint.delete(inst.id)
    counts[inst.family] -= 1
    for (const [rid, held] of regs) if (held === inst.id) regs.set(rid, null)
    // ⭐⭐ C16 (2026-09-29) — A COLLECTION KEEPS THE HANDLE. Pine's
    // `box.delete(b)` (and its collector) ends the OBJECT and leaves every
    // `array<box>` exactly as it was: `array.size` is unchanged and the slot
    // still holds the — now dead — handle, which is why the corpus writes
    // `box.delete(array.shift(boxes))` and `box.delete(b)` + `array.remove(bs, i)`
    // as PAIRS. ⚰️ This used to splice the id out of every collection, so a
    // delete followed by the script's own `array.remove(bs, i)` removed TWO
    // elements, and `array.size` read one short of TradingView's for every
    // object deleted but not yet removed. A write through a dead slot is the
    // counted no-op every op already makes of a dead id (`writesToDeleted`).
    // ⭐ A fill leaves the index and takes nothing with it; a LINE takes every
    // fill that named it. The recursion is one level deep by construction — the
    // branch above returns before it can nest.
    if (inst.family === 'linefill') { unindexFill(inst); return }
    const fills = fillsOfLine.get(inst.id)
    if (!fills) return
    fillsOfLine.delete(inst.id)
    for (const fid of [...fills]) {
      const f = live.get(fid)
      if (f) reap(f)
    }
  }

  /**
   * The oldest live object of one family — Pine's next eviction victim.
   *
   * ⭐ INSERTION ORDER IS CREATION ORDER for a JS Map, and ids are minted
   * monotonically, so the first match walking `live` IS the oldest. That is the
   * same contract `line.all`/`box.all` publish (read-only, oldest first, index 0
   * is the next to go) — the order is a property of the structure rather than a
   * sort anyone has to keep correct.
   */
  function oldestOf(family) {
    for (const inst of live.values()) if (inst.family === family) return inst
    return null
  }

  /**
   * ⭐⭐ PINE'S COLLECTOR — BATCHED, AND IT SPARES TWO KINDS OF OBJECT.
   *
   * Measured against TradingView 2026-09-28 (`objectPool.GC_BATCH`, triage
   * class C7): nothing is collected until a create takes the family past
   * `capacity + 5`; then the OLDEST objects go, one at a time, until `capacity`
   * remain — except an object created on THIS bar, and one a drawing variable
   * holds right now. Both still count. So a bar that draws more than the cap
   * keeps every one of them, and a `var` box made on bar 0 outlives thousands
   * of newer ones.
   *
   * ⛔ CALLED AFTER THE NEW OBJECT IS LIVE AND BEFORE `op.into` IS WRITTEN.
   * In Pine the call runs before its assignment, so `l := label.new(…)` still
   * has the OLD label in `l` while the collector runs — it is spared this once.
   * Writing the register first would expose it one call early. ⚠️ That order is
   * Pine's evaluation order applied, NOT a measurement: no probe separates it
   * (the measured `var` case is a box nobody reassigns).
   *
   * ⚠️ "HOLDS" MEANS A REGISTER — a drawing variable's current value. An object
   * reachable only through a collection (`array.push(arr, box.new(…))`) or a
   * register's HISTORY (`l[1]`) is not spared: history is measured (probe C's
   * `cl[1]` labels are collected), collections are not (probe D's array-held
   * boxes never reach their trigger, so they cannot tell).
   *
   * ⚰️ UNTIL 2026-09-28 this was "evict the oldest before a create at the cap",
   * which kept exactly `capacity` and fitted three of six corpus rows.
   */
  function collect(family, bar) {
    const cap = limits[family]
    if (counts[family] <= collectsAbove(cap)) return
    const held = new Set()
    for (const id of regs.values()) if (id !== null && id !== undefined) held.add(id)
    for (const inst of live.values()) {
      if (counts[family] <= cap) break
      if (inst.family !== family || inst.createdBar === bar || held.has(inst.id)) continue
      reap(inst)
      evicted += 1
      collectedBy[family] += 1
      if (ctx.trace) events.push({ bar, k: 'evict', family, id: inst.id })
    }
  }

  /**
   * ⭐⭐ A TABLE IS PLACED AT ONE OF NINE POSITIONS, AND A NEW ONE AT AN
   * OCCUPIED POSITION REPLACES THE TABLE THAT WAS THERE.
   *
   * ⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-28 (NYSE:RDDT 1D, 632 bars): two
   * scripts create a table on EVERY bar without `var` —
   * `heat-map-seasons` (`table.new(position.bottom_center, …)`, vendor table id
   * 20193) and `ict-ipda-look-back` (`table.new("top_right", …)`, id 641) — and
   * TradingView holds exactly ONE table for each at the last bar. `artemis-
   * oscillator-pro` holds THREE, at three different positions. One per position
   * is the rule all three agree on; a FIFO of any depth ≥ 2 contradicts the first
   * two, and a global cap of 1 contradicts the third.
   *
   * ⚰️ WHAT THIS ENGINE DID INSTEAD: tables counted against the house envelope
   * (8) and the ninth REFUSED the run at bar 8 and stopped stepping — so on
   * `ict-ipda-look-back` every line and box the script draws after bar 8 was
   * lost, not just the tables.
   *
   * ⛔ ONLY WHEN THE POSITION IS KNOWN. A table whose position did not resolve
   * (a dropped prop — `posOf(input)` the reader cannot fold) is not guessed onto
   * a default; it keeps the old behaviour, envelope and refusal included. Both
   * sides are normalised through `position.` so `position.top_right` and the
   * string `"top_right"` — which Pine accepts interchangeably — name one slot.
   */
  const tablePosition = (props) => {
    const p = props ? props.position : undefined
    if (typeof p !== 'string' || !p) return null
    return p.replace(/^position\./, '')
  }
  function replaceTableAt(position, bar) {
    if (!position) return
    for (const inst of live.values()) {
      if (inst.family !== 'table' || tablePosition(inst.props) !== position) continue
      reap(inst)
      tablesReplaced += 1
      if (ctx.trace) events.push({ bar, k: 'replace', family: 'table', id: inst.id })
      return
    }
  }

  /**
   * ⭐⭐ `linefill.new(l1, l2)` — ONE FILL PER PAIR OF LINES, AND NONE WITHOUT THEM.
   *
   * Pine's manual (Fills → linefills): *"A pair of lines can only have one
   * linefill between them, so successive calls to linefill.new using the same
   * two lines will replace one linefill with another."* And a fill between lines
   * that are not on the chart fills nothing.
   *
   * ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
   * `liquidity-pools` calls `linefill.new(upper, lower)` on EVERY bar for two
   * `var` line pairs. The vendor holds 91 fills for its 182 lines — exactly one
   * per pair. We held 500: one per call, evicting through the house envelope,
   * plus a fill per bar between two `na` handles before the first swing.
   *
   * Returns `{skip: true}` when a line is not live (the create makes nothing and
   * its handle reads `na`), after removing the fill this one replaces.
   * ⛔ THE PAIR IS UNORDERED: `linefill.new(b, a)` names the same two lines.
   */
  function fillBetween(props, bar) {
    const ids = fillRefs({ props })
    const lines = ids.filter((id) => { const o = live.get(id); return o && o.family === 'line' })
    if (lines.length < 2 || lines[0] === lines[1]) {
      fillsWithoutLines += 1
      return { skip: true }
    }
    const [a, b] = lines
    const onA = fillsOfLine.get(a)
    for (const fid of onA ? [...onA] : []) {
      const f = live.get(fid)
      const other = f ? fillRefs(f) : []
      if (other.length === 2 && ((other[0] === a && other[1] === b) || (other[0] === b && other[1] === a))) {
        reap(f)
        fillsReplaced += 1
        if (ctx.trace) events.push({ bar, k: 'replace', family: 'linefill', id: f.id })
      }
    }
    return { skip: false }
  }

  // ⛔ THE BAR IS A PARAMETER NOW, NOT A LOOP VARIABLE. Everything below is
  // byte-for-byte what the `for` body was; the only change is who advances it.
  const stepBar = (bar) => {
    /** site id → instanceId created on THIS bar. ⭐ Cleared every bar, which is
     *  the whole meaning of a site reference: `line.new(...)` used inline names
     *  the object made now, never one made yesterday. */
    const siteNow = new Map()
    /** ⭐ C17 — site ids whose create was WITHHELD on this bar (`taintOutputs`). */
    const siteTaint = new Set()
    /** counter id → its value for the iteration being executed RIGHT NOW.
     *  ⛔ PER BAR, and cleared with the bar: a counter that outlived its loop
     *  would let a later op read a stale index and write the wrong row. */
    const loopVars = new Map()
    /** `cross` node → its answer on THIS bar (see `crossState`). */
    const crossNow = new Map()
    /** ⭐ C16 — latch id → its condition's answer where its `if` stands, this
     *  bar (this ITERATION inside a loop): `true`, `false` or `LATCH_UNKNOWN`. */
    const latches = new Map()
    let opsThisBar = 0

    /**
     * ⭐⭐ PINE'S `str.tostring` FORMAT — `#` AND `0` ARE DIFFERENT CHARACTERS.
     *
     * `#` is an OPTIONAL digit and `0` is a REQUIRED one, which is the whole
     * difference between the two formats the reachable corpus writes:
     *
     *     str.tostring(6.2,  '#.##')  ->  '6.2'      trailing zeros TRIMMED
     *     str.tostring(6.0,  '#.##')  ->  '6'        …and the point goes too
     *     str.tostring(1.007, '0.00') ->  '1.01'     always two decimals
     *     str.tostring(45.5,  '0.00') ->  '45.50'    a zero the author asked for
     *
     * ⚰⚰ THIS READ ONLY THE `#.##` FAMILY, and the `0.00` FAMILY FELL THROUGH
     * TO THE RAW NUMBER. Measured 2026-09-13 on `uncharted-volume-v2.pine`, whose
     * Volume cell is `str.tostring(volMult, '0.00')`: the dashboard drew
     * `Vol : 45.187M (1.0070985212342736x)` where the vendor draws
     * `Vol : 45.51M (1.05x)`. The old regex tested `^#*\.?(#*|0*)$`, which a
     * leading `0` cannot match, so the guard fired and returned `String(n)` —
     * the "honest fallback" doing seventeen significant figures inside a cell
     * eight characters wide. ⛔ A fallback that has never been SEEN is not a
     * fallback, it is an unreached branch, and this one was reached by two of
     * v2's four visible cells.
     *
     * ⛔ STILL NARROW, AND STILL HONEST ABOUT IT. A thousands separator
     * (`'#,###'`) is NOT implemented: ignoring the comma would print the right
     * digits in the wrong grouping, which is a number the author did not ask
     * for, so a format containing one falls back to the plain value exactly as
     * before. Nothing in the reachable 27 writes one.
     */
    const formatNumber = (n, fmt) => {
      if (!Number.isFinite(n)) return 'NaN'
      if (typeof fmt !== 'string' || !fmt) {
        // Pine's default: up to 10 significant digits, trailing zeros trimmed.
        return String(Number(n.toPrecision(10)))
      }
      // ⛔ THE WHOLE STRING MUST BE UNDERSTOOD. Stripping unknown characters and
      // formatting the remainder is how `'#,###'` would silently become `'####'`.
      if (!/^[#0]*(\.[#0]*)?$/.test(fmt)) return String(n)
      const dot = fmt.indexOf('.')
      const frac = dot < 0 ? '' : fmt.slice(dot + 1)
      const intPart = dot < 0 ? fmt : fmt.slice(0, dot)
      const max = Math.max(0, Math.min(10, frac.length))
      // Required decimals are the `0`s; Pine writes them contiguously after the
      // optional `#`s, and counting them is enough for either order.
      const min = Math.min(max, (frac.match(/0/g) || []).length)
      let out = n.toFixed(max)
      if (max > min) {
        // Trim only the OPTIONAL tail, never a digit the author demanded.
        out = out.replace(/0+$/, (z) => z.slice(0, Math.max(0, min - (max - z.length))))
        out = out.replace(/\.$/, '')
      }
      // `'00.0'` asks for a leading zero. Rare, but it is a request like any
      // other, and padding is the only way to answer it.
      const wantInt = (intPart.match(/0/g) || []).length
      if (wantInt > 1) {
        const neg = out.startsWith('-')
        const body = neg ? out.slice(1) : out
        const head = body.split('.')[0]
        if (head.length < wantInt) {
          out = (neg ? '-' : '') + '0'.repeat(wantInt - head.length) + body
        }
      }
      return out
    }

    const textOf = (t) => {
      if (!isObj(t)) return ''
      switch (t.t) {
        case 'lit': return t.s
        case 'num': {
          const n = Number(readNode(t.node, bar, loopVars))
          // ⭐⭐ `str.format`'s `{N}` — `null` when no capture pins what the
          // vendor would draw for THIS value. ⛔ Never a fallback to another
          // format: a withheld text is not drawn; a guessed one is drawn wrong.
          if (t.form === 'message') {
            const s = formatMessageNumber(n, t.fmt)
            if (s === null) textsWithheld += 1
            return s
          }
          return formatNumber(n, t.fmt)
        }
        // ⭐⭐ A VALUE THAT IS ALREADY TEXT. ⛔ A non-string answers the EMPTY
        // string, never `String(v)`: an `undefined` row would render the word
        // "undefined" into a dashboard cell, and a member reads that as data.
        case 'str': {
          const v = readNode(t.node, bar, loopVars)
          return typeof v === 'string' ? v : ''
        }
        // ⭐ A SYMBOL'S TEXT the binding could not settle (`bindObjectProgram`
        // replaces a settled one with a literal before it gets here) — withheld,
        // because the only honest spellings are the ones the binding holds.
        case 'sym':
          textsWithheld += 1
          return null
        // ⛔ ONE WITHHELD PART WITHHOLDS THE WHOLE TEXT — "+5x: " with its number
        // missing is a different text from the vendor's, not a shorter one.
        case 'cat': {
          const parts = (t.args || []).map(textOf)
          return parts.some((p) => p === null) ? null : parts.join('')
        }
        case 'if': return truthy(value(t.cond)) ? textOf(t.then) : textOf(t.else)
        // ⭐⭐ C32 — a number that moves per PASS (a loop counter's arithmetic, a
        // window element it picks), by the same `str.tostring` rules as `num`.
        // ⛔ A value this pass cannot say withholds the text, never an empty one.
        case 'val': {
          const n = value(t.v)
          if (typeof n !== 'number') { textsWithheld += 1; return null }
          return formatNumber(n, t.fmt)
        }
        default: return ''
      }
    }

    const colorOf = (c) => {
      if (!isObj(c)) return null
      if (c.c === 'lit') return c.hex
      if (c.c === 'if') return truthy(value(c.cond)) ? colorOf(c.then) : colorOf(c.else)
      // ⭐⭐ C20/C29 — A COLOUR THE RUNTIME LANE COMPUTED. ⚰️ C20 served it OPAQUE
      // only: the run's byte was `round(t × 2.55)` and TradingView's opacity is
      // `round((1 − t/100) × 255)` (`color.new(red, 70)`: 77 vs the byte's 76).
      // C29 made the byte the opacity's complement, so it is read exactly below.
      // ⛔ A create/update that asked for this colour and got `null` is HELD
      // (`unservedColour`), never drawn in a default.
      if (c.c === 'rt') {
        const v = value(c.v)
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) return null
        const u = unpackColor(v)
        if (u.transparencyByte === 0) return u.hex
        // ⭐⭐ C29 — THE RUN'S BYTE IS NOW THE COMPLEMENT OF TRADINGVIEW'S OPACITY
        // (`colours.js::transparencyToByte`, measured: `color.new(red, 70)` →
        // 0x4D = 77), so the vendor's `#RRGGBBAA` is read straight off it — a
        // gradient's truncated blend (0x4C) included, which no transparency
        // round trip could carry.
        const alpha = 255 - u.transparencyByte
        return u.hex + alpha.toString(16).padStart(2, '0').toUpperCase()
      }
      // ⭐⭐ C20 — `color.new(c, t)`: `c`'s colour with its transparency SET to
      // `t`, by the same formula a translate-time colour uses
      // (`withObjectTransparency`). ⛔ Only a whole transparency in 0..100 — the
      // vendor captures pin whole ones; a fraction, `na` or out-of-range value is
      // unmeasured and answers `null` (held).
      if (c.c === 'new') {
        // ⭐⭐ C29 — a FRACTIONAL transparency is Pine's truncated whole number
        // (`color.t(color.new(c, 70.5))` = 70, and 70.4 → 70, measured on
        // `vw-gradient-spy-1d-2026-09-30`); `na` or out of range is still held.
        const raw = value(c.t)
        const t = typeof raw === 'number' && Number.isFinite(raw) ? wholeTransparency(raw) : NaN
        if (!Number.isInteger(t) || t < 0 || t > 100) return null
        const base = colorOf(c.of)
        return base ? withObjectTransparency(base, t) : null
      }
      // ⭐⭐ C37 — `color.from_gradient(value, bottom, top, a, b)` on the HOST
      // lane: the three numbers are read where the drawing stands (this bar, this
      // pass) and blended by the vendor's measured curve (`fromGradient`,
      // `vw-gradient-spy-1d-2026-09-30`). ⛔ What that curve does not pin — an
      // `na` value or bound, `top == bottom`, an end that is not a plain colour
      // (a theme reference, an unserved one) — answers `null`: the object is
      // HELD (`unservedColour`), never painted an end it guessed.
      if (c.c === 'grad') {
        const a = objectHexToPacked(colorOf(c.a))
        const b = objectHexToPacked(colorOf(c.b))
        if (a === null || b === null) return null
        const num = (x) => (typeof x === 'number' ? x : NaN)
        const packed = fromGradient(num(value(c.v)), num(value(c.lo)), num(value(c.hi)), a, b)
        return packed === null ? null : packedToObjectHex(packed)
      }
      return null
    }
    /** ⭐ C20 — did a colour the program asked the RUNTIME for come back unserved?
     *  (A `lit`/`if` colour never answers `null`; only `rt`/`new`/`grad` can.) */
    const runtimeColourNode = (c, depth = 0) => isObj(c) && depth < 48 && (c.c === 'rt' || c.c === 'new' || c.c === 'grad'
      || (c.c === 'if' && (runtimeColourNode(c.then, depth + 1) || runtimeColourNode(c.else, depth + 1))))
    const unservedColour = (props, resolved) => Object.entries(props || {})
      .filter(([k, v]) => isObj(v) && v.v === 'color' && runtimeColourNode(v.node)
        && (resolved[k] === null || resolved[k] === undefined))
      .map(([k]) => k)

    const value = (ref) => {
      if (!isObj(ref)) return undefined
      switch (ref.v) {
        case 'const': return ref.value
        // ⭐ `loopVars` RIDES ALONG so a reader can answer a value that depends
        // on the ITERATION, not just the bar. An ordinary reader ignores it.
        case 'graph': return readNode(ref.node, bar, loopVars)
        case 'param': return readParam(ref.id)
        case 'bar': return bar
        // ⭐ THE LOOP COUNTER, supplied by the RUNTIME exactly as `bar` is.
        // ⛔ AN UNBOUND COUNTER IS `undefined`, NOT 0. A body op referencing a
        // loop id nothing declares would otherwise silently read row zero and
        // overwrite one cell N times — a table with one row where the author
        // wrote forty, and nothing anywhere saying so.
        case 'loop': return loopVars.has(ref.id) ? loopVars.get(ref.id) : undefined
        // ⭐⭐ ARITHMETIC OVER ADDRESSES — `table.cell(t, 0, r + 1, …)`, the
        // corpus idiom for a header row at 0 and data from 1.
        //
        // ⛔ A NON-NUMERIC OPERAND ANSWERS `undefined`, NEVER A COERCION.
        // JavaScript would happily give `undefined + 1 === NaN` and `"2" * 3
        // === 6`; both put a cell somewhere plausible and wrong. An address
        // this grammar cannot compute is an address it declines to guess, and
        // the op that reads it is skipped by the same finiteness checks that
        // already guard a coordinate.
        case 'op': {
          const a = value(ref.args[0])
          if (typeof a !== 'number' || !Number.isFinite(a)) return undefined
          // ⭐ C25 — `math.round` is the tree lane's (`POINTWISE`: a half AWAY
          // from zero), never `Math.round`, which sends -2.5 to -2.
          if (ref.args.length === 1) return ref.op === 'round' ? PW.round(a) : ref.op === '-' ? -a : a
          const b = value(ref.args[1])
          if (typeof b !== 'number' || !Number.isFinite(b)) return undefined
          if (ref.op === '+') return a + b
          if (ref.op === '-') return a - b
          if (ref.op === '*') return a * b
          // ⭐ C25 — Pine's `/` is fractional for ints too (`5 / 2` is 2.5);
          // a zero divisor answers `undefined`, the address this grammar declines.
          if (ref.op === '/') { const q = BINARY['/'](a, b); return Number.isFinite(q) ? q : undefined }
          return undefined
        }
        case 'time': return readTime(bar)
        // ⭐⭐ C9 — `x[e]` with a per-bar `e`: `x` on bar `bar - e`. The op was
        // checked before its values were read (`atCheck`), so here `e` is a
        // whole number in [0, limit); a bar before the first is `na`.
        case 'at': {
          // ⭐ C29 — `x[na]` is `x` on this bar (measured, `vw-offset-na`).
          const raw = numOf(value(ref.args[1]))
          const back = Number.isNaN(raw) ? 0 : raw
          const k = bar - back
          if (!Number.isInteger(k) || k < 0) return NaN
          const src = ref.args[0]
          if (src.v === 'bar') return k
          if (src.v === 'graph') return readNode(src.node, k, loopVars)
          return undefined
        }
        // ⛔⛔ TEXT AND COLOUR ARE EVALUATED PER BAR LIKE EVERYTHING ELSE. A
        // dashboard whose cells were computed once and reused would show the
        // first bar's numbers forever, which is the exact failure mode a
        // "tables are static chrome" shortcut produces.
        case 'text': return textOf(ref.node)
        case 'color': return colorOf(ref.node)
        // ⭐⭐ THE LIVE GUARD KINDS — see `LIVE_GUARD_KINDS` in objectProgram.js.
        // A getter reads the register as it stands NOW; an empty register, a
        // deleted object or a non-numeric property is `na`.
        case 'get': {
          const id = resolveRef(ref.target)
          const inst = id === null ? null : live.get(id)
          const x = inst && inst.props ? inst.props[ref.prop] : undefined
          return typeof x === 'number' ? x : NaN
        }
        // ⭐ C16 — `array.size(bs)`: the collection's length as it stands NOW,
        // dead and `na` slots included (Pine's count — see `reap`).
        case 'size': {
          const arr = colls.get(ref.coll)
          return arr ? arr.length : undefined
        }
        // ⛔ EVERY argument is evaluated — no short-circuit — so which operands
        // were read never depends on the values, exactly as the columnar lane.
        case 'bool': {
          const xs = ref.args.map((a) => numOf(value(a)))
          if (ref.op === 'not') return UNARY['!'](xs[0])
          const f = BINARY[ref.op === 'and' ? '&&' : '||']
          return xs.reduce((acc, x) => f(acc, x))
        }
        case 'cmp': return BINARY[ref.op](numOf(value(ref.args[0])), numOf(value(ref.args[1])))
        // ⭐ C16 — the `if`'s condition as it was evaluated ONCE, where it stands.
        case 'latch': {
          const x = latches.get(ref.id)
          return x === true ? 1 : x === false ? 0 : NaN
        }
        case 'cross': return crossNow.has(ref) ? crossNow.get(ref) : 0
        case 'num': return nums.get(ref.id) ?? NaN
        // ⭐⭐ C32 — `w.get(i)` of a bounded window by the loop counter: Pine index
        // `k` of `size` elements is newest-first slot `k` (unshift) or
        // `size − 1 − k` (push — index 0 is the oldest). ⛔ An index outside the
        // elements is where Pine STOPS the script (`array.get` out of bounds): a
        // runtime error, never an `na` cell.
        case 'wget': {
          const k = value(ref.args[0])
          const size = numOf(value(ref.args[1]))
          if (typeof k !== 'number' || !Number.isInteger(k) || !Number.isInteger(size)) return undefined
          if (k < 0 || k >= size) {
            runtimeError(`\`array.get\` index ${k} is out of bounds of an array of ${size} on bar ${bar} — TradingView stops the script there`)
            return undefined
          }
          const j = ref.order === 'unshift' ? k : size - 1 - k
          if (j < 0 || j >= ref.args.length - 2) return undefined
          return numOf(value(ref.args[2 + j]))
        }
        default: return undefined
      }
    }

    /** ⭐⭐ C9 — may this op's history reads run on this bar? Asked AFTER its
     *  guard: Pine evaluates `x[e]` only where the statement runs, so an `na` or
     *  out-of-range `e` on a bar the guard skips is nothing at all.
     *  'ok' · 'unknown' (withhold the op on this bar) · 'error' (Pine stops). */
    const atCheck = (op) => {
      for (const at of atNodesOf(op)) {
        // ⭐⭐ C29 (C9, measured 2026-09-30) — an `na` offset reads the CURRENT
        // bar: TradingView ran `close[na]` with no error and read the bar's own
        // close on all 100 na-offset bars (`vw-offset-na-spy-1d-2026-09-30`).
        const raw = numOf(value(at.args[1]))
        const back = Number.isNaN(raw) ? 0 : raw
        // ⭐⭐ C29 — with no `max_bars_back` declared, reach is measured to 399
        // (`AUTO_MAX_BARS_BACK`); past it TradingView's automatic buffer is not
        // measured, so the op is withheld on this bar — never stopped, never read.
        if (at.auto === true && Number.isInteger(back) && back >= at.limit) {
          atBeyondAuto += 1
          return 'unknown'
        }
        if (!Number.isInteger(back) || back < 0 || back >= at.limit) {
          runtimeError(`a history read \`x[${back}]\` on bar ${bar} is ${back < 0 ? 'a future bar'
            : !Number.isInteger(back) ? 'not a whole number of bars'
              : `past the script's max_bars_back (${at.limit})`} — TradingView stops the script there`)
          return 'error'
        }
        const k = bar - back
        const src = at.args[0]
        if (k >= 0 && src.v === 'graph' && readUnknown && readUnknown(src.node, k)) return 'unknown'
      }
      return 'ok'
    }

    /** ⭐ C11c — is this step's value unmeasured on this bar? (`op.withhold`: a
     *  window reduction over an `na` element or an empty window, whose answer
     *  no capture pins.) Withheld and counted, never run off a guess. */
    const withheldAt = (op) => op.withhold != null && truthy(value(op.withhold))
    /** ⭐⭐ C22 — the PROPERTIES whose value reads an unmeasured reduction on this
     *  bar (`op.propWithhold`, naming `op.propWithholdKeys`). The op runs — Pine
     *  ran it, so ids stay in Pine's order — and only these are marked (C17's
     *  value rule), so a later clean write of the same property clears them:
     *  trend-duration's `label.new(…, "…" + str.tostring(bullishCount.avg()))`
     *  over an empty window, re-texted by `set_text` in the same bar. */
    const unmeasuredProps = (op) => {
      if (op.propWithhold == null || !truthy(value(op.propWithhold))) return NO_PROPS
      taintSeen = true
      propsUnmeasured += op.propWithholdKeys.length
      return op.propWithholdKeys
    }

    /** Does this guard read a latch whose condition was unknowable? */
    const readsUnknownLatch = (v, depth = 0) => {
      if (!isObj(v) || v.v === 'graph' || v.v === 'tree' || depth > 32) return false
      if (v.v === 'latch') return latches.get(v.id) === LATCH_UNKNOWN
      return Array.isArray(v.args) && v.args.some((a) => readsUnknownLatch(a, depth + 1))
    }

    /** Step every crossing in this op's guard, once, for this bar. */
    const observeCrossings = (op) => {
      for (const node of crossNodesOf(op)) {
        let st = crossState.get(node)
        if (!st) { st = [NaN, NaN]; crossState.set(node, st) }
        const a = numOf(value(node.args[0]))
        const b = numOf(value(node.args[1]))
        const step = (node.dir === 'over' ? CARRIED2.crossOver : CARRIED2.crossUnder).step
        const r = step(st, 0, a, b)
        crossNow.set(node, Number.isNaN(r) ? 0 : r)
        // ⭐ C17 — an unknown operand makes this bar's answer AND the pair it
        // carries into the next bar unknown.
        if ((readUnknown || taintSeen) && (valueUnknown(node.args[0]) || valueUnknown(node.args[1]))) {
          taintSeen = true
          crossTaintUntil.set(node, bar + 1)
        }
      }
    }

    const resolveRef = (r) => {
      if (!isObj(r)) return null
      switch (r.r) {
        case 'reg': {
          if (!r.back) return regs.get(r.id) ?? null
          // ⭐ `l[n]` — the id the register held n bars ago. The object may
          // have been deleted since; every op on a dead id is already a no-op
          // (`writesToDeleted`), which is Pine's rule for a deleted drawing.
          const h = regHist && regHist.get(r.id)
          if (!h || h.length < r.back) return null
          return h[h.length - r.back] ?? null
        }
        case 'site': return siteNow.get(r.id) ?? null
        case 'coll': {
          const arr = colls.get(r.id)
          if (!arr) return null
          const i = Number(value(r.index))
          if (!Number.isInteger(i) || i < 0 || i >= arr.length) return null
          return arr[i]
        }
        default: return null
      }
    }

    const resolveProps = (props, out) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (isObj(v) && v.r) {
          const inst = resolveRef(v)
          out[k] = inst === null ? null : { __ref: inst }
        } else {
          out[k] = value(v)
        }
      }
      return out
    }

    // ── ⭐⭐ C17 — READING THE TAINT (see `regTaint` above) ──────────────────
    /** Is this handle unknown on this bar? A register whose last write was
     *  withheld, its history on a bar it was, a site whose create was withheld,
     *  a list slot (or whole list) a withheld op may have changed. */
    const refTainted = (r, depth = 0) => {
      if (!isObj(r) || depth > 48) return false
      switch (r.r) {
        case 'reg': {
          if (!r.back) return regTaint.has(r.id)
          const h = regHistTaint && regHistTaint.get(r.id)
          if (!h || h.length < r.back) return false
          return h[h.length - r.back] === true
        }
        case 'site': return siteTaint.has(r.id)
        case 'coll': {
          if (collLenTaint.has(r.id) || tainted(r.index, depth + 1)) return true
          const i = Number(value(r.index))
          const s = collSlotTaint.get(r.id)
          return !!s && Number.isInteger(i) && s[i] === true
        }
        default: return false
      }
    }
    const textTainted = (t, depth) => {
      if (!isObj(t) || depth > 48) return false
      if (t.t === 'if') return tainted(t.cond, depth + 1) || textTainted(t.then, depth + 1) || textTainted(t.else, depth + 1)
      if (t.t === 'cat') return (t.args || []).some((a) => textTainted(a, depth + 1))
      if (t.t === 'val') return tainted(t.v, depth + 1)
      return false
    }
    const colorTainted = (c, depth) => {
      if (!isObj(c) || depth > 48) return false
      if (c.c === 'if') return tainted(c.cond, depth + 1) || colorTainted(c.then, depth + 1) || colorTainted(c.else, depth + 1)
      if (c.c === 'rt') return tainted(c.v, depth + 1)
      if (c.c === 'new') return colorTainted(c.of, depth + 1) || tainted(c.t, depth + 1)
      if (c.c === 'grad') {
        return tainted(c.v, depth + 1) || tainted(c.lo, depth + 1) || tainted(c.hi, depth + 1)
          || colorTainted(c.a, depth + 1) || colorTainted(c.b, depth + 1)
      }
      return false
    }
    /** Does this value read anything tainted? (Graph columns on the warm-up
     *  curtain are `readUnknown`'s, asked per op by `unknownAt`.) */
    const tainted = (v, depth = 0) => {
      if (!taintSeen || !isObj(v) || depth > 48) return false
      if (v.r) return refTainted(v, depth)
      switch (v.v) {
        case 'num': return numTaint.has(v.id)
        case 'size': return collLenTaint.has(v.coll)
        case 'latch': return latches.get(v.id) === LATCH_UNKNOWN
        case 'cross': return (crossTaintUntil.get(v) ?? -1) >= bar
        case 'get': {
          if (refTainted(v.target, depth + 1)) return true
          const id = resolveRef(v.target)
          return id !== null && instPropTainted(id, v.prop)
        }
        case 'text': return textTainted(v.node, depth + 1)
        case 'color': return colorTainted(v.node, depth + 1)
        // ⭐ C11c — an `and` with a KNOWN false operand is known false whatever
        // the unknown one holds (`logical`: a false or `na` operand makes the
        // result falsy either way) — the same certainty C17's known-false
        // guard skip rests on. ⚰️ Measured on pro-trading-art: `ta.crossunder(
        // close, topLine.get_y2()) and extendSignal` (an input, false) latched
        // UNKNOWN whenever `topLine` was, withheld the `set_x2` Pine never ran
        // and blanked TradingView's first double-top line. ⛔ Not `or`: a true
        // operand beside an `na` one is `na`, not true.
        case 'bool':
          if (v.op === 'and' && Array.isArray(v.args)
              && v.args.some((a) => !valueUnknown(a) && !truthy(numOf(value(a))))) return false
          return Array.isArray(v.args) && v.args.some((a) => tainted(a, depth + 1))
        default: return Array.isArray(v.args) && v.args.some((a) => tainted(a, depth + 1))
      }
    }
    /** A value that is tainted OR reads a graph column the curtain withholds. */
    const valueUnknown = (v) => {
      if (tainted(v)) return true
      if (!readUnknown || !isObj(v)) return false
      for (const n of nodesOfValue(v)) if (readUnknown(n, bar)) return true
      return false
    }
    const guardTainted = (op) => {
      if (!taintSeen) return false
      if (op.once && onceUnknown.has(op.site)) return true
      if (op.requiresLive && regTaint.has(op.requiresLive)) return true
      if (op.requiresEmpty && regTaint.has(op.requiresEmpty)) return true
      for (const f of GUARD_FIELDS) if (op[f] != null && tainted(op[f])) return true
      if (op.target && refTainted(op.target)) return true
      // a handle a property names (a linefill's two lines) decides what exists
      for (const v of Object.values(op.props || {})) if (isObj(v) && v.r && refTainted(v)) return true
      for (const at of atNodesOf(op)) if (tainted(at.args[1])) return true
      return false
    }
    /** The objects an op on `r` may act on: the one it resolves to, or — a
     *  list whose length or index is unknown — every object in the list. */
    const targetsOf = (r) => {
      if (!isObj(r)) return []
      if (r.r === 'coll' && (collLenTaint.has(r.id) || valueUnknown(r.index))) {
        return (colls.get(r.id) || []).filter((x) => x !== null && x !== undefined)
      }
      const id = resolveRef(r)
      return id === null || id === undefined ? [] : [id]
    }
    /** ⭐ WHAT A WITHHELD OP WOULD HAVE WRITTEN BECOMES UNKNOWN. A create keeps
     *  the register's old value (Pine's guard may have been false) but marks it;
     *  an update or delete marks whatever the handle holds now. */
    const taintOutputs = (op) => {
      taintSeen = true
      switch (op.k) {
        case 'create':
          if (op.into) regTaint.add(op.into)
          if (op.once) onceUnknown.add(op.site)
          siteTaint.add(op.site)
          break
        case 'update':
          for (const id of targetsOf(op.target)) taintInst(id, Object.keys(op.props || {}))
          break
        case 'delete':
          for (const id of targetsOf(op.target)) taintInst(id, '*')
          break
        case 'cell':
        case 'cellpatch': {
          const known = !valueUnknown(op.col) && !valueUnknown(op.row)
          const c = known ? Number(value(op.col)) : NaN
          const r = known ? Number(value(op.row)) : NaN
          const key = Number.isInteger(c) && Number.isInteger(r) ? `${c},${r}` : '*'
          for (const id of targetsOf(op.target)) taintCell(id, key)
          break
        }
        case 'mergecells':
        case 'clear':
        case 'clearcells':
          for (const id of targetsOf(op.target)) taintCell(id, '*')
          break
        case 'setreg': regTaint.add(op.reg); break
        case 'setnum': numTaint.add(op.num); break
        case 'push':
        case 'collset':
        case 'collremove':
        case 'collclear':
          collLenTaint.add(op.coll)
          break
        case 'loop': for (const b of op.body || []) taintOutputs(b); break
        case 'latch': latches.set(op.id, LATCH_UNKNOWN); break
        default: break
      }
    }
    /** Withhold one op on this bar, marking what it would have written. */
    const withholdTainted = (op) => { withheldTainted += 1; taintOutputs(op) }
    /** The properties of an op's props whose VALUE is unknown. */
    const taintedProps = (props) => (!taintSeen ? NO_PROPS : Object.entries(props || {})
      .filter(([, v]) => isObj(v) && !v.r && tainted(v)).map(([k]) => k))

    /** Execute a list of ops in order. Answers FALSE when the bar's envelope is
     *  spent, so a loop stops the whole bar rather than its own body only.
     *
     *  ⭐⭐ RE-ENTRANT BECAUSE A LOOP CONTAINS OPS. This was a flat `for` over
     *  `program.ops`, which is why a loop could not be an operation at all. */
    const runOps = (list) => {
    for (const op of list) {
      // ⭐ A guard that reads object state steps its crossings HERE, at the op's
      // own position and before any skip below — once per bar, every bar.
      if ((op.when && op.when.v !== 'graph' && op.when.v !== 'tree') || op.cond) observeCrossings(op)
      // ⭐⭐ C16 — A LATCH: the `if`'s object-state condition, evaluated ONCE,
      // here, before any op of its block runs (Pine evaluates it once). An
      // unknowable condition (the warm-up curtain) is remembered as unknown, and
      // every op reading it is withheld and counted below, never run off a guess.
      if (op.k === 'latch') {
        const latched = unknownAt(op, bar) || withheldAt(op) || tainted(op.cond) ? LATCH_UNKNOWN : truthy(value(op.cond))
        if (latched === LATCH_UNKNOWN) taintSeen = true
        latches.set(op.id, latched)
        continue
      }
      // ⭐⭐ `barstate.islast` LIVES HERE, AS A FLAG, NOT AS A GRAPH NODE.
      // Pine's own idiom for a dashboard is "draw it once, on the newest bar",
      // and an object program is a picture of the chart as it stands — so this
      // is exactly answerable. It is a flag rather than a value so that it can
      // never leak into a tree, a hash or a screener column, where "the last
      // bar" would depend on how many bars the caller asked for.
      if (op.lastBarOnly && bar !== barCount - 1) continue
      // ⭐⭐ `var x = <expr>` RUNS ONCE. Without this a `var table t =
      // table.new(…)` mints a new table on every bar — 300 bars, 300 tables,
      // the envelope exceeded, the whole indicator refused. It is the
      // commonest object initialiser in the corpus.
      if (op.once && firedOnce.has(op.site)) continue
      // ⭐ `not na(l)` / `na(l)` are LIVENESS tests on a handle, answered here
      // because only the runtime holds the registers. They are flags rather
      // than values so that object state can never leak into the pure graph.
      // ⭐ C17 — a liveness test on a handle that is itself unknown answers
      // nothing: the op is withheld below, never skipped as if it were certain.
      const handleUnknown = (op.requiresLive && regTaint.has(op.requiresLive))
        || (op.requiresEmpty && regTaint.has(op.requiresEmpty))
      if (!handleUnknown && op.requiresLive && regs.get(op.requiresLive) === null) continue
      if (!handleUnknown && op.requiresEmpty && regs.get(op.requiresEmpty) !== null) continue
      if (unknownAt(op, bar) || readsUnknownLatch(op.when)) {
        // ⭐ C17 — a guard that is itself KNOWN and false is a certain skip:
        // Pine did not run the op either, so nothing it would write is unknown.
        if (op.when != null && !valueUnknown(op.when) && !truthy(value(op.when))) continue
        withheldUnknown += 1
        taintOutputs(op)
        continue
      }
      // ⭐⭐ C11c — a step whose value reads an UNMEASURED window reduction on this
      // bar (`op.withhold`) is withheld, and — C17's rule — marks everything it
      // would have written. ⛔ No known-false shortcut: its guard may itself read
      // the reduction, so its falseness is as unmeasured as its value.
      if (withheldAt(op)) { withheldUnknown += 1; taintOutputs(op); continue }
      // ⭐⭐ C17 — whether it runs, or what it acts on, reads a tainted value.
      if (handleUnknown || guardTainted(op)) { withholdTainted(op); continue }
      if (op.when != null && !truthy(value(op.when))) continue
      if (op.k !== 'loop') {
        const at = atCheck(op)
        if (at === 'error') return false
        if (at === 'unknown') { withheldUnknown += 1; taintOutputs(op); continue }
      }
      opsThisBar += 1
      opsExecuted += 1
      if (opsThisBar > limits.opsPerBar) {
        fail(`more than ${limits.opsPerBar} object operations on bar ${bar}`)
        return false
      }

      switch (op.k) {
        // ⭐⭐ THE LOOP. Pine's `for i = from to to` is INCLUSIVE at both ends
        // and counts DOWN when `to < from`, which is why the step is derived
        // rather than assumed — `for i = n to 0` is a real and common idiom and
        // an ascending-only reader draws nothing for it, silently.
        case 'loop': {
          const from = Number(value(op.from))
          const to = Number(value(op.to))
          // ⛔ A BOUND THAT IS NOT A NUMBER RUNS ZERO TIMES, NEVER "from 0".
          // `array.size(syms) - 1` on a bar before the array is filled is `na`,
          // and treating that as 0 would draw a row of blanks that looks like
          // data. Drawing nothing is the honest answer for a list that is empty.
          if (!Number.isFinite(from) || !Number.isFinite(to)) break
          // ⭐ `by <step>`: Pine steps by the step's SIZE in the direction
          // `from → to` takes. ⛔ A step that is not a positive finite number
          // runs ZERO times — `by 0` would never end, and a guessed 1 would
          // draw rows the author wrote the step to skip.
          const size = op.step === undefined ? 1 : Math.abs(Number(value(op.step)))
          if (!Number.isFinite(size) || size <= 0) break
          const step = to >= from ? size : -size
          const had = loopVars.has(op.id)
          const prev = loopVars.get(op.id)
          let ok = true
          for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
            loopVars.set(op.id, n)
            if (!runOps(op.body)) { ok = false; break }
          }
          // ⛔ RESTORED, NOT DELETED. Nested loops over the same id are
          // pathological but legal, and clearing unconditionally would leave an
          // outer counter unbound for the rest of its own body.
          if (had) loopVars.set(op.id, prev); else loopVars.delete(op.id)
          if (!ok) return false
          break
        }
        case 'create': {
          // ⭐⭐ PINE EVICTS THE OLDEST. IT DOES NOT REFUSE.
          //
          // ⚰️⚰️ THIS BRANCH USED TO `fail(...)` AND STOP CREATING, which keeps
          // the OLDEST objects — the exact opposite of Pine, which deletes the
          // oldest to make room for the newest. Measured against TradingView
          // 2026-09-23: `liquidity-pools` held lines whose newest was
          // 2025-04-09 against a series running to 2026-09-11, while the vendor
          // held the newest 90. Zero overlap. Every count looked healthy and the
          // chart was a year stale.
          //
          // ⛔ THE EVICTION USES THE SAME TEARDOWN AS `delete`, and that is not
          // tidiness. An object can stop existing two ways now, and an evicted
          // one must leave every register and collection that named it exactly
          // as a deleted one does — otherwise a handle points at nothing and the
          // next write lands nowhere, silently. One `reap`, two callers.
          // ⛔⛔ ONLY THE FAMILIES PINE ACTUALLY POOLS EVICT. `POOL_LIMITS` is
          // the roster of kinds with a `max_*_count` parameter and a documented
          // FIFO — line, label, box, polyline. A family with no vendor rule
          // (table, linefill) keeps the house envelope's hard refusal, because
          // we have no evidence about what the vendor does there and inventing
          // an eviction rule is the same substitution this whole fix exists to
          // undo: satisfying a Pine concept with a locally-reasonable primitive
          // that RESEMBLES it.
          // ⚰️ Written family-agnostic at first, which silently made TABLES
          // evict too and turned the envelope's refusal into dead code.
          // ⭐ Resolved BEFORE the capacity test, because for a table the new
          // object's own position decides whether an old one leaves first.
          const props = resolveProps(op.props, {})
          if (op.family === 'table') replaceTableAt(tablePosition(props), bar)
          if (op.family === 'linefill' && fillBetween(props, bar).skip) {
            // ⭐ `linefill.new` with a line that is not there returns `na`: the
            // handle it was assigned to is cleared, exactly as a create that
            // never happened leaves it.
            if (op.into) { regs.set(op.into, null); regTaint.delete(op.into) }
            // ⛔ A `var` initialiser runs ONCE whatever it returned — `var lf =
            // linefill.new(na, na)` is `na` for good, not retried until lines
            // appear.
            if (op.once) firedOnce.add(op.site)
            break
          }
          const pooled = EVICTS.has(op.family)
          // ⭐ Pine's own families collect AFTER the create (`collect` below);
          // only `linefill` — the house envelope, no vendor rule — still evicts
          // the oldest BEFORE one.
          const pineCollected = own(POOL_LIMITS, op.family)
          while (pooled && !pineCollected && counts[op.family] >= limits[op.family]) {
            const victim = oldestOf(op.family)
            // ⛔ NOTHING TO EVICT AND STILL OVER THE CAP is not a script error,
            // it is a contradiction in our own bookkeeping — say so rather than
            // spin.
            if (victim === null) {
              fail(`more than ${limits[op.family]} live ${op.family} objects (bar ${bar})`)
              break
            }
            reap(victim)
            evicted += 1
            if (ctx.trace) events.push({ bar, k: 'evict', family: op.family, id: victim.id })
          }
          // ⛔ STILL AT THE CAP MEANS TWO DIFFERENT THINGS, AND ONLY ONE IS
          // SILENT. A POOLED family that is still full here already called
          // `fail` above (the victim-less contradiction), so it must not be
          // reported twice. A NON-POOLED family never entered the loop at all
          // and this is its refusal — without the `fail`, it would simply stop
          // creating and report `ok`, which is a script drawing less than it
          // asked for with nothing saying so.
          if (!pineCollected && counts[op.family] >= limits[op.family]) {
            if (!pooled) fail(`more than ${limits[op.family]} live ${op.family} objects (bar ${bar})`)
            break
          }
          const id = nextId
          nextId += 1
          const inst = {
            family: op.family, id, site: op.site, createdBar: bar, props,
          }
          live.set(id, inst)
          // ⭐ C17 — Pine made this object here; a property whose VALUE read
          // something tainted is what stays unknown on it (C22: or read an
          // unmeasured reduction on this bar).
          { const um = unmeasuredProps(op); taintInst(id, um.length ? [...taintedProps(op.props), ...um] : taintedProps(op.props)) }
          // ⭐ C20 — a colour asked of the runtime that it could not serve exactly
          // (transparent, or a transparency this engine has not measured) holds
          // the object: drawn in a default colour it would be a colour Pine did
          // not paint.
          { const unserved = unservedColour(op.props, props); if (unserved.length) taintInst(id, unserved) }
          if (op.into) regTaint.delete(op.into)
          // ⭐ A fill records which lines own it AT CREATE, because that is the
          // only moment both refs are resolved. `linefill.set_color` is the only
          // update Pine offers and it cannot move a fill to different lines, so
          // there is no re-index path to keep in step.
          if (op.family === 'linefill') indexFill(inst)
          counts[op.family] += 1
          if (counts[op.family] > peak[op.family]) peak[op.family] = counts[op.family]
          if (pineCollected) collect(op.family, bar)
          siteNow.set(op.site, id)
          if (op.once) firedOnce.add(op.site)
          if (op.into) regs.set(op.into, id)
          created += 1
          if (ctx.trace) events.push({ bar, k: 'create', family: op.family, id, site: op.site })
          break
        }
        case 'update': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          resolveProps(op.props, inst.props)
          // ⭐ C17 — a clean write clears its property; a tainted value marks it.
          const um = unmeasuredProps(op)
          if (taintSeen) {
            const bad = new Set([...taintedProps(op.props), ...um])
            for (const k of Object.keys(op.props || {})) {
              if (bad.has(k)) taintInst(inst.id, [k]); else cleanInstProp(inst.id, k)
            }
          }
          { const unserved = unservedColour(op.props, inst.props); if (unserved.length) taintInst(inst.id, unserved) }
          updated += 1
          if (ctx.trace) events.push({ bar, k: 'update', id: inst.id })
          break
        }
        // ⭐⭐ `table.cell(…)` AND `table.cell_set_*(…)` — TWO PINE OPERATIONS,
        // ONE ADDRESS SHAPE, AND THEY ARE KEPT APART ON PURPOSE.
        //
        // Pine's reference is explicit (quoted at
        // `docs/pine/pine-presentation-spec.md:1630`): `table.cell()` OVERWRITES
        // every previously defined property of a cell — call it twice, the
        // second time naming only `text_color`, and the text you set the first
        // time is gone, because `text` defaults to `""`. `table.cell_set_*()` is
        // the patch you use when that is not what you meant.
        //
        // ⚠️⚠️ AND THIS RUNTIME MERGES BOTH, WHICH IS A FOURTH FIDELITY GAP.
        // `map.get(key) || {}` below makes `cell` a patch too, so today the two
        // kinds behave identically and no test in the repo can tell them apart.
        // That is PRE-EXISTING and is not fixed in this change: turning `cell`
        // into a true replace changes what every already-imported script draws
        // and needs its own evidence. ⛔ The kinds stay distinct anyway — the
        // day `cell` becomes a replace is the day a `cell_set_text` modelled as
        // a `cell` would wipe the colours off the row it was only asked to
        // relabel, and a shared kind would make that a one-line silent
        // regression instead of a decision.
        //
        // ⚠️ A PATCH TO A CELL NEVER WRITTEN CREATES IT, and the reference does
        // not say whether TradingView agrees — `docs/pine/lwc5-capability-map.md:858`
        // files it as open question A7, noting that `merge_cells` explicitly
        // DOES work on undefined cells. We follow that lean. It is mostly
        // invisible either way: `cellIsDrawn` needs text or a background, so a
        // lone `cell_set_text_color` on an empty address still paints nothing.
        case 'cell':
        case 'cellpatch': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          const col = Number(value(op.col))
          const row = Number(value(op.row))
          if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) break
          let map = cells.get(inst.id)
          if (!map) { map = new Map(); cells.set(inst.id, map) }
          const key = `${col},${row}`
          const cur = map.get(key) || {}
          map.set(key, resolveProps(op.props, cur))
          // ⭐ C17 — a cell written from a tainted value is unknown; a whole
          // `table.cell` written clean is known again (a patch is only part of it).
          const um = unmeasuredProps(op)
          if (!taintSeen) { /* nothing marked yet: nothing to mark or clear */ } else if (um.length || taintedProps(op.props).length) taintCell(inst.id, key)
          else if (op.k === 'cell') {
            const ct = cellTaint.get(inst.id)
            if (ct && ct !== '*') { ct.delete(key); if (!ct.size) cellTaint.delete(inst.id) }
          }
          updated += 1
          if (ctx.trace) events.push({ bar, k: op.k, id: inst.id, col, row })
          break
        }
        // ⭐⭐ `table.clear(t, c0, r0, c1, r1)` — A RECTANGLE OF CELLS REMOVED.
        //
        // ⚰️ FOR THE WHOLE OF C3B THIS OPERATION DID NOT EXIST, and the Pine
        // idiom it serves is "clear the block, then write today's rows". With
        // the clear missing, a list of eight rows yesterday and three today
        // drew three fresh rows over five stale ones — last bar's numbers, in
        // the same colours, with nothing saying they were old.
        //
        // ⛔⛔ THE WALK IS OVER THE CELLS THAT EXIST, NOT OVER THE RECTANGLE.
        // Iterating `for (c = c0; c <= c1; c++)` reads the author's numbers as
        // a loop bound, and `table.clear(t, 0, 0, 1e9, 1e9)` — which is legal
        // Pine and costs its author nothing — would then hang the browser tab
        // on a table holding four cells. A map walk is bounded by what was
        // actually written, so the cost is the table's size and never the
        // range's.
        //
        // ⛔ THE RANGE IS INCLUSIVE AT BOTH ENDS (`pine-presentation-spec.md`
        // C117: `table.clear(t, 2, 3)` clears exactly cell (2,3)), and an
        // INVERTED rectangle clears nothing. ⚠️ That second point is OUR ruling
        // on something the reference does not state: it documents `start_*` as
        // the top-left and `end_*` as the bottom-right and says nothing about
        // an author who swaps them. `box` normalises top/bottom because Pine
        // documents that it draws the same box either way; there is no such
        // sentence here, so normalising would invent one. Clearing nothing is
        // the direction that cannot destroy a cell the author still wanted.
        // ⭐⭐ `table.merge_cells(t, c0, r0, c1, r1)` — THE RECTANGLE BECOMES ONE
        // CELL. The top-left cell carries the span (`colspan`, `rowspan`) and
        // every covered address becomes a cell of its own — empty unless written —
        // because that is what TradingView holds: `momentum-volatility-scanner`'s
        // capture records (0,0) with colspan 2 and (1,0) as an empty cell.
        // ⛔ AN INVERTED OR ONE-CELL RECTANGLE MERGES NOTHING, and a rectangle
        // outside the table's own declared size merges nothing either (Pine
        // raises there); the area is also capped, so an unbounded pair of
        // arguments can never walk a million addresses.
        case 'mergecells': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          const c0 = Number(value(op.col))
          const r0 = Number(value(op.row))
          const c1 = Number(value(op.col2))
          const r1 = Number(value(op.row2))
          if (![c0, r0, c1, r1].every((n) => Number.isInteger(n) && n >= 0)) break
          if (c1 < c0 || r1 < r0 || (c1 === c0 && r1 === r0)) break
          const cols = inst.props && inst.props.columns
          const rows = inst.props && inst.props.rows
          if ((Number.isInteger(cols) && c1 >= cols) || (Number.isInteger(rows) && r1 >= rows)) break
          if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_MERGE_AREA) break
          let map = cells.get(inst.id)
          if (!map) { map = new Map(); cells.set(inst.id, map) }
          for (let r = r0; r <= r1; r += 1) {
            for (let c = c0; c <= c1; c += 1) {
              const key = `${c},${r}`
              if (!map.has(key)) map.set(key, {})
            }
          }
          const head = `${c0},${r0}`
          map.set(head, { ...map.get(head), colspan: c1 - c0 + 1, rowspan: r1 - r0 + 1 })
          updated += 1
          if (ctx.trace) events.push({ bar, k: 'mergecells', id: inst.id })
          break
        }
        case 'clearcells': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          const c0 = Number(value(op.col))
          const r0 = Number(value(op.row))
          const c1 = Number(value(op.col2))
          const r1 = Number(value(op.row2))
          if (![c0, r0, c1, r1].every((n) => Number.isInteger(n) && n >= 0)) break
          const map = cells.get(inst.id)
          if (!map) break
          for (const key of [...map.keys()]) {
            const at = key.split(',')
            const c = Number(at[0])
            const r = Number(at[1])
            if (c >= c0 && c <= c1 && r >= r0 && r <= r1) {
              map.delete(key)
              cellsCleared += 1
            }
          }
          pruneCellTaint(inst.id, map)
          if (ctx.trace) events.push({ bar, k: 'clearcells', id: inst.id })
          break
        }
        // ⭐⭐ THE RECTANGLE THE AUTHOR REMOVED. Pine's `table.clear` takes an
        // INCLUSIVE block of cells out of the drawing; the corpus idiom is to
        // clear a block and repopulate it, so skipping this leaves last bar's
        // rows under this bar's header with nothing marking them stale.
        case 'clear': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          const startCol = Number(value(op.startCol))
          const startRow = Number(value(op.startRow))
          const endCol = Number(value(op.endCol))
          const endRow = Number(value(op.endRow))
          // ⛔ A BOUND THAT IS NOT A WHOLE NUMBER CLEARS NOTHING, never "all of
          // it" — the same call `cell` makes for its address. `array.size(x)-1`
          // before the array is filled is `na`, and treating that as a bound
          // would empty a table the author was still writing into.
          if (![startCol, startRow, endCol, endRow].every(Number.isInteger)) break
          const map = cells.get(inst.id)
          if (!map) break
          // ⚠️ ASCENDING ONLY, AND DELIBERATELY NOT NORMALISED. Whether Pine
          // swaps a rectangle whose end precedes its start is NOT measured, and
          // the two readings fail in opposite directions: iterating a reversed
          // range clears nothing (stale cells, the defect this op fixes),
          // normalising it clears cells nobody named (content destroyed). No
          // corpus call site writes one, so the cheaper mistake is taken until
          // a vendor capture says otherwise.
          for (let c = startCol; c <= endCol; c += 1) {
            for (let r = startRow; r <= endRow; r += 1) map.delete(`${c},${r}`)
          }
          pruneCellTaint(inst.id, map)
          updated += 1
          if (ctx.trace) events.push({ bar, k: 'clear', id: inst.id, startCol, startRow, endCol, endRow })
          break
        }
        case 'delete': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          // ⭐ THE SAME TEARDOWN AN EVICTION USES — see `reap`. The container
          // cleanup this branch used to spell out lives there now, so the two
          // reasons an object can stop existing cannot drift apart.
          reap(inst)
          deleted += 1
          if (ctx.trace) events.push({ bar, k: 'delete', id: inst.id })
          break
        }
        case 'setreg': {
          regs.set(op.reg, op.value === null ? null : resolveRef(op.value))
          if (taintSeen && op.value !== null && refTainted(op.value)) regTaint.add(op.reg); else regTaint.delete(op.reg)
          break
        }
        case 'setnum': {
          nums.set(op.num, numOf(value(op.value)))
          if (tainted(op.value)) numTaint.add(op.num); else numTaint.delete(op.num)
          break
        }
        case 'push': {
          const arr = colls.get(op.coll)
          const inst = resolveRef(op.value)
          if (!arr) break
          // ⭐⭐ C16 — `array.push(bs, b)` with `b` `na` STILL PUSHES, in Pine: the
          // array grows by one `na` slot. ⚰️ This used to skip it, so every later
          // `array.size` and index read disagreed with TradingView by one per
          // `na` ever pushed. The slot is `null` here; a write through it is the
          // counted no-op any dead handle is.
          // ⛔ THE CAP COUNTS LIVE OBJECTS, and only once the array is that long:
          // a dead or `na` slot holds no object (C16 keeps deleted handles in
          // their arrays, above), and counting them would refuse a script whose
          // drawing never holds more than a handful of boxes at a time.
          if (arr.length >= collCap.get(op.coll)
            && arr.filter((id) => id !== null && live.has(id)).length >= collCap.get(op.coll)) {
            fail(`collection ${op.coll} exceeded its cap of ${collCap.get(op.coll)} (bar ${bar})`)
            break
          }
          // ⛔ PINE'S OWN CEILING ON AN ARRAY'S LENGTH — past it Pine stops the
          // script with a runtime error, so this stops too rather than growing.
          if (arr.length >= PINE_ARRAY_MAX) {
            fail(`collection ${op.coll} exceeded Pine's array size of ${PINE_ARRAY_MAX} (bar ${bar})`)
            break
          }
          // ⭐ C11b — `array.unshift(bs, b)` is the same add at the FRONT (`front`).
          // ⭐ C17 — the slot keeps whether the handle pushed into it was known,
          // at the same end.
          {
            const slotTaint = taintSeen && refTainted(op.value)
            if (op.front) { arr.unshift(inst); collSlotTaint.get(op.coll).unshift(slotTaint) } else { arr.push(inst); collSlotTaint.get(op.coll).push(slotTaint) }
          }
          break
        }
        case 'collset': {
          const arr = colls.get(op.coll)
          const i = Number(value(op.index))
          const inst = resolveRef(op.value)
          // ⭐ C16 — `array.set(bs, i, na)` stores `na`, exactly as `push` above.
          if (arr && Number.isInteger(i) && i >= 0 && i < arr.length) {
            arr[i] = inst
            collSlotTaint.get(op.coll)[i] = taintSeen && refTainted(op.value)
          }
          break
        }
        case 'collremove': {
          const arr = colls.get(op.coll)
          const i = Number(value(op.index))
          if (arr && Number.isInteger(i) && i >= 0 && i < arr.length) {
            arr.splice(i, 1)
            collSlotTaint.get(op.coll).splice(i, 1)
          }
          break
        }
        case 'collclear': {
          const arr = colls.get(op.coll)
          if (arr) arr.length = 0
          // ⭐ C17 — a list emptied where Pine empties it is known again.
          if (collSlotTaint.has(op.coll)) collSlotTaint.get(op.coll).length = 0
          collLenTaint.delete(op.coll)
          break
        }
        default:
          break
      }
    }
    return true
    }
    runOps(program.ops)
    if (opsThisBar > maxOpsInABar) maxOpsInABar = opsThisBar
    if (regHist) {
      for (const [rid, h] of regHist) {
        h.push(regs.get(rid) ?? null)
        if (h.length > histDepth) h.shift()
        // ⭐ C17 — `l[n]` on a bar the handle was unknown is unknown too.
        const th = regHistTaint.get(rid)
        th.push(regTaint.has(rid))
        if (th.length > histDepth) th.shift()
      }
    }
  }

  const finish = () => {
  // ⭐⭐ A FAMILY THE COLLECTOR CUT WHILE THE PROGRAM LOST CREATES OF IT IS
  // WITHHELD (C13, 2026-09-29).
  //
  // Pine's collector cuts a family by COUNT: past `cap + 5` the oldest go until
  // `cap` remain (`collect`). A create this program lost (`program.lostCreates`
  // — the converter's `create:*`, `guard:create`, `content:lost`, a refused
  // helper's body, a loop it never read) still counts on TradingView's side, so
  // once the collector has run the two sides cut at different moments and hold
  // DIFFERENT objects: TradingView removed ones this chart keeps. That is not a
  // smaller picture, it is a wrong one — the one loss the member door refuses
  // (`objectLoss.js`, ruling 2026-09-27: "anything whose loss leaves an object
  // on screen that Pine would have removed").
  //
  // ⚰️ MEASURED 2026-09-29 (NYSE:RDDT 1D). `high-low-open-mid-ranges` draws its
  // weekly range lines, loses its `vline` dividers (an unreadable guard), and
  // counts 504 lines against TradingView's 504 — the right COUNT with the wrong
  // lines. `sector-rotation` counts 50/50 lines too, but TradingView's sit at
  // bars 33–57 and ours at the chart's last 50 bars: it loses four guarded
  // `line.new`s that TradingView runs.
  //
  // ⛔ ONLY WHEN THIS RUN'S COLLECTOR ACTUALLY CUT THE FAMILY. Below the trigger
  // nothing is removed on this side, and a lost create is only a MISSING object
  // (drawn, disclosed). ⚠️ The converse is NOT covered: TradingView, holding the
  // lost objects too, can pass its trigger while this run does not — nothing
  // here can count creates that never ran. Named, not hidden.
  //
  // ⛔ `'*'` (a family the converter could not name) withholds every family the
  // collector cut. A fill spans two lines, so withheld lines take their fills.
  const lost = new Set(Array.isArray(program.lostCreates) ? program.lostCreates : [])
  const withheldFams = new Set()
  for (const fam of Object.keys(POOL_LIMITS)) {
    if (collectedBy[fam] > 0 && (lost.has(fam) || lost.has('*'))) withheldFams.add(fam)
  }
  if (withheldFams.has('line')) withheldFams.add('linefill')
  const withheld = {}
  for (const o of live.values()) {
    if (withheldFams.has(o.family)) withheld[o.family] = (withheld[o.family] || 0) + 1
  }
  const heldCounts = { ...counts }
  for (const fam of withheldFams) heldCounts[fam] = 0
  // ⭐⭐ C17 — AN OBJECT STILL CARRYING A TAINTED PROPERTY IS NOT DRAWN. Its
  // text, a coordinate, or its very existence reads what a withheld op wrote,
  // so drawing it would show a value TradingView may not hold. It is counted as
  // withheld, never drawn and never dropped silently. A fill on a withheld line
  // goes with it (a fill spans its two lines); a table whose cells are all
  // unknown goes whole, and a known table drops only its unknown cells.
  const taintHeld = new Set()
  for (const o of live.values()) {
    if (withheldFams.has(o.family)) continue
    if (instTaint.has(o.id) || (o.family === 'table' && cellTaint.get(o.id) === '*')) taintHeld.add(o.id)
  }
  for (const o of live.values()) {
    if (o.family !== 'linefill' || withheldFams.has(o.family) || taintHeld.has(o.id)) continue
    if (fillRefs(o).some((id) => taintHeld.has(id))) taintHeld.add(o.id)
  }
  for (const id of taintHeld) {
    const o = live.get(id)
    withheld[o.family] = (withheld[o.family] || 0) + 1
    heldCounts[o.family] -= 1
  }
  const cellsHeld = (id) => {
    const all = cellsOf(cells.get(id))
    const ct = cellTaint.get(id)
    return ct && ct !== '*' ? all.filter((c) => !ct.has(`${c.col},${c.row}`)) : all
  }
  // ⭐ C9 — a Pine runtime error draws NOTHING on TradingView, so nothing is
  // held here: the objects made before the error are not a smaller picture of
  // the script, they are a picture TradingView never shows.
  const stopped = status === OBJECT_STATUS.RUNTIME_ERROR
  if (stopped) for (const fam of Object.keys(heldCounts)) heldCounts[fam] = 0
  // ⭐ CREATION ORDER IS RENDER ORDER, and it is the object id because the id IS
  // a creation counter. Sorting by anything else (price, family) would put a
  // later object under an earlier one and quietly change what the author drew.
  const ordered = stopped ? [] : [...live.values()]
    .filter((o) => !withheldFams.has(o.family) && !taintHeld.has(o.id))
    .sort((a, b) => a.id - b.id)
  const cellsDropped = stopped ? 0 : ordered.reduce((n, o) => (o.family === 'table'
    ? n + cellsOf(cells.get(o.id)).length - cellsHeld(o.id).length : n), 0)

  return {
    status,
    reason,
    ...(withheldFams.size || taintHeld.size ? { withheld } : {}),
    live: ordered.map((o) => ({
      family: o.family,
      id: o.id,
      site: o.site,
      createdBar: o.createdBar,
      props: { ...o.props },
      ...(o.family === 'table' ? { cells: cellsHeld(o.id) } : {}),
    })),
    counts: heldCounts,
    stats: {
      created, updated, deleted, cellsCleared, writesToDeleted, opsExecuted, maxOpsInABar,
      ...(tablesReplaced ? { tablesReplaced } : {}),
      ...(fillsReplaced ? { fillsReplaced } : {}),
      ...(fillsWithoutLines ? { fillsWithoutLines } : {}),
      ...(textsWithheld ? { textsWithheld } : {}),
      ...(atBeyondAuto ? { atBeyondAutoBuffer: atBeyondAuto } : {}),
      ...(withheldUnknown ? { withheldUnknown } : {}),
      ...(propsUnmeasured ? { propsUnmeasured } : {}),
      // ⭐ C17 — ops withheld because they read a tainted value; objects and
      // cells held but not drawn because a property of theirs is still tainted.
      ...(withheldTainted ? { withheldTainted } : {}),
      ...(taintHeld.size ? { objectsTainted: taintHeld.size } : {}),
      ...(cellsDropped ? { cellsTainted: cellsDropped } : {}),
      peakLive: { ...peak },
      liveTotal: ordered.length,
      nextId,
    },
    ...(ctx.trace ? { events } : {}),
  }
  }

  return {
    barCount,
    // ⛔⛔ THE ENVELOPE STOP LIVES HERE, AND IN EXACTLY ONE PLACE. It was the
    // `for` loop's own condition, and a second driver arrived (`runObjectLane`
    // advances this from inside the VM's bar loop) which has no loop condition
    // to put it in — it cannot stop feeding bars, because the VM owns the loop.
    // ⛔ SO IT IS NOT REPEATED IN THE DRIVERS. Two copies of one invariant is a
    // guard that cannot be mutation-proved: killing either leaves the other
    // answering, and the rail stays green while half the protection is gone
    // (`lesson_a_guard_repeated_is_a_guard_unproved`). The rail that watches
    // THIS one is `objectRuntime.test.js`'s "it stops stepping" case, which
    // counts the ops executed AFTER the failure — the status alone cannot tell
    // a run that stopped from one that kept going, because `fail()` latches.
    step: (bar) => { if (status === OBJECT_STATUS.OK) stepBar(bar) },
    finish,
  }
}

/** ⭐ THE WHOLE DRAWING, DRIVEN HERE — the shape every caller but the runtime
 *  lane wants, and the ONE driver for everyone who has no bar loop of their own.
 *  ⛔ DERIVED FROM THE STEPPER, NEVER A SECOND COPY OF THE WALK. */
export function evaluateObjects(program, ctx) {
  const run = beginObjects(program, ctx)
  for (let bar = 0; bar < run.barCount; bar += 1) run.step(bar)
  return run.finish()
}

/** The deepest register-history read anywhere in these ops (loop bodies and
 *  object-valued props included), 0 when none. */
function deepestBack(ops) {
  let deepest = 0
  const see = (r) => {
    if (r && typeof r === 'object' && r.r === 'reg' && Number.isInteger(r.back) && r.back > deepest) {
      deepest = r.back
    }
  }
  for (const o of ops || []) {
    see(o.target); see(o.value)
    for (const v of Object.values(o.props || {})) see(v)
    if (o.k === 'loop') deepest = Math.max(deepest, deepestBack(o.body))
  }
  return deepest
}

function cellsOf(map) {
  if (!map) return []
  return [...map.entries()]
    .map(([key, props]) => {
      const [col, row] = key.split(',').map(Number)
      return { col, row, props: { ...props } }
    })
    .sort((a, b) => (a.row - b.row) || (a.col - b.col))
}
