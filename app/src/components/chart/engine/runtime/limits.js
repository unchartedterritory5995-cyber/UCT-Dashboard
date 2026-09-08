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
