// app/src/components/chart/engine/runtime/limits.js
//
// ─── THE RESOURCE MODEL, AND WHY IT IS NOT THE OLD ONE ──────────────────────
//
// ⛔⛔ `maxLookback`'s TREE SUM IS NOT CARRIED OVER AS THE BOUND. It measured a
// property of an EXPRESSION — how far back the deepest offset reaches — and it
// was exactly right for a walker that evaluates each node once into a column.
// It says nothing whatever about a loop, an array that grows, or a function that
// calls itself through three frames. A bound that no longer bounds the thing it
// is pointed at is worse than no bound: it reads as protection.
//
// ⭐ WHAT *IS* CARRIED OVER IS ITS INTENT — a static, provable ceiling computed
// BEFORE execution, so a program that cannot possibly fit is refused rather than
// discovered mid-bar. The front end computes the static worst case; the runtime
// counts against it while running. Both halves are required: a static estimate
// alone cannot see a data-dependent loop bound, and a running counter alone lets
// a hopeless program start.
//
// ⛔ EVERY LIMIT HAS A NAMED FAILURE. A resource stop must never look like a
// short series, an `na`, or a quiet zero — `lesson_a_saturated_instrument_reports_zero`
// is the whole reason. `RuntimeLimitError` carries the limit's name, the ceiling
// and what was reached, so the member is told which ceiling they met.

/** The accounted resources. ⛔ NOT "the sixteen" — a typed count beside the list
 *  it describes is the drift this repo pays for most often, and this list grew by
 *  one the first time functions needed accounting. ⭐ DERIVED-FROM, NEVER RETYPED: every other
 *  file in this directory reads limit names from here, and the conformance rail
 *  asserts the runtime counts something for each one it claims to enforce. */
export const LIMIT_NAMES = Object.freeze([
  'PROGRAM_SIZE',
  'IR_SIZE',
  'INSTRUCTIONS_PER_BAR',
  'TOTAL_INSTRUCTIONS',
  // ⭐⭐ RT10 (2026-10-04) — the passes ALL loops may take on ONE BAR. A PEAK,
  // reset every bar, like `INSTRUCTIONS_PER_BAR`; never a run-wide total.
  'LOOP_ITERATIONS',
  // ⭐⭐ C18 — the passes ONE ENTRY of one `while` may take. A PEAK, reset each
  // time the loop is reached, so a loop that finishes costs nothing here and
  // one that does not is stopped by name at its own line (`ir.js::whileStmt`).
  'WHILE_ITERATIONS',
  'LOOP_NESTING',
  'CALL_DEPTH',
  'CALL_COUNT',
  'ARRAY_ELEMENTS',
  'ARRAY_OPERATIONS',
  'LIVE_OBJECTS',
  'OBJECT_OPERATIONS',
  'HISTORY',
  // ⭐⭐ 2F-2. `HISTORY` above measures the BAR COUNT — how far back the chart
  // itself reaches. These two measure what the RUNTIME allocates to answer `x[n]`
  // over a mutable value, which is a different resource entirely and would have
  // been invisible inside the old name.
  //
  // ⛔ THEY ARE BOUNDED BEFORE THE FIRST BAR RUNS. The front end knows every
  // history-bearing slot and every slot's depth statically, so a program that
  // cannot fit is refused at compile time rather than discovered at bar 4,000 —
  // and `HISTORY_VALUES` is the product that actually predicts memory, because
  // ten slots at depth two and two slots at depth ten are not the same object.
  'HISTORY_SLOTS',
  'HISTORY_VALUES',
  // ⭐ 2F-2B. A finite-window call reads `span` values EVERY BAR, so the cost
  // that scales is not the ring's size but the total cells read across the run —
  // `sma(x, 200)` on 5,000 bars touches a million of them. Counted here so a
  // program whose windows are quietly enormous stops BY NAME rather than by
  // taking a very long time.
  // ⭐⭐ RT17 — counted PER BAR (`PER_BAR_CHARGED`): the cells one bar reads. A
  // run-wide total of it scaled with history, not with the script.
  'WINDOW_CELLS',
  // ⭐ 2F-2C. A carried builtin's cost is the OPPOSITE SHAPE to a window's: a
  // window reads `span` cells per bar and holds none between bars; a recurrence
  // reads ONE value per bar and holds a few forever. So both axes are counted
  // — the peak STATE a program allocates, and the STEPS it takes (⭐⭐ RT17:
  // per bar, `PER_BAR_CHARGED` — a run-wide total scaled with history).
  'CARRIED_INSTANCES',
  'CARRIED_CELLS',
  'CARRIED_STEPS',
  'REQUEST_COUNT',
  'REQUEST_FANOUT',
  'MEMORY',
  'WALL_TIME',
])

