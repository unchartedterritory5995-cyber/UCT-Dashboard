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
  'WINDOW_CELLS',
  // ⭐ 2F-2C. A carried builtin's cost is the OPPOSITE SHAPE to a window's: a
  // window reads `span` cells per bar and holds none between bars; a recurrence
  // reads ONE value per bar and holds a few forever. So both axes are counted
  // — the peak STATE a program allocates, and the total STEPS it takes.
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
export const DEFAULT_LIMITS = Object.freeze({
  PROGRAM_SIZE: 512 * 1024,
  IR_SIZE: 200000,
  // R-B (2026-10-01): a raise to 250,000 was MEASURED and NOT taken - it moves no graded
  // script today (dual-view and poor-man stop earlier on the host lane, on loop state and a
  // withheld text gate; only the dark runtime pane meets this ceiling). Revisit with R-RT.
  INSTRUCTIONS_PER_BAR: 200000,
  TOTAL_INSTRUCTIONS: 200000000,
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
  CALL_COUNT: 5000000,
  ARRAY_ELEMENTS: 100000,
  ARRAY_OPERATIONS: 2000000,
  LIVE_OBJECTS: 500,
  OBJECT_OPERATIONS: 200000,
  HISTORY: 20000,
  // ⚠️ MEASURED, NOT GUESSED — and the measurement is why they are this small.
  // The 2F-2 census over all five corpora (169 scripts) found 35 that read
  // history over a value they mutate, and their DEPTH demand is: 29 scripts at
  // `[1]`, one at `[2]`, and none deeper. So the honest default reserves room for
  // an order of magnitude more than any real script asks for, and still refuses a
  // runaway long before it can matter.
  HISTORY_SLOTS: 512,
  HISTORY_VALUES: 262144,
  WINDOW_CELLS: 100000000,
  // ⚠️ MEASURED, and deliberately small. Every member of `CARRIED` holds THREE
  // scalars, so 4,096 instances is 12,288 doubles — 98 KB — which is already far
  // past any honest indicator. The ceiling exists so a generated program cannot
  // quietly allocate per-symbol state that a 5,000-symbol scan multiplies.
  CARRIED_INSTANCES: 4096,
  CARRIED_CELLS: 65536,
  CARRIED_STEPS: 100000000,
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

/** The running account. ⭐ ONE OBJECT, PASSED DOWN — never module state, because
 *  the runtime must be re-entrant across symbols in one screener pass and module
 *  state would let symbol 4,000 inherit symbol 3,999's budget. */
export class Budget {
  constructor(limits) {
    this.limits = resolveLimits(limits)
    this.counts = Object.create(null)
    for (const n of LIMIT_NAMES) this.counts[n] = 0
    this.startedAt = 0
  }

  /** Charge `n` against a limit and stop by name if it is exceeded. */
  charge(limit, n) {
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
