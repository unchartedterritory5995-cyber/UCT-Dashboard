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
  // ⭐ W4-T8 — a window whose v6 `series int` length changes every bar is charged the span it READ on
  // that bar (its ring is sized to the history ceiling, but only the bars it reads are cells). The
  // budget is unchanged.
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
  // ⭐ P1 HARDENING (2026-10-11) — the six ceilings below marked ENFORCED were
  // declared here and counted NOWHERE (verified by grep: no `charge`/`peak` named
  // them), so they read as protection while protecting nothing. Each now has one
  // accounting site and one named failure; `runtimeHardeningP1.test.js` rails that
  // every name in `LIMIT_NAMES` is counted somewhere.
  //
  // ENFORCED — the UTF-8 BYTES of the script's source, checked before the front end
  // reads it (`runtimeColumns.js::sourceSizeRefusal`). The server stores a runtime
  // document of at most 128 KiB (`runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES`),
  // so no document the store accepts can meet this; it stops a pasted or generated
  // source before the lexer is handed it.
  PROGRAM_SIZE: 512 * 1024,
  IR_SIZE: 200000,
  // R-B (2026-10-01): a raise to 250,000 was MEASURED and NOT taken - it moves no graded
  // script today (dual-view and poor-man stop earlier on the host lane, on loop state and a
  // withheld text gate; only the dark runtime pane meets this ceiling). Revisit with R-RT.
  INSTRUCTIONS_PER_BAR: 200000,
  TOTAL_INSTRUCTIONS: 200000000,
  // ⭐⭐ UIE PHASE 2 (2026-10-11) — RAISED FROM 100,000 TO 5,000,000, MEASURED FIRST
  // (`runtimeLimitsBudget.measure.test.js`). This is a WHOLE-RUN count, so the old
  // ceiling was really ~3-20 iterations a bar on a 5,000-32,000-bar chart: it stopped
  // atr-stepped (43 a bar) at bar 2,325, nadaraya-watson (56 a bar) at bar 1,785 and
  // kalman (12 a bar) at bar 8,332 of an ordinary daily chart, while their whole runs
  // need at most 1.8 M iterations at 32,000 bars.
  //   WHY 5 M AND NOT MORE: one iteration of the smallest loop body (`s += i`) costs
  // ~21 VM instructions (measured: 2,139 instructions a bar for 101 iterations), so
  // `TOTAL_INSTRUCTIONS` (200 M) already stops ANY loop near 9.5 M iterations; a loop
  // ceiling above that could never be the one met. 5 M stays the ceiling a loop meets
  // first (~105 M instructions, ~0.8 s on this box), admits 2.8x the heaviest honest
  // corpus run at the longest chart a member loads (`fullBarsFor`: 32,000 bars) and
  // ~430 iterations a bar on a 11,534-bar daily chart.
  //   ⛔⛔ NARROWED 2026-11-09 — "ADMITS THE HEAVIEST HONEST RUN AT 32,000 BARS" IS NOT TRUE OF
  // EVERY CORPUS SCRIPT. Re-measured (all three whole-run counts lifted, SPY 1D tiled to
  // 8,502 bars): delta-rsi-oscillator-strategy takes a CONSTANT 1,163 iterations a bar (its
  // fixed 21x3 least-squares solve, rebuilt every bar by the script itself) and stops here at
  // bar ~4,299; machine-learning-knn-based-strategy loops over a list that grows every bar
  // (~`bar` iterations on bar `bar`, so ~bar^2/2 in all: 2,003,000 by bar 2,000) and stops at bar 3,160. Neither
  // is our avoidable work: Pine runs the same loops. NOT RAISED, because neither reaches
  // this ceiling on the member's pane: the 1,000 ms pane budget stops delta-rsi at ~bar 610
  // and knn at ~bar 1,035 first, so a raise would change no member's chart and would only
  // weaken the runaway bound. The 32,000-bar sizing holds for scripts at <=156 iterations a bar.
  //   ⛔ THE PER-BAR BOUND IS `INSTRUCTIONS_PER_BAR`, NOT A SECOND LOOP COUNT: a loop
  // that runs away inside one bar (a bound it never reaches, `by 0`) meets 200,000
  // instructions on that bar and stops by name there. Nesting is `LOOP_NESTING`, one
  // `while` entry is `WHILE_ITERATIONS`, time is `WALL_TIME` and the pane budget.
  LOOP_ITERATIONS: 5000000,
  // ⛔⛔ AN ENGINE LIMIT, NOT A PINE CLAIM. TradingView stops a runaway loop on
  // ELAPSED TIME, and no capture or document in this repo pins that limit, so no
  // pass count can be said to be Pine's. A `while` that finishes within this many
  // passes computes exactly what Pine computes (the loop has no semantics but its
  // body); one that does not is REFUSED for that evaluation — never cut short and
  // read. 10,000 is three orders above every `while` measured in the corpus
  // (k-clustering converges in 15 passes on its RDDT capture; max-pain's loops are
  // bounded by its strike count, 20) and far below what `LOOP_ITERATIONS` already
  // allows a whole run.
  WHILE_ITERATIONS: 10000,
  LOOP_NESTING: 8,
  CALL_DEPTH: 64,
  // ⭐ DERIVATION (2026-11-09; until then this line had none, and the 32,000-bar sizing
  // above was claimed for it without ever being measured). A WHOLE-RUN count of USER-
  // function calls only (`vm.js` OP.CALL; builtins are not counted). Measured on every
  // runtime-lane corpus script, SPY 1D tiled to 8,502 bars, every count lifted: the
  // heaviest is delta-rsi-oscillator-strategy at a CONSTANT 1,201 calls a bar (its matrix
  // helpers `matrix_get` / `matrix_set` ~1,130 of them, the same every bar, as in Pine),
  // which meets 5,000,000 at bar 4,163; the next is atr-stepped at 22 a bar, then
  // williams-fractal at 11. So 5 M admits <=156 calls a bar at 32,000 bars and every corpus
  // script but delta-rsi at 32,000. NOT RAISED: the 1,000 ms pane budget stops delta-rsi
  // at ~bar 610 long before this count, so a raise moves no member's chart. A loop of
  // calls that runs away is bounded here at the same ~100 M instructions as LOOP_ITERATIONS.
  CALL_COUNT: 5000000,
  ARRAY_ELEMENTS: 100000,
  // ⭐ MEASURED 2026-11-09 with CALL_COUNT (same sweep): counted on every array WRITE
  // (`array.set` included) and per element on whole-array calls (`collections.js`), not
  // on `array.get`. Heaviest is
  // delta-rsi at a constant 459 a bar (meets this at bar ~4,357; the pane budget stops it
  // at ~610 first); next wyckoff-accumulation-distribution at 25 a bar, kalman at 25,
  // atr-stepped at 21. Admits <=62 a bar at 32,000 bars. Not raised, for the same reason.
  ARRAY_OPERATIONS: 2000000,
  // ENFORCED — drawings live at the end of a bar, every family, AFTER the store's
  // own Pine collector (`objectStore.js`). ⛔ RAISED FROM 500, deliberately: Pine
  // lets ONE script hold up to 500 lines AND 500 labels AND 500 boxes (`max_*_count`
  // ceilings, `objectPool.POOL_LIMITS`), so a total of 500 would have refused valid
  // scripts. The ceiling is the most the store can ever hold — line, label and box
  // at their 500 ceiling plus the 5 the batched collector lets past (3 x 505), the
  // 40-table and 500-linefill house envelopes — so it never refuses what the store
  // admits, and still stops a store defect that would let objects accumulate.
  LIVE_OBJECTS: 3 * 505 + 40 + 500,
  // ENFORCED — drawing calls (`line.new`, every setter, getter, delete …) over the
  // WHOLE run, request sub-runs included. ⛔ RAISED FROM 200,000: a 50-cell table
  // rewritten on every bar of a 20,000-bar intraday history is 1,000,000 (32,768 bars, the
  // `HISTORY` ceiling since UIE Phase 3: 1,638,400)
  // calls and is an honest dashboard; 2,000,000 admits it and still bounds a runaway
  // well inside `TOTAL_INSTRUCTIONS`.
  OBJECT_OPERATIONS: 2000000,
  // ⛔⛔ OWNER RULING D5 (2026-10-02, `docs/pine/runtime-pane-switch-on-plan.md`) kept 20,000.
  // ⭐⭐ UIE PHASE 3 (M2, 2026-10-11) — REVISITED, AS THE OWNER AUTHORIZED FOR THIS MILESTONE,
  // AND RAISED TO 32,768 (2^15) ON MEASUREMENT (`runtimeHistoryCeiling.measure.test.js`,
  // every runtime-only corpus script and eight adversarial programs at 20,000 / 30,000 /
  // 32,000 / 32,768 five-minute bars, through the product path under the pane budget):
  //   * the longest history any chart loads is 32,000 bars (`fullBarsFor`, 30m / 60m), so
  //     20,000 refused every full intraday load at bar 0 whatever the script did;
  //   * at 32,768 every script either draws or stops BY NAME (`runtime:time-budget` for
  //     the slow ones), worst case ~1.3 s with its build; the MEMORY estimate peaks at
  //     28 MB of its 64 MB ceiling (columns are 8 bytes a bar; rings, windows and carried
  //     state do not scale with bars); two runs of a chart are bit-identical;
  //   * every adversarial program is still stopped by name (the slowest, a 5k-a-bar
  //     loop, by the pane budget at ~1.04 s) — a longer window buys a runaway nothing;
  //   * 32,769 bars is refused at bar 0, by name. ⛔ Past 32,768 needs the owner again.
  HISTORY: 32768,
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
  // ENFORCED — how deep requests NEST: a request whose region itself requests runs
  // the program again inside the first run (`vm.js::runRequest`), and without a depth
  // bound a self-requesting region is unbounded recursion. Peaked on entry.
  REQUEST_FANOUT: 64,
  // ENFORCED — an ESTIMATE, in bytes, of the state a run holds, and said to be one:
  // JavaScript exposes no per-run heap figure. It is the run's own allocations,
  // exactly sized (output columns, history rings, window buffers, carried state,
  // frames, iteration buffers, aligned request results) plus, at every bar end, the
  // largest collection seen (16 B / element) and the live drawings (512 B each).
  // Dynamic collection memory is additionally bounded by `ARRAY_ELEMENTS` and
  // `ARRAY_OPERATIONS`.
  MEMORY: 64 * 1024 * 1024,
  // ENFORCED — milliseconds since the run's first bar, checked at every bar end of
  // every run that shares the budget. The runtime PANE stops earlier, at its own
  // 1,000 ms (`runtimeColumns.RUNTIME_PANE_TIME_BUDGET_MS`); this is the backstop for
  // every other caller of `execute` (a worker, a census, a test harness).
  WALL_TIME: 5000,
})