/** ⚠️ PROVISIONAL AND SAID SO. These are starting ceilings, not measured ones.
 *  `PHASE2_RUNTIME_ARCHITECTURE.md` §7 owns the gates that will correct them —
 *  `lesson_an_acceptance_number_is_a_forecast_until_derived`. Each is generous
 *  enough that no honest indicator meets it and tight enough that a runaway
 *  stops in well under a second. */
// ⭐⭐ RT17 (2026-10-04) — THE RUN'S TIME SAFETY AND THE LONGEST HISTORY A RUN
// ACCEPTS, named once so the per-bar work ceiling below is DERIVED from them,
// never retyped. `TOTAL_INSTRUCTIONS` is the one run-wide count kept: its
// TradingView counterpart is run-wide too (a script's whole execution is limited
// to 20 s / 40 s, `pine-presentation-spec.md` §3.5).
const RUN_INSTRUCTIONS = 200000000
const HISTORY_BARS = 20000
// ⭐⭐ RT17 — ONE BAR'S CEILING FOR EVERY `PER_BAR_CHARGED` LIMIT: what a bar may
// spend so that the LONGEST history this runtime accepts can never spend more of
// it, over the whole run, than the run's instruction safety allows
// (10,000 x 20,000 = 200,000,000). That matters for the two limits that count
// ELEMENT work one instruction does not show — an `array.sum` over n elements,
// a window reduction over `span` cells — so the run's time stays bounded by
// name with no wall clock (the harness, a census). The two that are themselves
// instructions (a call, a carried step) are bounded by `TOTAL_INSTRUCTIONS`
// already; for them it is the stop ON THE BAR a runaway happens in.
// MEASURED (RT17: 62 corpus scripts the runtime builds, SPY 8,477 and AAPL 11,534
// daily bars from the listing; + every vendor capture, runtime pane on): the
// worst bar any script FINISHES is 1,504 array operations (wyckoff, AAPL),
// 1,201 calls (delta-rsi), 100 window cells (elliott-wave-3), 27 carried steps
// (price-action-fibonacci) — 6.6x / 8.3x / 100x / 370x under this ceiling.
// k-clustering takes 2,891 calls and 2,732 array operations on its last bar and
// already stops there by `INSTRUCTIONS_PER_BAR` (R-B, not raised).
const PER_BAR_WORK = RUN_INSTRUCTIONS / HISTORY_BARS

