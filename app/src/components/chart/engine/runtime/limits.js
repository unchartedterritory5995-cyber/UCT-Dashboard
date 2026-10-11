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
  CALL_COUNT: 5000000,
  ARRAY_ELEMENTS: 100000,
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
  // rewritten on every bar of a 20,000-bar intraday history (`HISTORY`) is 1,000,000
  // calls and is an honest dashboard; 2,000,000 admits it and still bounds a runaway
  // well inside `TOTAL_INSTRUCTIONS`.
  OBJECT_OPERATIONS: 2000000,
  // ⛔⛔ OWNER RULING D5 (2026-10-02, `docs/pine/runtime-pane-switch-on-plan.md`): KEEP
  // the 20,000-bar limit. UIE Phase 2 (2026-10-11) MEASURED the raise and did NOT take
  // it, because the ruling is the owner's to revisit (`runtimeLimitsBudget.measure.test.js`):
  //   * the longest history any chart loads is 32,000 bars (`fullBarsFor`, 30m / 60m),
  //     so 20,000 refuses a full intraday load at bar 0 whatever the script does;
  //   * at 32,000 bars every runtime-only corpus script that runs holds at most 27 MB of
  //     MEMORY estimate (ceiling 64 MB) — columns are 8 bytes a bar, rings / windows /
  //     carried state do not scale with bars — and its time is the pane budget's to stop
  //     by name (`runtime:time-budget`);
  //   * ⛔ it is NOT the intraday blocker for most scripts: a document that needs
  //     TradingView's bar 0 (`meta.runtimeHistory === 'listing'`, 14 of the 16) is
  //     refused on every chart whose history does not reach the listing
  //     (`runtime:history-start`) BEFORE this count is read. Only the other two (inside-bar,
  //     wyckoff) meet this ceiling.
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