/** ⭐ P1 HARDENING — the per-object figure `MEMORY` charges for a live drawing. */
export const LIVE_OBJECT_BYTES = 512

/** ⛔ A RESOURCE STOP IS ITS OWN FAILURE CLASS, distinct from a refusal (the
 *  member wrote something this engine cannot mean) and from a bug (an Error).
 *  `PHASE2_RUNTIME_ARCHITECTURE.md` §45 keeps those layered so nobody blames the
 *  object model for a compiler failure — the same discipline C2A established for
 *  output containment. */
/** ⭐ WHAT A MEMBER IS TOLD EACH LIMIT IS. A limit's NAME (`CALL_COUNT`) is an engine
 *  token and never reaches a member's sentence; this plain phrase does, and the
 *  name rides the refusal as a FIELD (`err.limit`) for telemetry. One entry per
 *  `LIMIT_NAMES` member — `runtimeLimitSentence.test.js` rails that, so a new limit
 *  cannot ship speaking in a token. */
export const LIMIT_PLAIN = Object.freeze({
  PROGRAM_SIZE: "the size of a script's source",
  IR_SIZE: 'the size a script may compile to',
  INSTRUCTIONS_PER_BAR: 'the number of steps a script may take on one bar',
  TOTAL_INSTRUCTIONS: 'the number of steps a script may take over the whole chart',
  LOOP_ITERATIONS: 'the number of loop passes a script may make over the whole chart',
  WHILE_ITERATIONS: 'the number of passes one `while` loop may make',
  LOOP_NESTING: 'how deeply loops may be nested',
  CALL_DEPTH: 'how deeply functions may call one another',
  CALL_COUNT: 'the number of function calls a script may make over the whole chart',
  ARRAY_ELEMENTS: "the number of elements a script's arrays may hold",
  ARRAY_OPERATIONS: 'the number of array operations a script may make over the whole chart',
  LIVE_OBJECTS: 'the number of drawings a script may hold at once',
  OBJECT_OPERATIONS: 'the number of drawing calls a script may make over the whole chart',
  HISTORY: 'the number of bars a script may be drawn over',
  HISTORY_SLOTS: 'the number of values a script may keep history for',
  HISTORY_VALUES: 'the amount of history a script may keep',
  WINDOW_CELLS: "the number of past values a script's moving windows may read over the whole chart",
  CARRIED_INSTANCES: 'the number of running calculations a script may keep',
  CARRIED_CELLS: "the state a script's running calculations may keep",
  CARRIED_STEPS: 'the number of running-calculation steps a script may take over the whole chart',
  REQUEST_COUNT: 'the number of other symbols or timeframes a script may request',
  REQUEST_FANOUT: 'how deeply requests may nest',
  MEMORY: 'the memory a script may use',
  WALL_TIME: 'the time one run of a script may take',
})

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