export const DEFAULT_LIMITS = Object.freeze({
  PROGRAM_SIZE: 512 * 1024,
  IR_SIZE: 200000,
  // R-B (2026-10-01): a raise to 250,000 was MEASURED and NOT taken - it moves no graded
  // script today (dual-view and poor-man stop earlier on the host lane, on loop state and a
  // withheld text gate; only the dark runtime pane meets this ceiling). Revisit with R-RT.
  INSTRUCTIONS_PER_BAR: 200000,
  TOTAL_INSTRUCTIONS: RUN_INSTRUCTIONS,
  // ⭐⭐ RT10 (2026-10-04) — PER BAR, NOT PER RUN. It was a run-wide 100,000, and
  // a run-wide count of a per-bar cost scales with HISTORY, not with the script:
  // delta-rsi-oscillator-strategy walks a fixed regression window, 1,163 passes
  // every bar, and stopped at bar 85 of RDDT's 636 — the same script would have
  // drawn on a 60-bar chart. Wyckoff (324 passes at its worst bar) stopped the same
  // way on 5,000 AAPL bars. What a run-wide loop total was standing in for —
  // runaway TIME on the one thread a member's chart runs on — is already bounded
  // by the limits whose job that is: `TOTAL_INSTRUCTIONS` for the run and the
  // pane's wall clock (`runtimeColumns.js`, RUNTIME_PANE_TIME_BUDGET_MS).
  //
  // ⭐ WHY 11,000, AND WHY IT IS THIS NARROW. Measured (RT10, 5,000 AAPL daily
  // bars, every corpus script the runtime builds): the most passes any script
  // takes on one bar is 1,163 (delta-rsi), then 542 (options-max-pain) and 324
  // (wyckoff). The ceiling must sit:
  //   · ABOVE `WHILE_ITERATIONS` — a `while` pass ticks this counter too, and the
  //     while bound is the stop that NAMES THE LINE; a lower per-bar ceiling
  //     would fire first and make that guard unreachable;
  //   · BELOW what `INSTRUCTIONS_PER_BAR` already allows — the cheapest `for`
  //     pass costs 18 instructions (`continue` body), so 200,000 / 18 = 11,111
  //     passes; at or above that this ceiling could never fire (a dead guard).
  // ⚠️ Two scripts take more on ONE bar — k-clustering 22,820 passes on its last
  // RDDT bar, poor-man's volume profile 40,401 — and both already stop on that bar
  // by `INSTRUCTIONS_PER_BAR` (R-B: not raised), so this ceiling changes neither.
  // A test that raises the bar's instructions must raise this with it.
  // 11,000 is ~9x the worst bar any script FINISHES; a runaway is stopped on the bar it runs
  // away in, by this name or by `INSTRUCTIONS_PER_BAR`, in milliseconds
  // (`rt10LoopPerBar.test.js`).
  LOOP_ITERATIONS: 11000,
  // ⛔⛔ AN ENGINE LIMIT, NOT A PINE CLAIM. TradingView stops a runaway loop on
  // ELAPSED TIME, and no capture or document in this repo pins that limit, so no
  // pass count can be said to be Pine's. A `while` that finishes within this many
  // passes computes exactly what Pine computes (the loop has no semantics but its
  // body); one that does not is REFUSED for that evaluation — never cut short and
  // read. 10,000 is three orders above every `while` measured in the corpus
  // (k-clustering converges in 15 passes on its RDDT capture; max-pain's loops are
  // bounded by its strike count, 20) and below what `LOOP_ITERATIONS` allows one
  // bar (it must stay below it — see there).
  WHILE_ITERATIONS: 10000,
  LOOP_NESTING: 8,
  CALL_DEPTH: 64,
  // ⭐⭐ RT17 — PER BAR (`PER_BAR_CHARGED`), was a run-wide 5,000,000: delta-rsi
  // calls 1,201 a bar and would have stopped near bar 4,160 of a long chart.
  CALL_COUNT: PER_BAR_WORK,
  // ⭐ A TradingView limit, kept as it is: a collection holds at most 100,000
  // elements (`[UM]` Writing / Limitations; `pine-presentation-spec.md` §3.5).
  ARRAY_ELEMENTS: 100000,
  // ⭐⭐ RT17 — PER BAR (`PER_BAR_CHARGED`), was a run-wide 2,000,000: wyckoff
  // costs ~262 a bar and stopped on bar 7,628 of SPY's 8,477 (W17R).
  ARRAY_OPERATIONS: PER_BAR_WORK,
  LIVE_OBJECTS: 500,
  OBJECT_OPERATIONS: 200000,
  HISTORY: HISTORY_BARS,
  // ⚠️ MEASURED, NOT GUESSED — and the measurement is why they are this small.
  // The 2F-2 census over all five corpora (169 scripts) found 35 that read
  // history over a value they mutate, and their DEPTH demand is: 29 scripts at
  // `[1]`, one at `[2]`, and none deeper. So the honest default reserves room for
  // an order of magnitude more than any real script asks for, and still refuses a
  // runaway long before it can matter.
  HISTORY_SLOTS: 512,
  HISTORY_VALUES: 262144,
  // ⭐⭐ RT17 — PER BAR (`PER_BAR_CHARGED`), was a run-wide 100,000,000.
  WINDOW_CELLS: PER_BAR_WORK,
  // ⚠️ MEASURED, and deliberately small. Every member of `CARRIED` holds THREE
  // scalars, so 4,096 instances is 12,288 doubles — 98 KB — which is already far
  // past any honest indicator. The ceiling exists so a generated program cannot
  // quietly allocate per-symbol state that a 5,000-symbol scan multiplies.
  CARRIED_INSTANCES: 4096,
  CARRIED_CELLS: 65536,
  // ⭐⭐ RT17 — PER BAR (`PER_BAR_CHARGED`), was a run-wide 100,000,000.
  CARRIED_STEPS: PER_BAR_WORK,
  REQUEST_COUNT: 16,
  REQUEST_FANOUT: 64,
  MEMORY: 64 * 1024 * 1024,
  WALL_TIME: 5000,
})

/** ⛔ A RESOURCE STOP IS ITS OWN FAILURE CLASS, distinct from a refusal (the
 *  member wrote something this engine cannot mean) and from a bug (an Error).
 *  `PHASE2_RUNTIME_ARCHITECTURE.md` §45 keeps those layered so nobody blames the
 *  object model for a compiler failure — the same discipline C2A established for
 *  output containment. */
export class RuntimeLimitError extends Error {
  constructor(limit, ceiling, reached) {
    super(`${limit}_EXCEEDED — ceiling ${ceiling}, reached ${reached}`)
    this.name = 'RuntimeLimitError'
    this.limit = limit
    this.ceiling = ceiling
    this.reached = reached
  }
}

