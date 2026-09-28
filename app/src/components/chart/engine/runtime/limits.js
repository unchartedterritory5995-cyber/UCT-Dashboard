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
  'LOOP_ITERATIONS',
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
  INSTRUCTIONS_PER_BAR: 200000,
  TOTAL_INSTRUCTIONS: 200000000,
  // ⭐ PER BAR since 2026-09-28 (`vm.js` LOOP_TICK) — a total over the run
  // stopped honest indicators on an ordinary 3,000-bar chart.
  LOOP_ITERATIONS: 100000,
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
  // ⭐ MILLISECONDS, and ENFORCED since 2026-09-28 (`Budget.checkWall`, read by
  // `vm.js` every `WALL_CHECK_EVERY` instructions). Until then it was declared
  // here and charged nowhere, so it bounded nothing — a limit with no counter is
  // a comment. Measured against it: kernel-channel-backquant, the costliest
  // script the lane attaches, runs ~0.3 s per 1,000 daily bars after the
  // dispatch work (`app/scripts/pine-runtime-bench.mjs`), so a 5,000-bar chart
  // finishes in ~1.5 s — a third of this ceiling — and a runaway stops by name
  // rather than freezing the member's tab.
  WALL_TIME: 5000,
})

/** ⭐ HOW OFTEN THE WALL CLOCK IS READ — once every this many instructions,
 *  counted across bars. Never per instruction: a clock read costs more than the
 *  instruction it would be guarding. At the measured ~15 ns an instruction this
 *  is a read every ~0.06 ms, so a run overshoots `WALL_TIME` by well under a
 *  millisecond; a power of two so the countdown stays a cheap integer. */
export const WALL_CHECK_EVERY = 4096

/** The wall clock a run reads when its caller supplies none. ⛔ READ AT CALL
 *  TIME, not captured at load, so a test can drive it (`vi.spyOn(performance,
 *  'now')`) without this module holding any state. */
export function defaultClock() {
  return globalThis.performance.now()
}

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
    // ⭐ THE STOP'S NAME AS A VALUE, so a door can report it without parsing
    // the sentence (`pineRuntimeLane.js::runtimeLaneColumns`).
    this.code = `${limit}_EXCEEDED`
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
    // ⭐ WALL_TIME's clock and its high-water mark. ⛔ NOT in `counts`: every
    // other count is a property of the PROGRAM and the bars (the same run counts
    // the same forever — `runtimeSpeedParity.test.js` holds them byte-for-byte);
    // elapsed time is a property of the machine, and mixing it in would make the
    // account itself nondeterministic.
    this.clock = null
    this.wallElapsed = 0
  }

  /** Start the wall on the run's FIRST `execute`. ⭐ A request's nested run
   *  shares this budget and so shares the wall: forty requested symbols are
   *  forty symbols' worth of time inside one member's chart, not forty fresh
   *  allowances. A second call is a no-op. */
  startWall(clock) {
    if (this.clock !== null) return
    this.clock = clock
    this.startedAt = clock()
  }

  /** Read the clock and stop BY NAME if the run has outlived `WALL_TIME`. */
  checkWall() {
    const elapsed = this.clock() - this.startedAt
    if (elapsed > this.wallElapsed) this.wallElapsed = elapsed
    const ceiling = this.limits.WALL_TIME
    if (elapsed > ceiling) throw new RuntimeLimitError('WALL_TIME', ceiling, Math.round(elapsed))
    return elapsed
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