export function resolveLimits(overrides) {
  if (!overrides) return DEFAULT_LIMITS
  const out = { ...DEFAULT_LIMITS }
  for (const k of Object.keys(overrides)) {
    if (!LIMIT_NAMES.includes(k)) {
      throw new Error(`unknown limit ${JSON.stringify(k)} — this module declares ${LIMIT_NAMES.join(', ')}`)
    }
    out[k] = overrides[k]
  }
  return Object.freeze(out)
}

/** ⭐⭐ RT17 (2026-10-04) — THE CHARGED LIMITS THAT COUNT ONE BAR, NOT THE RUN.
 *  Each was a run-wide total with no TradingView counterpart (TradingView bounds
 *  a script by ELAPSED TIME — 20 s / 40 s a run, 500 ms a loop — and by
 *  collection SIZE, never by a count of operations; `pine-presentation-spec.md`
 *  §3.5). A run-wide count of a per-bar cost scales with HISTORY, not with the
 *  script: wyckoff-accumulation-distribution costs ~262 array operations a bar
 *  and stopped by `ARRAY_OPERATIONS` on bar 7,628 of SPY's 8,477 (W17R). Each is
 *  now reset at the start of every bar (`startBar`, `vm.js`), stops by name on
 *  the bar it runs away in, and keeps the WORST BAR as its count (a peak).
 *  What the run-wide totals stood in for — the run's time — is bounded by
 *  `TOTAL_INSTRUCTIONS`, by `HISTORY` x each per-bar ceiling, and on the
 *  member's pane by its wall clock (`runtimeColumns.js`). `runTotals` keeps
 *  the run's sum of each, measured and never checked. */
export const PER_BAR_CHARGED = Object.freeze([
  'CALL_COUNT',
  'ARRAY_OPERATIONS',
  'WINDOW_CELLS',
  'CARRIED_STEPS',
])
const IS_PER_BAR = Object.freeze(Object.fromEntries(PER_BAR_CHARGED.map((n) => [n, true])))

/** The running account. ⭐ ONE OBJECT, PASSED DOWN — never module state, because
 *  the runtime must be re-entrant across symbols in one screener pass and module
 *  state would let symbol 4,000 inherit symbol 3,999's budget. */
export class Budget {
  constructor(limits) {
    this.limits = resolveLimits(limits)
    this.counts = Object.create(null)
    for (const n of LIMIT_NAMES) this.counts[n] = 0
    // ⭐ RT17 — this bar's running count of each per-bar limit, and the run's
    // sum of it (a measurement, never checked).
    this.bar = Object.create(null)
    this.runTotals = Object.create(null)
    for (const n of PER_BAR_CHARGED) { this.bar[n] = 0; this.runTotals[n] = 0 }
    this.startedAt = 0
  }

  /** ⭐ RT17 — a new bar: every per-bar limit starts from zero. */
  startBar() {
    for (let i = 0; i < PER_BAR_CHARGED.length; i += 1) this.bar[PER_BAR_CHARGED[i]] = 0
  }

  /** ⭐ RT17 — a run nested inside a bar (a request's sub-run shares this
   *  budget and runs its own bars) must hand the outer bar its count back. */
  saveBar() { return { ...this.bar } }
  restoreBar(saved) { Object.assign(this.bar, saved) }

  /** Charge `n` against a limit and stop by name if it is exceeded. A per-bar
   *  limit (`PER_BAR_CHARGED`) counts this bar only and keeps its worst bar. */
  charge(limit, n) {
    if (IS_PER_BAR[limit] === true) {
      const atBar = this.bar[limit] + n
      this.bar[limit] = atBar
      this.runTotals[limit] += n
      if (atBar > this.counts[limit]) this.counts[limit] = atBar
      const cap = this.limits[limit]
      if (atBar > cap) throw new RuntimeLimitError(limit, cap, atBar)
      return atBar
    }
    const next = this.counts[limit] + n
    this.counts[limit] = next
    const ceiling = this.limits[limit]
    if (next > ceiling) throw new RuntimeLimitError(limit, ceiling, next)
    return next
  }

  /** Set-and-check, for the peak measures (nesting, depth, live objects) where
   *  the interesting number is the high-water mark rather than a total. */
  peak(limit, n) {
    if (n > this.counts[limit]) this.counts[limit] = n
    const ceiling = this.limits[limit]
    if (n > ceiling) throw new RuntimeLimitError(limit, ceiling, n)
    return n
  }
}
