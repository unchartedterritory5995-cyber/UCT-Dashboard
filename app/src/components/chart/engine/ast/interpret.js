// ─── THE INTERPRETER, AND THE ONE LINE THAT MAKES THE TABLE CLOSED ──────────
//
// This is the first code in this product that EXECUTES AN EXPRESSION A USER
// WROTE. Everything else here is arithmetic; the load-bearing line is the
// identifier lookup, and it is load-bearing in a way that is easy to lose in a
// refactor:
//
//     Object.prototype.hasOwnProperty.call(scope, name)      // ✅
//     scope[name]                                            // ⛔
//
// ⛔ `scope[name]` FINDS `toString`, `constructor`, `valueOf` AND EVERY OTHER
// `Object.prototype` MEMBER — and every one of them is a FUNCTION, so a bare
// subscript turns a word a user typed into a callable. `[].constructor.constructor`
// IS `Function` in a browser and `Function('return this')()` is arbitrary code
// from a text box on a live trading surface.
//
// ⭐ THE SHAPE IS A CLOSED TABLE, NOT A DENYLIST, AND THAT IS A MEASURED
// PREFERENCE RATHER THAN A TASTE. Task 2's census resolved `eval`, `exec`,
// `__import__` and `compile` through a naive lookup — and recorded that `open`
// was MISSING from that list because it is shadowed by the `open` SERIES. A
// denylist of bad names gets that backwards: it would have blocked the series
// and let the builtin through on the day the series was renamed. The set of
// nameable things here is `closedTable.json` and there is no other list, so
// nothing outside it can be spelled at all.
//
// ⛔ NO CLOCK, NO NETWORK, NO REGISTRY IMPORT, NO `Math.random`, NO MODULE
// STATE. This module is PURE: the same (ast, bars, inputs) produces the same
// column forever. The conformance log is an equality against a lane in another
// language, so anything non-deterministic makes the two disagree for a reason
// neither is wrong about — and that failure would look exactly like a real
// divergence. `interpret.test.js` proves this STRUCTURALLY, by AST over this
// file's own source, because a grep for `Date` matches the word in a comment.
//
// ⭐ COLUMNAR, NOT PER-BAR. Every function in the table is a whole-series
// reduction, so the walker evaluates each node ONCE into a column and combines
// columns. That is both faster and the only shape in which `maxLookback` is a
// TREE SUM rather than a dataflow analysis — which is what lets Task 7's linter
// be simple enough to be obviously right.
//
// WHAT THIS FILE DOES **NOT** DO, NAMED SO NOBODY READS IT AS COVERED:
//   * the BUDGET ITSELF lives in `budget.js`. What is here is the MEASUREMENT
//     it thresholds — `nodeCount(ast)` and `maxLookback(ast)` — and both are
//     ITERATIVE, so the guard cannot die inside itself on the input it exists to
//     refuse. `interpret` below is still a plain RECURSIVE walk, and that
//     asymmetry is the point: a tree deep enough overflows the stack, that is a
//     `RangeError`, it is an ESCAPE, and it must never be dressed up as a table
//     refusal. There is no `try` anywhere in this file, and `budget.test.js`
//     asserts that structurally so the relabelling cannot be introduced quietly.

import {
  TABLE, NODE_TYPES, RECURRENCES, RECURRENCE_BINDINGS, BAR_READERS, ARG_DOMAINS,
  ARG_DOMAIN, isPointwise, LOOKBACK_RE, SESSION_LOOKBACK, SESSION_MAX_BARS,
} from './parse.js'
// ⚠️ A REAL ES MODULE CYCLE, DELIBERATELY — `budget.js` imports `maxLookback`,
// `nodeCount` and `TableRefusal` back out of this file, because a second copy of
// either measurement is a second grammar (there are already two `maxLookback`s
// in this directory and Task 7 paid for the second with an agreement rail). It
// resolves because every cross-module use is inside a function body and
// `export function` bindings are hoisted; `budget.js`'s header states the whole
// contract and `budget.test.js` proves it from a graph whose ENTRY is that file.
import { assertBudget } from './budget.js'

// ⭐⭐ THE LANE'S ONE ANSWER TO "DOES THIS TREE YIELD A YES/NO", IMPORTED RATHER
// THAN RE-DERIVED. `assertArgRoles` below needs it for the manifest's
// `_functions_arg_role_kinds` declaration, and this directory has already paid
// for a second reader of that question: `pine.js::treeYieldsBool` used to walk
// the table itself, agreed with `yieldsOf` on the day it was written, and said
// `false` for every `clock` entry the moment tableVersion 2 declared five of
// them `bool`. `sentence.js` imports only `parse.js`, so this adds no cycle.
import { yieldsOf, SENTENCE_RULES } from './sentence.js'

// ⭐⭐ THE INDICATORS ARE NOT WRITTEN HERE. `indicators.js` is the maths the
// CHART draws, and `api/services/indicator_compute.py` is the same maths on the
// server; `tests/fixtures/indicators/` already pins those two against each other
// at rel-tol 1e-9, case by case, which is the only reason a formula calling them
// can be promised to agree across the lanes at all. A private RSI in this file
// would be a THIRD implementation and a second authority over one value —
// `closedTable.json::_functions_indicators` records the decision.
//
// ⚠️ THIS IMPORT IS WHY `tools/ast_conformance.py`'s node driver reaches
// `indicators.js`. That module imports nothing and touches no DOM, so a bare
// `node` resolves it exactly as vite does.
import {
  computeRSI, computeMACD, computeATR, computeADX, computeStochastic,
  computeCCI, computeWilliamsR, computeMFI, computeDonchian, computeIchimoku,
  computeClock, computeVWAP, computeAVWAP, computeOBV, AVWAP_MIN_INSTANT,
} from '../../indicators.js'

// --------------------------------------------------------------------------- //
// refusals
// --------------------------------------------------------------------------- //

/** The closed table saying no, at INTERPRET time. Carries the guard that fired.
 *
 *  ⚠️ A DIFFERENT CLASS FROM `parse.js`'s `TableRefusal`, deliberately, and both
 *  are exported under that name from their own module. The census recognises a
 *  refusal BY TYPE, and the two doors refuse different things: `canonicalise`
 *  refuses SHAPES the tree may not have, this refuses NAMES the tree may not
 *  reach. A single shared class would let a canonicalise guard's deletion be
 *  covered by an interpret guard's test. */
export class TableRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'TableRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s SET TOO. Two gates sharing a
 *  phrase let a `toThrow(/…/)` pass with the safety deleted, and that has
 *  happened in this repo (C Task 9's M1). `interpret.test.js` asserts the
 *  disjointness over the UNION of both modules' tables, not just this one. */
export const REFUSALS = Object.freeze({
  'resolve:name': 'unknown name',
  'resolve:function': 'unknown function',
  'resolve:arity': 'wrong number of arguments',
  'resolve:window': 'a window must be a whole-number literal',
  'resolve:condition': 'a condition argument must be a 0/1 column, and this one is a number',
  'resolve:domain': 'a period reaches past the window its own entry declares',
  'interpret:node': 'not a canonical node',
  'interpret:operator': 'unknown operator',
  'interpret:offset': 'an offset node carries a whole-number count of bars',
  'interpret:recurrence': 'a running value reads its own past only inside its own update, and only through operators and pointwise calls',
  'interpret:timeframe': 'a higher-timeframe read names a timeframe this engine cannot serve from the bars it was given',
  'interpret:steps': 'warming this running value up over these bars would take more steps than the engine will spend',
})

/** ⭐ THE HIGHER-TIMEFRAME LADDER, LOW TO HIGH — the mirror of
 *  `ast_interpret.TF_LADDER`. `tf` may only read a timeframe STRICTLY ABOVE the
 *  bars it was handed; asking a daily series for a 5-minute value cannot be
 *  answered from the bars in hand, and inventing one is the silent
 *  mistranslation this engine exists against. */
export const TF_LADDER = Object.freeze(['1', '5', '15', '30', '60', 'D', 'W', 'M'])

/** Which of those can actually be RESAMPLED today. ⚠️ Deliberately smaller than
 *  the ladder: the ladder is what an ORDER can be taken over, this is what a
 *  value can be produced for. */
export const TF_RESAMPLABLE = Object.freeze(['W', 'M'])

/** How many BASE bars one higher-timeframe bar spans, for the lookback sum.
 *  ⚠️ TRADING days, not calendar. Too SMALL is the dangerous direction — it
 *  would let a tree claim it needs fewer bars than it reads. */
export const TF_BASE_BARS = Object.freeze({ W: 5, M: 21 })

/** Refuse a `tf` code this engine cannot serve — THE ONE PLACE THAT DECIDES.
 *
 *  ⛔⛔ THIS EXISTS BECAUSE THE ANSWER WAS GIVEN TWICE AND THE COPIES DISAGREED.
 *  `interpret` refused anything outside `TF_RESAMPLABLE`; the `maxLookback` arm
 *  beside it read `TF_BASE_BARS[code] || 1` and let an unknown code fall through
 *  as span 1. In the Python mirror that same split made `assert_scannable` —
 *  which runs `max_lookback` and never `interpret` — stamp `tf(close, '60')` as
 *  **scannable: true** on a member's saved-scan list while every row of the sweep
 *  refused. The member is told the scan will run; it then answers nothing, for
 *  every symbol, and the coverage receipt blames the universe.
 *
 *  ⭐ THE KNOWING SIDE STAMPS ITS ANSWER (`lesson_a_second_authority_over_one_value`).
 *  `TF_RESAMPLABLE` is the authority and this is its only reader.
 *  ⚠️ A span table with a `|| 1` DEFAULT is a second opinion wearing a fallback's
 *  clothes — which is why `TF_BASE_BARS` is now read only AFTER this has run. */
function assertResamplable(code, refuse) {
  if (!TF_RESAMPLABLE.includes(code)) {
    refuse('interpret:timeframe',
      `'${code}' — this engine resamples ${TF_RESAMPLABLE.join(', ')} from the `
      + `bars it is given. The declared ladder is ${TF_LADDER.join(', ')}; a code `
      + 'outside it is not a timeframe this table knows.')
  }
}


const tfRank = (code) => TF_LADDER.indexOf(String(code))

/** One bar's `t` as `YYYY-MM-DD`, whichever way it was stored.
 *
 *  ⛔⛔ THE STORE KEEPS TWO SPELLINGS AND NEITHER IS A DATE STRING: daily/weekly/
 *  monthly `t` is a **YYYYMMDD int**, intraday `t` is **unix seconds** (measured
 *  2026-08-27: `{t: 20260827, …}`). Reading one as the other dates every
 *  higher-timeframe bar to 1970 — and the column still DRAWS, which is the shape
 *  of defect this engine refuses everywhere else.
 *
 *  ⚠️ RETURNS null RATHER THAN GUESSING. A placed-wrong bar is worse than an
 *  absent one. Mirrors `ast_interpret._iso_day`. */
export function isoDay(t) {
  if (typeof t === 'string') {
    return (t.length >= 10 && t[4] === '-' && t[7] === '-') ? t.slice(0, 10) : null
  }
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  const n = Math.trunc(t)
  if (n >= 19000101 && n <= 99991231) {
    const y = Math.trunc(n / 10000)
    const m = Math.trunc((n % 10000) / 100)
    const d = n % 100
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  if (n > 0 && n < 4102444800) {
    const [y, m, d] = civilFromDays(Math.floor(n / 86400))
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** Days since 1970-01-01 \u2192 (year, month, day), and back. Howard Hinnant's civil
 *  algorithms, in integer arithmetic only.
 *
 *  \u26d4\u26d4 `Date` IS FORBIDDEN IN THIS MODULE, AND A RAIL SAYS SO BY NAME:
 *  `NO clock, NO randomness, NO I/O, NO globals \u2014 by AST over its own source`
 *  walks this file and refuses a free identifier `Date`. It caught the first
 *  draft of `isoDay`, which used `new Date(n * 1000).toISOString()`.
 *
 *  \u2b50 AND THE RAIL IS RIGHT EVEN THOUGH THAT CALL WAS DETERMINISTIC. `new
 *  Date(x)` with an argument reads no clock \u2014 but a source-level rail cannot
 *  tell it from `new Date()`, and a rail that had to would be one that could be
 *  argued with. Integer arithmetic removes the question instead of answering it,
 *  and it removes the TIMEZONE surface with it: there is no locale, no DST and no
 *  host offset anywhere in a bar's date now. */
function civilFromDays(z0) {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524)
    - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return [y + (m <= 2 ? 1 : 0), m, d]
}

function daysFromCivil(y0, m, d) {
  const y = y0 - (m <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The ISO (year, week) an ISO day falls in — Python's `date.isocalendar()[:2]`.
 *
 *  ⛔ THE THURSDAY RULE IS THE WHOLE ALGORITHM, and it is why this is not
 *  "day-of-year over seven": ISO puts a week in the year that owns its Thursday,
 *  so the last days of December can belong to week 1 of the next year and the
 *  first days of January to week 52/53 of the previous one. Getting that wrong
 *  misaligns the two lanes by a period at every year boundary — once a year,
 *  silently, in a number a member trades on. */
function isoWeekKey(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const z = daysFromCivil(y, m, d)
  // 1970-01-01 was a THURSDAY, so `((z + 3) mod 7) + 1` is Mon=1 \u2026 Sun=7 with no
  // calendar object involved. `%` is remainder, not modulo, so the +7 keeps it
  // non-negative for pre-epoch dates rather than answering a negative weekday.
  const dow = (((z + 3) % 7) + 7) % 7 + 1
  const zThu = z + (4 - dow)                        // this week's Thursday
  const [year] = civilFromDays(zThu)
  const week = Math.floor((zThu - daysFromCivil(year, 1, 1)) / 7) + 1
  return `${year}-W${week}`
}

/** The higher-timeframe bucket key for an ISO day. Mirrors `_tf_bucket`. */
export function tfBucket(iso, code) {
  if (code === 'W') return isoWeekKey(iso)
  return iso.slice(0, 7)                             // YYYY-MM
}

/** Resample ISO-dated bars into higher-timeframe bars, in order.
 *
 *  ⛔⛔ THIS IS A MIRROR OF `bars_fetch._resample_weekly_iso`, NOT A SECOND
 *  DESIGN — AND THE ASYMMETRY IS DELIBERATE AND STATED. Python's lane consumes
 *  that function because it OWNS what a weekly bar is; this lane has no such
 *  module, so the aggregation is written here and held equal to Python's by the
 *  conformance corpus, exactly as every other pair in this engine is
 *  (`interpret.js` ⇄ `ast_interpret.py` are already two implementations of
 *  everything). ⚠️ If they ever disagree the corpus goes red, which is the only
 *  acceptable way for two lanes to hold one meaning. */
function resampleTo(bars, isos, code) {
  const out = []
  const at = new Map()
  for (let i = 0; i < bars.length; i++) {
    const iso = isos[i]
    if (!iso) continue
    const key = tfBucket(iso, code)
    const b = bars[i]
    if (!at.has(key)) {
      at.set(key, out.length)
      out.push({ t: iso, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    } else {
      const w = out[at.get(key)]
      w.h = Math.max(w.h, b.h)
      w.l = Math.min(w.l, b.l)
      w.c = b.c
      w.t = iso
      w.v += (b.v || 0)
    }
  }
  return { htf: out, at }
}

function refuse(guard, detail) {
  throw new TableRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

/** The ceiling on `bars × warmup` for one recurrence — the ONE cost in this
 *  engine that `budget.js` cannot threshold.
 *
 *  ⭐ IT LIVES HERE RATHER THAN IN `budget.js` BECAUSE IT NEEDS THE BARS. Every
 *  other cap is a property of the TREE and is decided before a single bar is
 *  fetched; this one is a property of the tree AND the request, so putting it in
 *  the static budget would mean thresholding a number that module cannot see.
 *
 *  ⚠️ ONE NUMBER FOR BOTH LANES, AND THAT IS WHY IT IS THIS LOW. The Python
 *  walker is plain loops on purpose (numpy would change summation order and cost
 *  the 1e-9 parity), so it is ~40× slower per step than the JS one and IT is
 *  what this bounds. A per-lane ceiling would be two engines: the same formula
 *  would draw on a chart and refuse in an alert, which is the one divergence a
 *  cross-lane parity run is blind to because both lanes would be internally
 *  consistent.
 *
 *  ⏳ WHAT WOULD RAISE IT: a scan needs only the LAST bar, so a last-bar-only
 *  entry point costs `warmup` steps instead of `bars × warmup` and would let a
 *  sweep carry a 500-bar warm-up over the whole universe. That is an API change
 *  in both lanes, not a number change here. */
export const MAX_RECURRENCE_STEPS = 1000000

/** How far back a running value may read its OWN past — `self[k]`.
 *
 *  ⭐ FOUR IS DERIVED, NOT CHOSEN. The deepest classical recursive filter in
 *  common use is 2-pole (Butterworth / SuperSmoother / Ehlers), which needs
 *  `self[1]`; 4 leaves headroom for a 4-pole design without opening the door to a
 *  history nobody would author by hand. ⛔ IT MUST STAY SMALL: the history is
 *  carried per STEP, and the step loop already runs `bars x warmup` times, so a
 *  deep lag is paid on every bar of every symbol in a universe sweep. */
export const MAX_SELF_LAG = 4

/** ⛔ THE ONLY WAY THIS MODULE ASKS WHETHER A NAME EXISTS. `name in obj` walks
 *  the prototype chain and `obj[name]` returns whatever it finds there. */
const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

const declared = (obj) => Object.keys(obj).join(', ')

// --------------------------------------------------------------------------- //
// columns
// --------------------------------------------------------------------------- //

/** A value the walker produced → an input-length, NaN-padded `Float64Array`.
 *
 *  ⭐ `bars.length`, ALWAYS, AND NEVER THE VALUE'S OWN LENGTH. `computeFor`
 *  returns one column per key aligned to the bar count (spec §4) and the binder
 *  converts NaN to LWC whitespace. A column that is SHORTER silently shifts
 *  every index — a scalar formula (`20`) is the case that proves it, because its
 *  value has no length at all. */
function toColumn(value, length) {
  const col = new Float64Array(length)
  col.fill(NaN)
  if (typeof value === 'number') {
    if (Number.isFinite(value)) col.fill(value)
    return col
  }
  if (!value || typeof value.length !== 'number') return col
  const n = Math.min(value.length, length)
  for (let i = 0; i < n; i++) {
    const v = value[i]
    col[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
  }
  return col
}

const isColumn = (v) => v instanceof Float64Array

const nan = (n) => { const c = new Float64Array(n); c.fill(NaN); return c }

// --------------------------------------------------------------------------- //
// the table's functions
// --------------------------------------------------------------------------- //
//
// ⚠️ EVERY IMPLEMENTATION BELOW RECEIVES A `Float64Array` FOR A `series`
// ARGUMENT AND A PLAIN NUMBER FOR AN `int` ONE. The coercion happens once, in
// the walker, driven by `TABLE.functions[name].args` — so no implementation
// carries its own idea of what its arguments are, and a table edit reaches every
// one of them at once. ⛔ NO COUNT HERE. This comment said "all eleven" while the
// table held eleven, which is the hand-typed-count-beside-the-list defect the
// ledger is full of; `interpret.test.js` asserts the key sets are EQUAL, which
// is the claim a number was only ever approximating.
//
// ⭐ NaN IS A WARMUP, NOT A ZERO, AND IT PROPAGATES. A fabricated 0 during a
// 199-bar warmup is a number a user could arm an alert on. Every reduction
// below emits NaN until its window is full, and any NaN INSIDE a window makes
// that window's output NaN.

/** Rolling reduction over a full window. NaN before bar `n-1`. */
function rolling(series, n, reduce) {
  const out = nan(series.length)
  for (let i = n - 1; i < series.length; i++) out[i] = reduce(series, i - n + 1, i)
  return out
}

function windowMean(series, lo, hi) {
  let sum = 0
  for (let i = lo; i <= hi; i++) sum += series[i]
  return sum / (hi - lo + 1)
}

function windowExtreme(series, lo, hi, better) {
  let best = series[lo]
  for (let i = lo; i <= hi; i++) {
    const v = series[i]
    if (Number.isNaN(v)) return NaN          // explicit: NaN does not lose a comparison
    if (better(v, best)) best = v
  }
  return best
}

/** WHICH BAR holds the window's extreme, as an offset back from `hi`.
 *
 *  ⛔⛔ THE TIE-BREAK IS THE MOST RECENT BAR, AND IT IS THE MANIFEST'S RULING,
 *  NOT THIS FUNCTION'S — `closedTable.json::_functions_arg_extreme` argues it
 *  out loud. `windowExtreme` returns the same NUMBER whichever of two equal bars
 *  won, so nothing above it can see the choice; this one names a BAR, and two
 *  hand-written lanes each picking a side would agree on every fixture that
 *  happens to contain no tie.
 *
 *  ⚰️ AND THIS SENTENCE ENDED *"The committed 579-bar corpus contains none"* —
 *  WHICH IS FALSE. Measured on that series: **56** of its 5-bar `high` windows
 *  and **36** of its `low` windows hold their extreme TWICE, and every one of
 *  them separates the two conventions, so the frozen digests DO move if the
 *  ruling flips. The blindness is real as a CLASS and not true of THIS corpus.
 *  ⛔ IT SURVIVED IN FOUR PLACES because it was written once and mirrored —
 *  the Python twin, the manifest note, and the test's own docstring — and four
 *  agreeing copies read as certainty. See
 *  `closedTable.json::_functions_arg_extreme` for what the corpus still cannot
 *  reach, and why the constructed fixture is not redundant.
 *
 *  ⭐ DERIVED FROM THE VALUE RATHER THAN COMPUTED BESIDE IT, so
 *  `high[highestbars(high, n)] === highest(high, n)` holds BY CONSTRUCTION and
 *  the NaN rule (*"NaN does not lose a comparison"*) is inherited rather than
 *  restated — a second scan with its own comparison would be a second authority
 *  over one window. `ast_interpret._window_arg_extreme` is the same two steps. */
function windowArgExtreme(series, lo, hi, better) {
  const best = windowExtreme(series, lo, hi, better)
  if (Number.isNaN(best)) return NaN
  // ⭐ BACKWARD FROM THE BAR BEING WRITTEN: the FIRST match is the MOST RECENT
  // one. Bounded by `lo` rather than run open — a walk that could step past the
  // window would read `undefined` forever and never terminate.
  for (let i = hi; i >= lo; i--) if (series[i] === best) return hi - i
  // ⚠️ UNREACHABLE WHILE `windowExtreme` HOLDS ITS CONTRACT — it only ever
  // returns a member of `series[lo..hi]`. NaN rather than a throw because a
  // broken extreme must not become an escape inside the walker.
  return NaN
}

/** `pivothigh`/`pivotlow` — the bar's own value where it is the STRICT extreme of
 *  `[i-left, i+right]`, and NOT COMPUTABLE everywhere else.
 *
 *  ⭐⭐ THE ONLY IMPLEMENTATION IN THIS FILE THAT READS A LATER BAR, and it is
 *  legal precisely because the entry DECLARES it: `forward: 'arg2'` is what
 *  `modeFromReach` turns into `preview-repaints`. A user's formula still cannot
 *  SPELL a forward reference — the `offset` node is backward-only and `parse.js`
 *  refuses a negative at the door — so the manifest stays the single authority
 *  on forward reach.
 *
 *  ⛔ STRICT, SO A PLATEAU IS NOT A PIVOT. Two equal maxima mean neither bar is
 *  uniquely the extreme. A `>=` reading emits both and looks entirely
 *  reasonable; on the committed 579-bar corpus it would emit 20 extra bars in
 *  `high` and 15 in `low`.
 *
 *  ⛔ AND BOTH EDGES ARE NOT COMPUTABLE, FOR THE SAME REASON IN TWO DIRECTIONS.
 *  The TAIL is the interesting one: those bars are *not yet decidable*, not
 *  *decided false* — they read the same blank, and the difference only shows
 *  when more bars arrive. That is what the badge means.
 *  `ast_interpret._pivot_col` is the same two loops. */
function pivotCol(series, left, right, beats) {
  // ⚠️ THE `- right` IS DEFENSIVE HERE AND LOAD-BEARING IN THE PYTHON TWIN.
  // Deleting it SURVIVES in this lane — an out-of-bounds read is `undefined`,
  // every comparison against it is false, so the tail bars blank anyway — while
  // Python raises IndexError and the same mutation is KILLED there. Two lines
  // that look like twins, doing different work.
  const out = nan(series.length)
  for (let i = left; i < series.length - right; i++) {
    const v = series[i]
    if (Number.isNaN(v)) continue
    let ok = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      const w = series[j]
      // ⭐ A HOLE ANYWHERE IN THE WINDOW MAKES THE ANSWER UNKNOWN — the same rule
      // `windowExtreme` states out loud.
      //
      // ⚠️ AND THE `Number.isNaN` HALF IS REDUNDANT BY CONSTRUCTION TODAY,
      // MEASURED: deleting it is an EQUIVALENT MUTANT (W2a.6 sweep, 0 differing
      // bars on every fixture including a holed one). `v` is finite by the check
      // above and `finite > NaN` is false, so `!beats(v, w)` already blanks the
      // bar. ⛔ KEPT to state the rule at the site, and because it stops being
      // redundant the moment `beats` is anything but a strict comparison — not
      // because it guards anything today (`lesson_gate_that_cannot_fail`).
      if (Number.isNaN(w) || !beats(v, w)) { ok = false; break }
    }
    if (ok) out[i] = v
  }
  return out
}

function windowSum(series, lo, hi) {
  let total = 0
  for (let i = lo; i <= hi; i++) total += series[i]
  return total
}

// --------------------------------------------------------------------------- //
// the BOUNDED STATE pair — one forward pass each, not a window scan
// --------------------------------------------------------------------------- //
//
// ⭐ BAR-TO-BAR, NOT `rolling`. A window scan over `n` bars is O(bars × n) and
// these two have an exact recurrence, so they are one pass. The state is what
// the recurrence needs and no more:
//
//   `since` — bars since the last TRUE condition bar, or `null` when no true bar
//             lies in the contiguous READABLE run ending here.
//   `run`   — how many contiguous READABLE condition bars end here, capped at
//             `n` because nothing above `n` changes an answer.
//
// ⛔ `run` IS THE HOLE RULE AND THE LEFT EDGE AT ONCE, which is why it is not a
// bar counter: a NOT-COMPUTABLE condition bar RESETS it, so a sentinel is never
// reported across a bar this engine could not read — and the first `n - 1` bars
// of any series are the same case, because the window runs off the front of the
// FETCH. See `closedTable.json::_functions_bounded_state`.

/** `barssince(cond, n)` — bars since `cond` was last true, capped at `n`.
 *
 *  ⛔ `n` IS A SENTINEL, NOT A COUNT. It means *"not true within the last n
 *  bars"*, and it may only be said once `n` readable condition bars have been
 *  seen. ⛔ AND IT IS NOT TC2000's `-1`: that spelling belongs to the PCF
 *  translation of `SinceTrue`, which already composes it from `accum(-1, …)`. */
function barsSince(cond, n) {
  const out = nan(cond.length)
  let since = null
  let run = 0
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i]
    if (Number.isNaN(c)) { since = null; run = 0; continue }
    run = run < n ? run + 1 : n
    if (c !== 0) since = 0
    else if (since !== null) since = since < n ? since + 1 : n
    // ⭐ A HIT THIS ENGINE CAN SEE IS FINAL however short the fetch: no wider one
    // can insert a NEARER true bar. Only the sentinel is a claim about bars that
    // had to be read.
    if (since !== null) out[i] = since
    else if (run >= n) out[i] = n
  }
  return out
}

/** `valuewhen(cond, src, n)` — `src` as it stood at the most recent true bar
 *  within `n`.
 *
 *  ⛔ NOT COMPUTABLE RATHER THAN STALE once the last hit leaves the window. A
 *  price carried past its declared window is a confident wrong number, and the
 *  declaration would stop being true of the value.
 *
 *  🔴 THE NaN PREFIX MEETS X23 — a comparison over it reads as a confident FALSE
 *  and its negation as a confident TRUE, so a scan returns nothing or the whole
 *  universe. Not this entry's to fix; declared at
 *  `closedTable.json::_functions_bounded_state`. */
function valueWhen(cond, src, n) {
  const out = nan(cond.length)
  let since = null
  let held = NaN
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i]
    if (Number.isNaN(c)) { since = null; held = NaN; continue }
    if (c !== 0) { since = 0; held = src[i] }
    else if (since !== null) since = since < n ? since + 1 : n
    if (since !== null && since < n) out[i] = held
  }
  return out
}

/** Pine's `ta.dev`: the MEAN ABSOLUTE deviation about the window's simple average.
 *
 *  ⛔ NOT `windowStdev`, WHICH IS THE ROOT-MEAN-SQUARE ONE. They differ on every
 *  real series, and CCI is defined on this one — mapping `dev` to `stdev` returns a
 *  plausible CCI that is wrong on every bar, which is precisely the look-alike
 *  failure the PCF refusal table exists to prevent. */
function windowMeanAbsDev(series, lo, hi) {
  const avg = windowMean(series, lo, hi)
  let total = 0
  for (let i = lo; i <= hi; i++) total += Math.abs(series[i] - avg)
  return total / (hi - lo + 1)
}

// ⚰️ THIS DOCSTRING SAT ABOVE `windowSum` AT HEAD, AND W2a.5's
// `windowArgExtreme` LANDED BETWEEN THE TWO — leaving a pair of stacked
// `/** … */` blocks describing neither of the functions under them. Moved to
// its subject rather than re-stacked: a docstring one function away from what
// it describes is the same claim-about-the-wrong-mechanism defect as a wrong
// comment, and this one names a DIVISOR the two lanes are held equal on.
/** POPULATION standard deviation — divisor `n`, not `n - 1`.
 *
 *  ⚠️ NAMED OUT LOUD BECAUSE THE CORPUS SAYS IT IS INVISIBLE OTHERWISE: a
 *  population/sample disagreement between the lanes has the same tree, the same
 *  column length and the same NaN pad, and shows up only in the number. This
 *  matches `indicators.js::computeBB` (`Math.sqrt(sqSum / period)`), so a
 *  user's `sma(close,20) + 2*stdev(close,20)` draws the same band the native
 *  Bollinger definition draws. The Python lane must use the same divisor. */
function windowStdev(series, lo, hi) {
  const avg = windowMean(series, lo, hi)
  let sq = 0
  for (let i = lo; i <= hi; i++) sq += (series[i] - avg) ** 2
  return Math.sqrt(sq / (hi - lo + 1))
}

/** EMA seeded with the SMA of the first full window, `k = 2 / (n + 1)`.
 *
 *  ⚠️ THE SEED IS A DECISION AND IT MATCHES THE NATIVE LANE. `indicators.js::_ema`
 *  seeds with `values.slice(0, period)`'s mean and emits its first value at
 *  index `period - 1`; so does this. A NaN in the input RESTARTS the seed — the
 *  warmup of a composed series (`ema(sma(close,20), 9)`) is exactly that case,
 *  and an EMA that carried its state across a hole would be reporting an average
 *  of bars it never saw. */
/** ⭐ ONE SMOOTHER, TWO CONSTANTS. `ema` passes `2 / (n + 1)` and `rma` (Wilder's)
 *  passes `1 / n`; the seed, the restart-on-a-hole and the NaN prefix are shared
 *  BY CONSTRUCTION rather than by two loops that agree today. See
 *  `closedTable.json::_functions_smoothing` for why the alpha is what is shared
 *  and the PERIOD is not. */
function smoothCol(series, n, k) {
  const out = nan(series.length)
  let prev = NaN
  let count = 0
  let sum = 0
  for (let i = 0; i < series.length; i++) {
    const v = series[i]
    if (!Number.isFinite(v)) { prev = NaN; count = 0; sum = 0; continue }
    if (Number.isNaN(prev)) {
      sum += v
      count += 1
      if (count === n) { prev = sum / n; out[i] = prev }
    } else {
      prev = prev * (1 - k) + v * k
      out[i] = prev
    }
  }
  return out
}

const emaCol = (series, n) => smoothCol(series, n, 2 / (n + 1))
const rmaCol = (series, n) => smoothCol(series, n, 1 / n)

/** The linearly weighted mean of `[lo, hi]` — the most recent bar carries the
 *  most weight. ⚠️ NaN PROPAGATES through the sum, which is what makes the
 *  warm-up of a composed argument show as a hole rather than as a lighter
 *  average of the bars that happened to be there. */
function windowWeightedMean(series, lo, hi) {
  let weighted = 0
  let weights = 0
  for (let i = lo; i <= hi; i++) {
    const w = i - lo + 1
    weighted += series[i] * w
    weights += w
  }
  return weighted / weights
}

function elementwise1(a, f) {
  const out = nan(a.length)
  for (let i = 0; i < a.length; i++) out[i] = f(a[i])
  return out
}

function elementwise2(a, b, f) {
  const out = nan(a.length)
  for (let i = 0; i < a.length; i++) out[i] = f(a[i], b[i])
  return out
}

/** `{0, 1, NaN}` AND NOTHING ELSE — spec §3.1's event domain.
 *
 *  ⛔ NOT `true`/`false`. `nativeRegistry`'s `validateEventColumns` already
 *  refuses a 0.5 at registration for a native; a formula must not be the way in.
 *  Alerts, the screener and the Python AST lane all consume this one shape, and
 *  a JS `true` round-trips through JSON as `true`, not as 1. */
function crossing(a, b, fired) {
  const out = nan(a.length)
  for (let i = 1; i < a.length; i++) {
    const an = a[i]; const bn = b[i]; const ap = a[i - 1]; const bp = b[i - 1]
    if (Number.isNaN(an) || Number.isNaN(bn) || Number.isNaN(ap) || Number.isNaN(bp)) continue
    out[i] = fired(an, bn, ap, bp) ? 1 : 0
  }
  return out
}

// --------------------------------------------------------------------------- //
// the indicators — a BINDING to the chart's own maths, never a second copy
// --------------------------------------------------------------------------- //
//
// ⭐ THREE HELPERS AND NOTHING ELSE. Everything below is (1) pack the declared
// `series` columns into the `{h,l,c,v}` bar shape `indicators.js` reads, (2) call
// the shipped function, (3) unpack its `{time, value}` points back into a
// NaN-padded column. `api/services/ast_interpret.py` carries the SAME three, in
// the same order, against the same shipped functions — so the two lanes differ
// only where `indicators.js` and `indicator_compute.py` already differ, which is
// the thing the golden fixtures measure.

/** ⭐⭐ THE FIRST BAR FROM WHICH EVERY INPUT COLUMN IS FINITE TO THE END — and
 *  this is the load-bearing half of the whole binding.
 *
 *  🔴 THE MEASURED REASON, NOT A PRECAUTION. `indicators.js` and
 *  `indicator_compute.py` are written for BARS, and a bar is finite. Hand either
 *  one a NaN and the two languages stop agreeing: `compute_atr_raw`'s
 *  `max(h - l, abs(h - prev_c), abs(l - prev_c))` with a NaN `prev_c` returns
 *  Python's FIRST argument, because every NaN comparison is false and `max`
 *  keeps the incumbent — while `Math.max` returns NaN. Same expression, same
 *  fixture, two answers, and no golden fixture can see it because no fixture
 *  contains a NaN. A composed argument (`atr(high, low, sma(close,3), 14)`) is
 *  how a user reaches it in one keystroke.
 *
 *  ⭐ SO THE SHIPPED MATHS NEVER SEES ONE. The column starts after the LAST
 *  non-finite value in ANY argument, which is `emaCol`'s already-declared rule
 *  ("a NaN in the input RESTARTS the seed") applied to a whole bar. Two things
 *  fall out of it, and both are why this is the right rule rather than a
 *  convenient one:
 *    * `rsi(sma(close, 20), 14)` produces its first value at bar 33 — exactly
 *      the `19 + 14` the manifest's tree sum promises, rather than the all-NaN
 *      column a poisoned Wilder seed produces;
 *    * for an ordinary `close`/`high`/`low`/`volume` argument the start is 0, so
 *      every column this binding returns for an uncomposed call is
 *      byte-identical to calling the shipped function directly.
 *
 *  ⛔ WRITTEN TWICE, HERE AND IN `ast_interpret.py`, deliberately. It is a
 *  CONTRACT between the two lanes, not an optimisation, and the corpus pins it. */
function finiteTailStart(cols, length) {
  let start = 0
  for (const col of cols) {
    for (let i = length - 1; i >= start; i--) {
      if (!Number.isFinite(col[i])) { start = i + 1; break }
    }
  }
  return start
}

/** Pack the declared series columns into bars, run the chart's own maths over
 *  them, and unpack the result into a NaN-padded column of exactly `length`.
 *
 *  ⚠️ `t` IS SET AND NEVER READ BY ANY BOUND FUNCTION. It exists because
 *  `blank(bars)` writes `{time: b.t}` into every output point, and an
 *  `undefined` there is harmless only for as long as nobody looks — a bar index
 *  keeps that honest and costs nothing. ⛔ It is NOT the real timestamp, which
 *  is exactly why `vwap` WAS refused (`_functions_excluded`) for as long as this
 *  table has existed: a session anchor cannot be reconstructed from a column of
 *  prices.
 *
 *  ⭐ AND THAT IS WHY THE ANSWER WAS NOT A SPECIAL CASE HERE. An entry declaring
 *  `reads: 'bars'` takes no series arguments, so it has nothing to pack; it is
 *  handed `interpret`'s OWN bar array by `barColumn` below and reads the real
 *  instant. This adapter is unchanged, and its fabricated `t` still means
 *  exactly what it says.
 *
 *  ⛔ A LENGTH MISMATCH IS ALL-NaN, NOT A PARTIAL FILL. Every bound function
 *  returns either a bar-aligned array or `[]` (its "too short to compute
 *  anything" signal), and `[]` padded from the left would put a real value at
 *  the wrong bar. The Python lane's equivalent refuses the same way, against
 *  that lane's all-`None` form of the same signal. */
function bindShipped(fields, cols, length, run) {
  const out = nan(length)
  const start = finiteTailStart(cols, length)
  const n = length - start
  if (n <= 0) return out
  const bars = new Array(n)
  for (let i = 0; i < n; i++) {
    const bar = { t: i }
    for (let k = 0; k < fields.length; k++) bar[fields[k]] = cols[k][start + i]
    bars[i] = bar
  }
  const points = run(bars)
  if (!Array.isArray(points) || points.length !== n) return out
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const v = p ? p.value : undefined
    out[start + i] = typeof v === 'number' && !Number.isNaN(v) ? v : NaN
  }
  return out
}

/** The domain guard `_functions_domain` declares, as a value rather than a
 *  throw: a call whose periods are out of order computes nothing.
 *
 *  ⛔ WRITTEN TWICE ON PURPOSE — here and in `ast_interpret.py` — because the
 *  two shipped implementations DISAGREE on it. `compute_ichimoku_raw` returns
 *  empty columns when `max(tenkan, kijun) > senkouB`; `computeIchimoku` reads a
 *  negative index and throws a TypeError. Letting either lane's native answer
 *  through would be a cross-lane divergence on an argument list the table
 *  admits, so both lanes answer NaN before the shipped function is reached. */
const outOfOrder = (length) => nan(length)

/** The bar-field name lists the bindings below pack into. THE SHIPPED
 *  FUNCTIONS' parameter shape, never the table's vocabulary — `high` is the
 *  table's name for the series and `h` is the key `indicators.js` reads. */
const HL = Object.freeze(['h', 'l'])
const HLC = Object.freeze(['h', 'l', 'c'])
const HLCV = Object.freeze(['h', 'l', 'c', 'v'])

/** The pointwise functions AS SCALARS — one bar in, one bar out.
 *
 *  ⭐ THE COLUMN FORMS BELOW ARE DEFINED IN TERMS OF THESE, NOT BESIDE THEM, AND
 *  THAT IS THE WHOLE REASON THIS OBJECT EXISTS. A recurrence body is evaluated
 *  one bar at a time (see `runRecurrence`), so `max(self, close)` needs a scalar
 *  `max`; writing a second one there would be two implementations of one
 *  function, and the first thing to diverge would be the NaN rule that the
 *  comment below says was already a measured cross-lane bug.
 *
 *  ⚠️ THE KEY SET IS DERIVED AND ASSERTED, NOT CURATED. `parse.js::isPointwise`
 *  decides which table entries a body may call; `interpret.test.js` asserts that
 *  set equals these keys BOTH WAYS, so a pointwise entry that lands in the
 *  manifest without a scalar form here fails by name rather than refusing inside
 *  a body that looks legal. */
const POINTWISE = Object.freeze({
  abs: (x) => Math.abs(x),
  min: (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y)),
  max: (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y)),
  // ⛔ NOT `Math.sign`, WHICH ANSWERS -0 FOR -0. A signed zero is invisible in
  // every comparison and in the read-back, and it is NOT invisible to a parity
  // run that divides by it — so the three answers are written out.
  sign: (x) => (Number.isNaN(x) ? NaN : (x > 0 ? 1 : (x < 0 ? -1 : 0))),
  // ⛔ NOT `Math.round`, WHICH ROUNDS A HALF TOWARD +∞ WHILE PYTHON'S `round`
  // ROUNDS IT TO EVEN. Pine rounds a half AWAY FROM ZERO and so does this, in
  // both lanes, spelled the same way. See `_functions_rounding`.
  round: (x) => (Number.isNaN(x) ? NaN : POINTWISE.sign(x) * Math.floor(Math.abs(x) + 0.5)),
  // ⭐⭐ THE TWO THAT DO NOT PROPAGATE, AND THEY ARE THE ONLY TWO. `na` INSPECTS
  // not-computable and `nz` REPLACES it — see `_functions_na` for why a table
  // built entirely around NaN meaning "we do not know" declares them anyway.
  na: (x) => (Number.isNaN(x) ? 1 : 0),
  nz: (x, y) => (Number.isNaN(x) ? y : x),

  // ── pure math ────────────────────────────────────────────────────────────
  // ⭐⭐ EVERY DOMAIN REFUSAL ANSWERS NaN, AND THAT IS THE WHOLE DESIGN. JS hands
  // back `-Infinity` for `Math.log(0)` and `NaN` for `Math.sqrt(-1)`; Python
  // RAISES `ValueError` for both. Left to their defaults the two lanes would
  // disagree on the first zero close in the tape — one serving -Infinity, which
  // then COMPARES AS THE SMALLEST THING IN THE UNIVERSE and silently wins every
  // `<` test in a member's scan, and the other blowing up the whole evaluation.
  // NaN is what this table already means by "we do not know", so both lanes say
  // that, in the same place, for the same inputs.
  sqrt: (x) => (Number.isNaN(x) || x < 0 ? NaN : Math.sqrt(x)),
  ln: (x) => (Number.isNaN(x) || x <= 0 ? NaN : Math.log(x)),
  log10: (x) => (Number.isNaN(x) || x <= 0 ? NaN : Math.log10(x)),
  exp: (x) => {
    if (Number.isNaN(x)) return NaN
    const v = Math.exp(x)
    // ⛔ AN OVERFLOW IS NOT AN ANSWER. `exp(1000)` is `Infinity`, which would
    // compare as larger than every threshold a member could write.
    return Number.isFinite(v) ? v : NaN
  },
  pow: (x, y) => {
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN
    const v = Math.pow(x, y)
    // A negative base with a fractional exponent is complex; JS says NaN and
    // Python raises. Both end up here as NaN, and so does an overflow.
    return Number.isFinite(v) ? v : NaN
  },
  // ⛔ MOD FOLLOWS THE SIGN OF THE LEFT OPERAND (C truncation), NOT PYTHON'S
  // FLOORED `%`. `-7 % 2` is `1` in Python and `-1` in JS; TC2000 truncates, so
  // the Python lane spells it out rather than using its own operator.
  mod: (x, y) => (Number.isNaN(x) || Number.isNaN(y) || y === 0
    ? NaN : x - y * Math.trunc(x / y)),
  idiv: (x, y) => (Number.isNaN(x) || Number.isNaN(y) || y === 0
    ? NaN : Math.trunc(x / y)),

  sin: (x) => (Number.isNaN(x) ? NaN : Math.sin(x)),
  cos: (x) => (Number.isNaN(x) ? NaN : Math.cos(x)),
  // ⚠️ `tan` is unbounded near pi/2 but never actually infinite in floating
  // point, so there is no domain refusal to make here — it is left alone.
  tan: (x) => (Number.isNaN(x) ? NaN : Math.tan(x)),
  atan: (x) => (Number.isNaN(x) ? NaN : Math.atan(x)),
  sinh: (x) => {
    if (Number.isNaN(x)) return NaN
    const v = Math.sinh(x)
    return Number.isFinite(v) ? v : NaN
  },
})

/** ⭐ EXPORTED FOR THE CROSS-LANE PARITY RUN, AND FOR NOTHING ELSE.
 *
 *  `tests/test_ast_math_parity.py` drives THIS object and the Python
 *  `_POINTWISE` with the same inputs and compares the answers. It has to be the
 *  real one — a copy exported for testing would agree with itself forever while
 *  the shipped map drifted, which is the second-authority defect this repo pays
 *  for more than any other. Nothing in the app imports it. */
export const POINTWISE_FOR_PARITY = POINTWISE

/** name → implementation. THE KEY SET IS `TABLE.functions`'s, both directions.
 *
 *  ⛔ AN IMPLEMENTED-BUT-UNDECLARED KEY HERE IS A CALLABLE OUTSIDE THE CLOSED
 *  TABLE, which is the one thing this phase exists to make impossible; a
 *  DECLARED-BUT-UNIMPLEMENTED one is a formula the builder offers and the chart
 *  cannot draw. `interpret.test.js` asserts the equality in both directions. */
export const FN = Object.freeze({
  sma: (series, n) => rolling(series, n, windowMean),
  ema: (series, n) => emaCol(series, n),
  highest: (series, n) => rolling(series, n, (s, lo, hi) => windowExtreme(s, lo, hi, (v, b) => v > b)),
  lowest: (series, n) => rolling(series, n, (s, lo, hi) => windowExtreme(s, lo, hi, (v, b) => v < b)),
  // ⭐ THE ARG-EXTREMES, AND THE `better` PREDICATE IS THE SAME SHAPE THE VALUE
  // FORMS PASS — `windowArgExtreme` asks `windowExtreme` for the value and only
  // then names the bar, so the pair cannot disagree about one window and the
  // tie-break is the manifest's ruling rather than this line's.
  highestbars: (series, n) => rolling(series, n, (s, lo, hi) => windowArgExtreme(s, lo, hi, (v, b) => v > b)),
  lowestbars: (series, n) => rolling(series, n, (s, lo, hi) => windowArgExtreme(s, lo, hi, (v, b) => v < b)),
  barssince: (cond, n) => barsSince(cond, n),
  valuewhen: (cond, src, n) => valueWhen(cond, src, n),
  // ⭐ THE PIVOTS, AND THE PREDICATE IS THE WHOLE DIFFERENCE BETWEEN THEM. The
  // STRICT comparison is what makes a plateau not a pivot; `>=` here would emit
  // both bars of a tie. See `closedTable.json::_functions_pivots`.
  pivothigh: (series, left, right) => pivotCol(series, left, right, (v, w) => v > w),
  pivotlow: (series, left, right) => pivotCol(series, left, right, (v, w) => v < w),
  stdev: (series, n) => rolling(series, n, windowStdev),
  sum: (series, n) => rolling(series, n, windowSum),
  dev: (series, n) => rolling(series, n, windowMeanAbsDev),
  change: (series) => {
    const out = nan(series.length)
    for (let i = 1; i < series.length; i++) out[i] = series[i] - series[i - 1]
    return out
  },
  abs: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.abs(series[i])
    return out
  },
  // ⚠️ NaN PROPAGATES, WRITTEN OUT RATHER THAN INHERITED FROM `Math.min`. JS's
  // `Math.min(NaN, x)` is NaN and Python's `min` returns whichever it meets
  // first — a real cross-lane divergence the corpus names explicitly. Spelling
  // the rule kills it in both lanes instead of relying on one language's luck.
  min: (a, b) => elementwise2(a, b, POINTWISE.min),
  max: (a, b) => elementwise2(a, b, POINTWISE.max),
  rma: (series, n) => rmaCol(series, n),
  wma: (series, n) => rolling(series, n, windowWeightedMean),

  // ── pure math, lifted to columns ─────────────────────────────────────────
  // ⭐ EACH ONE IS THE POINTWISE SCALAR APPLIED PER BAR AND NOTHING ELSE, so the
  // maths lives in exactly one place and the parity run drives that place. A
  // second copy written out here is how the column lane and the scalar lane come
  // to disagree about `log(0)` six months from now.
  sqrt: (a) => elementwise1(a, POINTWISE.sqrt),
  ln: (a) => elementwise1(a, POINTWISE.ln),
  log10: (a) => elementwise1(a, POINTWISE.log10),
  exp: (a) => elementwise1(a, POINTWISE.exp),
  sin: (a) => elementwise1(a, POINTWISE.sin),
  cos: (a) => elementwise1(a, POINTWISE.cos),
  tan: (a) => elementwise1(a, POINTWISE.tan),
  atan: (a) => elementwise1(a, POINTWISE.atan),
  sinh: (a) => elementwise1(a, POINTWISE.sinh),
  pow: (a, b) => elementwise2(a, b, POINTWISE.pow),
  mod: (a, b) => elementwise2(a, b, POINTWISE.mod),
  idiv: (a, b) => elementwise2(a, b, POINTWISE.idiv),
  sign: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.sign(series[i])
    return out
  },
  round: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.round(series[i])
    return out
  },
  na: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.na(series[i])
    return out
  },
  nz: (a, b) => elementwise2(a, b, POINTWISE.nz),
  crossOver: (a, b) => crossing(a, b, (an, bn, ap, bp) => an > bn && ap <= bp),
  crossUnder: (a, b) => crossing(a, b, (an, bn, ap, bp) => an < bn && ap >= bp),

  // ── the indicators, bound to the chart's own maths ──────────────────────
  //
  // ⚠️ `computeRSI` and `computeMACD` read ONLY `.c`, so a one-field bar array
  // is the whole adaptation and `rsi(sma(close,20), 14)` is an RSI of a smoothed
  // series rather than a different function. That composability is the reason
  // the table declares a `series` argument instead of reading `close` itself.
  rsi: (s, n) => bindShipped(['c'], [s], s.length, (bars) => computeRSI(bars, n)),

  // ⛔ `signal` IS PINNED TO 1 AND IT IS NOT A HIDDEN DEFAULT. `computeMACD`
  // returns the LINE, the signal and the histogram; this entry declares only the
  // line, and the only thing `signal` still reaches is the guard
  // `bars.length < slow + signal`. 1 is the smallest value that cannot make that
  // guard refuse a series the LINE could have been computed over — a larger one
  // would blank the line on a short series for a reason the declaration does not
  // mention. `compute_macd_raw` is passed the same 1.
  macd: (s, fast, slow) => (fast > slow
    ? outOfOrder(s.length)
    : bindShipped(['c'], [s], s.length, (bars) => computeMACD(bars, fast, slow, 1).macd)),

  atr: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeATR(bars, n)),
  // ⭐ BOUND TO THE SHIPPED IMPLEMENTATION, NEVER COMPOSED. `computeADX`
  // already returns all three lines and is what the chart draws, so `adx`
  // cannot drift from the +DI/-DI a member sees beside it. Composing it from
  // `ema` would have been a LOOK-ALIKE: ADX smooths DX with Wilder's k = 1/n
  // and this table's `ema` is k = 2/(n+1).
  adx: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeADX(bars, n).adx),
  plusDI: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeADX(bars, n).plusDI),
  minusDI: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeADX(bars, n).minusDI),
  // %K only. %D is `sma(stoch(…), d)` — see `_functions_excluded.stochD`, and
  // `dPeriod` is pinned to 1 for the same reason `macd`'s `signal` is: it must
  // not reach a guard this entry's declaration says nothing about.
  stoch: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeStochastic(bars, n, 1).k),
  cci: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeCCI(bars, n)),
  williamsR: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeWilliamsR(bars, n)),
  mfi: (h, l, c, v, n) => bindShipped(HLCV, [h, l, c, v], c.length, (bars) => computeMFI(bars, n)),

  donchianUpper: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).upper),
  donchianMiddle: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).middle),
  donchianLower: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).lower),

  ichimokuTenkan: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'tenkan'),
  ichimokuKijun: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'kijun'),
  ichimokuSpanA: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'spanA'),
  ichimokuSpanB: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'spanB'),
  ichimokuChikou: (h, l, c, t, k, s) => ichimokuLine(h, l, c, t, k, s, 'chikou'),
})

/** One line of the Ichimoku family, with `_functions_domain`'s guard in front.
 *
 *  ⚠️ THE FOUR MIDLINE ENTRIES PASS `high` AS THE CLOSE COLUMN AND THAT IS NOT A
 *  SHORTCUT. `computeIchimoku` reads `.c` for exactly one thing — the lagging
 *  span — so the four lines that do not declare a close argument cannot be
 *  affected by what sits there, and the alternative (a fifth declared series
 *  every one of them ignores) would put a term in the read-back that says
 *  nothing about the number. `chikou` declares its close and passes it. */
function ichimokuLine(h, l, c, tenkan, kijun, senkouB, key) {
  if (Math.max(tenkan, kijun) > senkouB) return outOfOrder(h.length)
  return bindShipped(HLC, [h, l, c], h.length,
    (bars) => computeIchimoku(bars, tenkan, kijun, senkouB)[key])
}

// --------------------------------------------------------------------------- //
// the entries that read the BAR, not a column
// --------------------------------------------------------------------------- //
//
// ⭐⭐ ONE SESSION ACCUMULATOR, TWO NAMES. `computeVWAP` is the ONLY session
// VWAP on this lane — it is what the chart draws — and the bindings below pass
// the bars straight to it. A formula's `vwap()` that disagreed with the VWAP the
// chart draws would be the most legible instance this repo could ship of
// `a second authority over one value`.
//
// ⛔ THE DISPATCH IS DERIVED FROM THE MANIFEST (`BAR_READERS`), never from a
// name typed here, exactly as `RECURRENCES` is — see
// `closedTable.json::_functions_bar_readers`. `BAR_FN`'s key set is asserted
// against it in both directions by `interpret.test.js`, so a declared-but-unbound
// entry fails by name instead of refusing inside the walker with a message about
// the wrong thing.

/** `vwap()` — the shipped session accumulator, untouched.
 *
 *  ⚠️ ITS LEADING PARTIAL SESSION IS INHERITED AND DELIBERATELY NOT TRIMMED. The
 *  first ET day in a series may start after its true open, so those bars move if
 *  the window moves. Trimming them HERE would fork this column away from the one
 *  the chart draws, which is worse than the caveat; it belongs to `computeVWAP`
 *  and to whoever changes it, in both lanes at once. */
const barVwap = (bars) => computeVWAP(bars)

/** `avwap(anchorEpoch)` — the same accumulator restarted at an INSTANT, and
 *  bounded so that `lookback: 'session'` is a TRUE declaration.
 *
 *  ⛔ RULE 1 — THE ANCHOR'S BOUNDARY MUST BE VISIBLE. Some bar of the series must
 *  fall strictly before the anchor. Otherwise "the first bar at or after the
 *  anchor" is whichever bar the caller happened to fetch first, and the value
 *  MOVES when the window moves — `lesson_a_derived_value_must_not_depend_on_the_
 *  request`, the exact defect `_functions_recurrence` says `accum`'s re-seeded
 *  window exists to prevent.
 *
 *  ⛔ RULE 2 — AND IT MAY NOT REACH PAST THE WINDOW IT DECLARES. A raw epoch
 *  reaches back however far a member types, so `lookback: 'session'` would
 *  UNDER-state it — the one direction `_functions_warmup` says a window
 *  declaration may never take. Bars more than `SESSION_MAX_BARS` past the anchor
 *  are NOT COMPUTABLE, so every bar this answers for was computed from inside
 *  the window the manifest promises.
 *
 *  Both are the ordinary warm-up bargain turned round. ⚠️ THEY ARE NOT THE SAME
 *  SHAPE, and saying so matters: RULE 1 refuses the WHOLE COLUMN (nothing about
 *  this series can be answered), while RULE 2 blanks only the TAIL past the
 *  declared window and leaves every bar inside it exact. Neither ever returns a
 *  partial accumulation, which would be a confident wrong number wearing a
 *  warm-up's clothes. */
function barAvwap(bars, args) {
  const anchor = args[0]
  // ⛔ A SUB-1990 ANCHOR IS A UNIT ERROR IN THE TREE, AND IT IS REFUSED BY NAME
  // AT THE TOKEN. `avwap(20250101)` is the store's daily key spelled as an
  // instant; it resolves to 1970 and is wrong for EVERY symbol, on every
  // timeframe, forever — so it is a formula defect and not a per-symbol data
  // condition, and this lane's rule for a formula defect is a named refusal
  // rather than a quiet column. `resolve:window` is the guard that already owns
  // "this `int` argument is not a value this slot can take".
  //
  // ⚠️ THE OTHER REFUSAL BELOW IS DELIBERATELY *NOT* NAMED, and that asymmetry
  // is the whole point: "no bar precedes the anchor" is true of ONE SYMBOL'S
  // HISTORY, not of the tree. Refusing it by name would make one short-history
  // symbol reject a formula that is correct for the rest of the universe —
  // exactly what `_scalars_node` means by "declared but not known for this
  // symbol is a HOLE, not `resolve:name`".
  if (typeof anchor === 'number' && anchor < AVWAP_MIN_INSTANT) {
    refuse('resolve:window',
      `— avwap argument 0 is ${anchor}, which is not a unix-second instant `
      + `(the floor is ${AVWAP_MIN_INSTANT}, 1990-01-01). A date-shaped key like `
      + '20250101 read as seconds anchors in 1970.')
  }
  if (!bars.length) return []
  const first = bars[0] ? bars[0].t : undefined
  // ⭐ `>=`, NOT `>`. An anchor EXACTLY on the first bar is well-defined: any
  // wider fetch adds only bars with `t < bars[0].t`, and those are strictly
  // before the anchor, so they are excluded from the accumulation whatever the
  // window is. Refusing it was a NARROW OVER-REFUSAL — corrected 2026-08-26.
  if (!Number.isFinite(first) || !(anchor >= first)) return []
  const points = computeAVWAP(bars, anchor)
  let ceiling = -1
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(bars[i].t) && bars[i].t >= anchor) { ceiling = i + SESSION_MAX_BARS; break }
  }
  if (ceiling < 0) return points
  for (let i = ceiling + 1; i < points.length; i++) points[i].value = NaN
  return points
}

/** name → `(bars, args) => points`. The key set is `BAR_READERS`'s.
 *
 *  ⚠️ EXPORTED FOR THE RAIL ONLY, like `POINTWISE_FOR_PARITY`. `interpret.test.js`
 *  asserts this against `BAR_READERS` in both directions; nothing in the app
 *  imports it. */
/** `obvN(n)` — on-balance volume's CHANGE across the last `n` bars.
 *
 *  ⭐⭐ IT READS THE BARS BECAUSE IT NAMES NO SERIES. OBV is close-and-volume by
 *  definition, so there is no column to hand it and `bindShipped` has nothing to
 *  pack — the same absence of arguments that finally made `vwap` declarable.
 *
 *  ⛔⛔ THE INCREMENT OF THE SHIPPED ACCUMULATOR, NEVER A SECOND SUM.
 *  `computeOBV` is what the chart draws; differencing it `n` bars apart is the
 *  same arithmetic in one place instead of two, so `obvN` can never drift from
 *  the OBV a member sees beside it.
 *
 *  ⭐ AND THE DIFFERENCE IS WHY THE BOUNDED FORM IS DECLARABLE WHERE THE LEVEL IS
 *  REFUSED (`_functions_excluded.obv`): the level's seed is a fact about where the
 *  fetch started, and it CANCELS — the same bar reads the same number off a
 *  60-bar fetch and off a 260-bar one. The first `n` bars are NOT COMPUTABLE
 *  because their window reaches past the front of the fetch, which is exactly
 *  what `lookback: 'arg0'` declares. */
function barObvN(bars, args) {
  const n = args[0]
  const level = computeOBV(bars)
  if (level.length !== bars.length) return []
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) out[i] = { time: bars[i].t, value: NaN }
  for (let i = n; i < bars.length; i++) {
    const near = level[i] ? level[i].value : undefined
    const far = level[i - n] ? level[i - n].value : undefined
    out[i].value = (typeof near === 'number' && typeof far === 'number')
      ? near - far
      : NaN
  }
  return out
}

/** Chande's Aroon, from the published formula and this table's own arg-extreme.
 *
 *  ⭐ THE PUBLISHED FORM, VERBATIM (StockCharts):
 *  `Aroon-Up = ((25 - Days Since 25-day High)/25) x 100`. "Days Since" is the
 *  number of periods elapsed since the most recent extreme — exactly what
 *  `windowArgExtreme` returns, because `_functions_arg_extreme` ruled that the
 *  MOST RECENT bar wins a tie.
 *
 *  ⛔ THE WINDOW IS `n + 1` BARS, AND THAT IS ARITHMETIC RATHER THAN A CHOICE.
 *  Aroon's published range is 0–100. Over `n` bars "days since" maxes at `n - 1`
 *  and the indicator could never print 0; over `n + 1` it reaches exactly 0.
 *  Pine ships the same reading (`ta.highestbars(high, length + 1)`).
 *
 *  ⭐ AND THE SIGN QUESTION FROM W2a.5 CLOSES HERE. Pine's `highestbars` is
 *  NON-POSITIVE and this table's is the positive distance, so Pine writes
 *  `100 * (hb + n) / n` where this writes `100 * (n - hb) / n` — the two look
 *  opposite and compute the SAME number, which is why `ta.highestbars` is
 *  refused at the Pine door rather than mapped across. */
function aroonCol(bars, n, field, wantMax) {
  const values = new Float64Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i] ? bars[i][field] : undefined
    values[i] = typeof v === 'number' && !Number.isNaN(v) ? v : NaN
  }
  const better = wantMax ? (v, w) => v > w : (v, w) => v < w
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) out[i] = { time: bars[i] ? bars[i].t : i, value: NaN }
  for (let i = n; i < bars.length; i++) {
    const days = windowArgExtreme(values, i - n, i, better)
    if (Number.isNaN(days)) continue
    out[i].value = (100 * (n - days)) / n
  }
  return out
}

const barAroonUp = (bars, args) => aroonCol(bars, args[0], 'h', true)
const barAroonDown = (bars, args) => aroonCol(bars, args[0], 'l', false)

/** Balance of Power — the `n`-bar mean of `(close - open) / (high - low)`.
 *
 *  ⭐ DECLARED THOUGH IT IS A COMPOSITION, AND THE CRITERION IS STATED HERE.
 *  ⚰️ This cited a manifest key named `_functions_compositions` and NO SUCH KEY
 *  HAS EVER EXISTED — one ruling, three comments in two lanes, all pointing at a
 *  manifest that never carried it, so the criterion lived only in a commit
 *  message. The manifest owns the NEGATIVE half in
 *  `closedTable.json::_functions_excluded` (`variance`, `hl2`, `bbMiddle`:
 *  already expressible, so declaring one would compute a second copy of a number
 *  this table already has). The POSITIVE half belongs at the implementation, and
 *  that is here: `bop` earns an entry because it has a PUBLISHED IDENTITY under
 *  its own name, its window is one declarable argument, and it reuses the shipped
 *  rolling mean — so unlike `variance` there is no second average to drift from
 *  the one `sma` uses.
 *  ⛔ `tests/test_closed_table_citations.py` now resolves every
 *  `closedTable.json::<key>` written in source against the manifest, so the next
 *  dangling citation fails by file AND key instead of standing for a month.
 *
 *  ⛔ THE RATIO GOES THROUGH THE SAME SEAM THE OPERATOR PATH USES (IEEE division,
 *  then the finite-or-NaN collapse), so a zero-range bar answers exactly what
 *  `sma((close - open) / (high - low), n)` answers rather than nearly. */
function barBop(bars, args) {
  const n = args[0]
  const ratio = new Float64Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i] || {}
    const r = (b.c - b.o) / (b.h - b.l)
    ratio[i] = Number.isFinite(r) ? r : NaN
  }
  const col = rolling(ratio, n, windowMean)
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    out[i] = { time: bars[i] ? bars[i].t : i, value: col[i] }
  }
  return out
}

export const BAR_FN = Object.freeze({
  vwap: barVwap, avwap: barAvwap, obvN: barObvN,
  aroonUp: barAroonUp, aroonDown: barAroonDown, bop: barBop,
})

// ⛔ A DECLARED-BUT-UNBOUND ENTRY IS A FORMULA THE BUILDER OFFERS AND THIS LANE
// CANNOT DRAW; a bound-but-undeclared one is a callable outside the closed
// table. Both are refused at import, where a wiring defect belongs, rather than
// at the bar a member is looking at.
{
  const declared = [...BAR_READERS].sort().join(',')
  const bound = Object.keys(BAR_FN).sort().join(',')
  if (declared !== bound) {
    throw new Error(
      `closedTable.json declares reads:'bars' for [${declared}] and interpret.js `
      + `binds [${bound}]`)
  }
}

/** Run a bar-reading entry over the REAL bars and unpack a NaN-padded column.
 *
 *  ⛔ A LENGTH MISMATCH IS ALL-NaN, NOT A PARTIAL FILL — the same contract
 *  `bindShipped` states, against the same `[]` "there is nothing to say here"
 *  signal both refusals above return. A short array padded from the left would
 *  put a real value at the wrong bar. */
function barColumn(name, bars, args, length) {
  const out = nan(length)
  const points = BAR_FN[name](bars, args)
  if (!Array.isArray(points) || points.length !== length) return out
  for (let i = 0; i < length; i++) {
    const v = points[i] ? points[i].value : undefined
    out[i] = typeof v === 'number' && !Number.isNaN(v) ? v : NaN
  }
  return out
}

// --------------------------------------------------------------------------- //
// the operators
// --------------------------------------------------------------------------- //
//
// ⭐⭐ THE BOOLEAN DECISION, IMPLEMENTED. `closedTable.json`'s `_booleans` key
// records it and Task 3 handed it here: there is NO boolean node type, because
// the manifest declares `!`, `&&`, `||` and `?:` over a table whose only literal
// is a NUMBER. A condition is therefore a 0/1 column BY CONSTRUCTION, and the
// parser's `true`/`false` already canonicalise to `num 1` / `num 0`.
//
// WHAT IT COSTS, STATED RATHER THAN DISCOVERED:
//   * `1 && 2` is **1**, not 2. JS's value-returning `&&`/`||` are deliberately
//     NOT implemented — they would put a non-{0,1} value in a column the alert
//     grammar reads as a signal.
//   * `0 || 5` is **1**, not 5. Same reason.
//   * `!5` is **0** and `!0` is **1**; there is no `!!x` idiom to write because
//     a comparison is already 0/1.
//   * TRUTHINESS IS `x !== 0`, NOT JS's. In JS every non-zero number and NaN are
//     both truthy; here NaN is not a truth value at all (below).
//
// ⛔ NaN PROPAGATES THROUGH `&&`, `||`, `!` AND `?:` — AND THAT IS THE OPPOSITE
// OF BOTH LANGUAGES' DEFAULTS (`!NaN` is `true` in JS and `not nan` is `False`
// in Python — they already disagree). The `{0,1,NaN}` domain distinguishes "it
// did not happen" from "it is not computable yet", and a warmup that collapsed
// to 0 would be a signal the user can arm an alert on.
//
// ⛔ A COMPARISON AGAINST NaN IS 0, NOT NaN. That is the other half of the same
// decision and it is the one place JS and Python agree by luck (`NaN > x` is
// false in both), so it is pinned rather than assumed.

const isNan = (x) => Number.isNaN(x)

const cmp = (f) => (a, b) => (isNan(a) || isNan(b) ? 0 : (f(a, b) ? 1 : 0))
const logical = (f) => (a, b) => (isNan(a) || isNan(b) ? NaN : (f(a !== 0, b !== 0) ? 1 : 0))

const BINARY = Object.freeze({
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '>': cmp((a, b) => a > b),
  '<': cmp((a, b) => a < b),
  '>=': cmp((a, b) => a >= b),
  '<=': cmp((a, b) => a <= b),
  '==': cmp((a, b) => a === b),
  '!=': cmp((a, b) => a !== b),
  '&&': logical((a, b) => a && b),
  '||': logical((a, b) => a || b),
})

const UNARY = Object.freeze({
  'u-': (a) => -a,
  '!': (a) => (isNan(a) ? NaN : (a !== 0 ? 0 : 1)),
})

const TERNARY = (t, a, b) => (isNan(t) ? NaN : (t !== 0 ? a : b))

// --------------------------------------------------------------------------- //
// the static measurements Task 6's budgets threshold
// --------------------------------------------------------------------------- //

/** Every node of a canonical tree, DESCENDANTS BEFORE PARENTS, iteratively.
 *
 *  ⛔ ITERATIVE ON PURPOSE, AND THIS IS THE WHOLE REASON THE MEASUREMENTS ARE
 *  SEPARATE FUNCTIONS. The escape corpus's `too_many_nodes` case is 8,001 nodes
 *  deep. A recursive counter would die inside the guard rather than inside the
 *  thing being guarded — and a guard that crashes is not a refusal. `parse.js`
 *  made its forbidden-node scan iterative for exactly this reason. */
function flatten(root) {
  const order = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    assertNode(node)
    order.push(node)
    if (node.type === 'op' || node.type === 'call' || node.type === 'offset'
        || node.type === 'tf') {
      if (!Array.isArray(node.args)) {
        refuse('interpret:node', `a ${node.type} node carries an \`args\` array; got ${JSON.stringify(node.args)}`)
      }
      for (const arg of node.args) stack.push(arg)
    }
  }
  order.reverse()          // a reversed pre-order puts every child before its parent
  return order
}

function assertNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    refuse('interpret:node', `got ${JSON.stringify(node) ?? String(node)}`)
  }
  if (!NODE_TYPES.includes(node.type)) {
    refuse('interpret:node',
      `unknown node type ${JSON.stringify(node.type)} — legal types are ${NODE_TYPES.join(', ')}`)
  }
}

/** Every call in a tree whose entry declares `lookback: 'session'`, sorted.
 *
 *  ⭐ EXPORTED FOR THE MESSAGE, NOT FOR A DECISION. `budget.js` refuses on the
 *  NUMBER, exactly as it always has; this only lets the refusal say WHY a
 *  formula a member will type first — `crossOver(close, vwap())` — measures 961
 *  against a cap of 960. A session-anchored call spends the WHOLE lookback
 *  budget by construction (the cap is derived to hold one session), so anything
 *  wrapped around it is over by the width of the wrapper, and the bare number
 *  reads like an arbitrary rejection.
 *
 *  ⛔ IT NAMES, IT DOES NOT EXEMPT. Nothing here changes which trees are
 *  admitted. */
export function sessionAnchoredIn(ast) {
  const found = new Set()
  const stack = [ast]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (Array.isArray(n)) { stack.push(...n); continue }
    if (n.type === 'call' && typeof n.name === 'string'
        && own(TABLE.functions, n.name)
        && TABLE.functions[n.name].lookback === SESSION_LOOKBACK) {
      found.add(n.name)
    }
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return [...found].sort()
}

/** The declared spec for a called name, or `resolve:function`. */
function fnSpec(name) {
  if (!own(TABLE.functions, name)) {
    refuse('resolve:function', `${JSON.stringify(name)} — this table declares ${declared(TABLE.functions)}`)
  }
  return TABLE.functions[name]
}

function assertArity(node, spec) {
  if (node.args.length !== spec.args.length) {
    refuse('resolve:arity',
      `— ${node.name} expects ${spec.args.length} arguments, got ${node.args.length}`)
  }
}

/** role name → the `yields` kind an argument in that role must settle to.
 *
 *  ⭐ READ OFF THE MANIFEST, NEVER TYPED. `_functions_arg_role_kinds` is the
 *  declaration and `_`-prefixed keys inside it are its own notes — the same
 *  split `_functions_excluded` carries. A second role declared there is enforced
 *  the day it lands, without a line of this file moving. */
const ARG_ROLE_KINDS = Object.freeze(Object.fromEntries(
  Object.entries(TABLE._functions_arg_role_kinds || {})
    .filter(([role, kind]) => !role.startsWith('_') && typeof kind === 'string')))

/** ⭐⭐ THE ROLE THAT IS A REQUIREMENT, ENFORCED — because `argRoles` on its own
 *  is DOCUMENTATION, and two entries landed depending on it as though it were
 *  not.
 *
 *  `barssince(cond, n)` and `valuewhen(cond, src, n)` each declare `args[0]` as
 *  a plain `series` and `argRoles[0]` as `condition`. Nothing read the second
 *  half, so `barssince(close, 100)` resolved and answered **0.0 on every bar**
 *  (`close` is never zero, so "bars since it was last true" is zero forever) and
 *  `valuewhen(close, high, 5)` answered `high` on every bar. Plausible on every
 *  bar and wrong on every bar — saveable, scannable and alertable in that state.
 *
 *  ⛔ THE KIND IS ASKED OF `sentence.js::yieldsOf`, WHICH IS THIS LANE'S ONE
 *  RESOLVER of the manifest's `yields`. A `node.type === 'op' && COMPARISONS
 *  .has(node.name)` test here would be the same hand-list the manifest's
 *  `_yields` note exists to retire, and it would be the SECOND one in this lane.
 *
 *  ⛔ AND IT REFUSES RATHER THAN COERCING. `!= 0` on a price column would make
 *  every non-zero bar "true", which is the confident-wrong-number shape rather
 *  than a cure for it. */
function assertArgRoles(node, spec) {
  const roles = Array.isArray(spec.argRoles) ? spec.argRoles : null
  if (!roles) return
  for (let i = 0; i < roles.length; i++) {
    const want = ARG_ROLE_KINDS[roles[i]]
    if (!want) continue
    if (yieldsOf(node.args[i], SENTENCE_RULES) === want) continue
    refuse('resolve:condition',
      `— ${node.name} argument ${i} is its ${roles[i]}: compare it to something, `
      + 'or use a name this table declares as yielding 0/1')
  }
}

/** An `int` argument's value, which MUST be a `num` literal.
 *
 *  ⭐ NOT A CONVENIENCE — IT IS WHAT MAKES `maxLookback` A TREE SUM. The manifest
 *  declares every function's lookback as a constant or as a NAMED ARGUMENT
 *  (`arg1`), and `maxLookback(ast)` takes no bars and no inputs. A window that
 *  is an input name, or a computed column, is not decidable statically — and the
 *  moment lookback stops being decidable statically, Task 7's repaint linter
 *  stops being a tree sum and becomes a dataflow analysis, which is the exact
 *  trade `closedTable.json::_no_offset` refuses on the owner's behalf.
 *
 *  ⏳ HANDED FORWARD: this makes `sma(close, period)` — a window from a declared
 *  INPUT — unexpressible in v1. If Task 8 wants it, it re-opens the decidability
 *  question and belongs with the repaint-claim owner and the manifest owner
 *  together, exactly like `_no_offset_reopened_by` says. */
function windowLiteral(node, index) {
  const arg = node.args[index]
  if (!arg || arg.type !== 'num' || typeof arg.value !== 'number'
      || !Number.isInteger(arg.value) || arg.value < 1) {
    refuse('resolve:window',
      `— ${node.name} argument ${index} must be a whole number of at least 1, got `
      + `${JSON.stringify(arg && arg.type === 'num' ? arg.value : arg)}`)
  }
  return arg.value
}

/** ⭐⭐ THE ARGUMENT DOMAIN THE MANIFEST DECLARES, ENFORCED AT THE RESOLVE PASS —
 *  because `int` can say "a whole number" and cannot say "no larger than that
 *  one".
 *
 *  🔴 THE DEFECT THIS CLOSES (X41). `macd(close, 26, 12)` is the 12/26 pair
 *  transposed — one keystroke — and both walkers answer an ALL-NaN COLUMN for it
 *  by declaration. A comparison then eats the hole: `close > macd(close, 26, 12)`
 *  measured **0.0 on all 60 bars, one distinct value**, with the scan lane's
 *  input pre-pass clean and the lookback satisfied. The screen was savable, every symbol was
 *  reported ANSWERED, and nothing anywhere said the formula was meaningless — a
 *  member reads "0 matches" as a quiet market. The Ichimoku five carry the same
 *  shape whenever `max(tenkan, kijun) > senkouB`.
 *
 *  ⛔ IT IS A FORMULA DEFECT, SO IT IS DECIDED WHERE THE FORMULA IS ADMITTED AND
 *  NOWHERE ELSE. `fast > slow` is true of that tree on every bar, for every
 *  symbol, forever — a per-row check would carry a decision that cannot vary by
 *  row and would pay for it once per symbol across the universe. This is exactly
 *  the line `avwap` already draws: its sub-1990 anchor is refused BY NAME
 *  (`resolve:window`) while "no bar precedes the anchor" stays a quiet per-row
 *  column, *"and the asymmetry is the point"*.
 *
 *  ⛔ THE SET AND THE CEILING ARE BOTH READ OFF THE MANIFEST. `ARG_DOMAINS` is
 *  `parse.js::argDomainsOf`'s answer; a name typed here would be the hand-list
 *  `_functions_domain` exists to retire, and it would be the SECOND copy of it
 *  because the Python lane would need its own.
 *
 *  ⛔ AND IT DOES NOT REPLACE THE ADAPTERS' NaN. `FN.macd` and `ichimokuLine`
 *  still answer an all-NaN column, because they are also reachable directly and
 *  the two shipped implementations disagree about the out-of-order case (one
 *  returns empty columns, the other throws a `TypeError` off a negative index).
 *  What changed is that a tree carrying one no longer resolves.
 *
 *  ⚠️ EVERY `int` SLOT IS READ IN INDEX ORDER FIRST, so `resolve:window` still
 *  wins on a slot that is not a literal at all: a call whose window cannot be
 *  read has no periods to compare, and reporting the later door would measure
 *  traversal order instead of the defect. */
function assertArgDomain(node, spec) {
  const declaration = ARG_DOMAINS[node.name]
  if (declaration === undefined) return
  // ⛔ THE SAME `argN` GRAMMAR `ownLookback` READS, not a second one — and a
  // declaration that names no argument (`0`, `'session'`) has no ceiling to
  // compare against, so it is left alone rather than given a fabricated slot.
  // ⚠️ A MULTIPLIER (`2*arg3`) NAMES THE SAME ARGUMENT: this compares PERIODS,
  // and `adx`'s doubled REACH says nothing about which slot holds the larger one.
  const m = LOOKBACK_RE.exec(String(declaration))
  if (!m) return
  const ceiling = Number(m[2])
  if (spec.args[ceiling] !== 'int') return
  const values = []
  for (let i = 0; i < spec.args.length; i++) {
    values[i] = spec.args[i] === 'int' ? windowLiteral(node, i) : null
  }
  const roleOf = (i) => (Array.isArray(spec.argRoles) && typeof spec.argRoles[i] === 'string'
    ? spec.argRoles[i] : 'period')
  for (let i = 0; i < values.length; i++) {
    if (i === ceiling || values[i] === null || values[i] <= values[ceiling]) continue
    refuse('resolve:domain',
      `— ${node.name} argument ${i} is its ${roleOf(i)} at ${values[i]}, past `
      + `argument ${ceiling}, its ${roleOf(ceiling)}, at ${values[ceiling]}. This entry `
      + `declares ${spec[ARG_DOMAIN]} \`${declaration}\`, so every other period must fit `
      + `inside it — put the larger one in argument ${ceiling}. As written, this call `
      + 'computes nothing on any bar.')
  }
}

/** The bar count of ONE `offset` node, VALIDATED. Refuses `interpret:offset`.
 *
 *  ⭐ THE SHAPE ALREADY MAKES A COMPUTED OFFSET INEXPRESSIBLE — `value` is a
 *  number on the node and there is no slot for an expression (see
 *  `parse.js::NODE_TYPES`). This is what stands between that guarantee and a
 *  PERSISTED tree, which is user data that did not necessarily come through
 *  `canonicalise`: a stored blob can spell `{type:'offset', value:-26}` by hand,
 *  and the negative is the one thing that must never reach the walker. Refusing
 *  it here is the same arrangement as `resolve:function` for a stored call name
 *  the manifest never declared.
 *
 *  ⛔ THE `< 0` LINE IS WHAT KEEPS A FORWARD REFERENCE INEXPRESSIBLE ON THE
 *  STORED SIDE, and it is why this is a refusal and not a clamp. A clamp to 0
 *  would silently turn `close[-26]` into `close` and draw a confident wrong
 *  column — the shape this whole phase exists to remove. */
function offsetBars(node) {
  if (node.args.length !== 1) {
    refuse('interpret:offset',
      `— an offset reads exactly one child column, got ${node.args.length}`)
  }
  const n = node.value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    refuse('interpret:offset',
      `— got ${JSON.stringify(n)}; a bar offset counts backwards from the bar it writes`)
  }
  return n
}

/** The declared lookback of ONE call node: a constant, a named argument, or a
 *  whole MULTIPLE of a named argument (`"2*arg3"`).
 *
 *  ⭐⭐ THE MULTIPLE EXISTS BECAUSE `adx` COULD NOT BE DECLARED WITHOUT IT.
 *  `closedTable.json::_functions_excluded` carried this for months in its own
 *  words: *"ITS WINDOW IS `2 * period` AND THIS TABLE CANNOT SAY THAT … Declaring
 *  `arg3` would UNDER-state the window, which `_functions_warmup` names as the
 *  one direction a budget cannot use."* So the indicator was withheld rather than
 *  mis-declared, which was the right call and is now unnecessary.
 *
 *  ⛔ OVER-STATING IS SAFE AND UNDER-STATING IS NOT, and that asymmetry is the
 *  whole reason this grammar is conservative. A window declared too LARGE costs
 *  extra NaN at the left edge; one declared too SMALL hands back numbers computed
 *  from bars that were never fetched. `2*arg3` is an upper bound on ADX's true
 *  `2 * period - 1`, and it is exactly the minimum series length
 *  `computeADX`/`compute_adx_raw` require before they return anything at all.
 *
 *  ⛔ WHOLE MULTIPLES ONLY. No `arg1+arg2`, no arithmetic — every form this
 *  accepts has to be re-implemented identically in `ast_interpret.py`, and the
 *  two lanes agreeing is what `test_ast_lookback_parity.py` measures. A grammar
 *  that grows past what both sides can trivially mirror is how they drift.
 *
 *  ⭐⭐ AND ONE FORM THAT IS NEITHER — `'session'`. It is checked BEFORE the
 *  regex and it takes no argument, because the bars in a session are decided by
 *  the CALENDAR and the TIMEFRAME rather than by anything the author typed.
 *  `SESSION_MAX_BARS` is read off the manifest, not owned here, so the linter
 *  (whose import graph cannot reach this file) resolves it to the same number —
 *  which is the only arrangement in which the two `maxLookback`s in this
 *  directory can go on agreeing.
 */


/** ⚠️ EXPORTED FOR ONE REASON: SO ITS BRANCHES CAN BE RAILED IN THIS LANE TOO.
 *
 *  `maxLookback` reaches this only through `fnSpec`, which reads a manifest that
 *  is frozen at import — so a declaration the shipped table does not contain is
 *  unreachable from a test, and a branch that cannot be reached cannot be proved
 *  by deleting it. The Python lane never had that problem (`_own_lookback` takes
 *  the spec directly and its tests call it), and "the rail went to whichever
 *  consumer happened to be reachable" is exactly how the previous task shipped a
 *  guard on one side of a mirrored pair. This is a pure reader: it takes a node
 *  and a spec and returns a number. */
export function ownLookback(node, spec) {
  const lb = spec.lookback
  if (typeof lb === 'number') return lb
  if (lb === SESSION_LOOKBACK) return SESSION_MAX_BARS
  const m = LOOKBACK_RE.exec(String(lb))
  if (!m) {
    refuse('interpret:node',
      `${JSON.stringify(node.name)} declares lookback ${JSON.stringify(lb)}, which is neither a constant nor an argument`)
  }
  const times = m[1] === undefined ? 1 : Number(m[1])
  return times * windowLiteral(node, Number(m[2]))
}

/** How many bars of history the tree needs. A TREE SUM, never a dataflow pass.
 *
 *  ⭐ THE SUM IS ALONG THE PATH, WHICH IS THE CASE A PER-ARGUMENT CHECK MISSES.
 *  `sma(sma(close, 5000), 5000)` needs 10,000 bars and neither 5,000 alone
 *  exceeds anything — `escapes.json::nested_lookback` exists for precisely that,
 *  and nothing else in the corpus catches it.
 *
 *  ⚠️ THIS IS A MEASUREMENT, NOT A GUARD. It returns the number; refusing a tree
 *  that asks for too much needs a DECLARED budget, and `compute.budget` is Task
 *  6's. Conservative by one bar per reduction on purpose: the manifest says
 *  `sma`'s lookback IS `arg1`, and an upper bound is the only thing a linter or
 *  a budget can safely use. */
export function maxLookback(ast) {
  const order = flatten(ast)
  const seen = new Map()
  for (const node of order) {
    if (node.type === 'num' || node.type === 'series') { seen.set(node, 0); continue }
    if (node.type === 'op') {
      let best = 0
      for (const arg of node.args) best = Math.max(best, seen.get(arg))
      seen.set(node, best)
      continue
    }
    if (node.type === 'tf') {
      // ⭐ THE TREE SUM, IN BASE BARS. The child's lookback is counted in HIGHER-
      // timeframe bars, so it is multiplied by the span; the +1 is the bar this
      // node always steps back to reach the last CLOSED period.
      // ⚠️⚠️ ROUNDING UP IS THE SAFE DIRECTION, and it is why the span is a
      // constant rather than a measurement: a lookback that is too SMALL lets a
      // tree claim it needs fewer bars than it reads and answer off a warmup it
      // never had. Mirrors `ast_interpret.max_lookback`'s `tf` arm.
      // ⛔ ASK FIRST, by the SAME authority the evaluator uses, so a code this
      // engine cannot resample is refused here rather than defaulting to span 1
      // and letting an up-front gate accept a tree every row will refuse.
      const code = String(node.value)
      assertResamplable(code, refuse)
      const span = TF_BASE_BARS[code]
      seen.set(node, (seen.get(node.args[0]) + 1) * span)
      continue
    }
    if (node.type === 'offset') {
      // ⭐ THE TREE SUM, EXTENDED BY EXACTLY ONE TERM. `sma(close[2], 20)` needs
      // 20 + 2 bars and `close[2]` alone needs 2; the offset ADDS to whatever
      // its child already needs, the same way a call adds its own lookback to
      // its arguments'. That composition is the entire reason the offset is
      // bounded and backward-only — a signed one would make this a `max` over a
      // lattice and the linter a dataflow pass.
      seen.set(node, offsetBars(node) + seen.get(node.args[0]))
      continue
    }
    const spec = fnSpec(node.name)
    assertArity(node, spec)
    let best = 0
    for (let i = 0; i < node.args.length; i++) {
      if (spec.args[i] === 'int') { windowLiteral(node, i); continue }
      best = Math.max(best, seen.get(node.args[i]))
    }
    // ⛔ THE RESOLVE PASS IS WHERE THE DECLARED ARGUMENT DOMAIN IS DECIDED, and
    // this pass is the reason it lands at every door at once: `assertBudget`
    // inside `interpret`, `checkBudget` inside `evaluateFormula`, the concierge's
    // `_validate` and the sweep's own one-shot resolve all run THIS function, so
    // a transposed `macd` is refused once per formula rather than once per
    // symbol. AFTER the loop above, so `resolve:window` still owns a slot that
    // is not a literal.
    assertArgDomain(node, spec)
    seen.set(node, ownLookback(node, spec) + best)
  }
  return seen.get(ast)
}

/** How many nodes the tree has. The number `budget:nodes` will threshold.
 *
 *  ⚠️ ITERATIVE, so it survives the 8,001-node tree that makes `interpret`
 *  itself overflow. That asymmetry is the point: Task 6's guard runs BEFORE the
 *  walker and must not need the walker to be safe first. */
/** Recurrence bind names (`self`, today), resolved LAZILY.
 *
 *  ⚠️ NOT a module-level `const` derived from `RECURRENCES`: that evaluates at
 *  import and would sit in a temporal dead zone if the table's declaration ever
 *  moved below this point. A lazy read cannot be ordered wrong. */
let _bindNames = null
function bindNames() {
  if (_bindNames) return _bindNames
  _bindNames = new Set(
    Object.keys(RECURRENCES)
      .map((k) => RECURRENCES[k] && RECURRENCES[k].binds)
      .filter((b) => typeof b === 'string'),
  )
  return _bindNames
}

/** Structural identity for every node in a tree.
 *
 *  Returns `{idOf, freeOf, distinct}` — `idOf` maps each node to an integer that
 *  is EQUAL for structurally identical subtrees, `freeOf` says whether the
 *  subtree reads a recurrence bind anywhere inside it, `distinct` is how many
 *  different subtrees the tree contains.
 *
 *  ⭐ ONE AUTHORITY. `nodeCount` thresholds on `distinct` and the interpreter
 *  MEMOISES on `idOf`, so the number a member is charged and the work the engine
 *  actually does cannot drift apart. A second copy of this walk is the defect
 *  this repo keeps paying for — derive, never restate.
 *
 *  ⛔ IDS, NOT NESTED KEY STRINGS. An earlier attempt keyed each node on a string
 *  containing its children's keys; that is quadratic in the tree's depth and on
 *  script 10 (642 nodes, deeply nested) it builds megabyte-sized strings to count
 *  to 128. Interning a short shape into an integer is O(1) per node.
 *
 *  ⛔ EXPLICIT POST-ORDER WITH ITS OWN STACK. Not `flatten` reversed: this must be
 *  correct without depending on another function's emission order, and it must be
 *  iterative so it survives a tree deep enough to overflow a recursive walk. */
export function structuralMaps(root) {
  const binds = bindNames()
  const idOf = new Map()
  const freeOf = new Map()
  const byShape = new Map()
  const intern = (shape) => {
    let id = byShape.get(shape)
    if (id === undefined) { id = byShape.size; byShape.set(shape, id) }
    return id
  }
  const stack = [[root, false]]
  while (stack.length) {
    const [n, expanded] = stack.pop()
    if (idOf.has(n)) continue
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      idOf.set(n, intern(`lit\u0001${JSON.stringify(n ?? null)}`))
      freeOf.set(n, true)
      continue
    }
    const args = Array.isArray(n.args) ? n.args : []
    if (!expanded) {
      stack.push([n, true])
      for (const a of args) stack.push([a, false])
      continue
    }
    let free = !(n.type === 'series' && binds.has(n.name))
    const childIds = []
    for (const a of args) {
      // ⛔⛔ THROW, NEVER INVENT A KEY. The first version of this walk pushed a
      // placeholder when a child was missing, so a 128-deep chain collapsed to
      // TWO distinct shapes and `nodeCount` answered 2. A silent fallback here
      // UNDER-counts, and under-counting is the one direction that turns a
      // budget into a guard that has stopped guarding.
      if (!idOf.has(a)) {
        throw new Error('structuralMaps: a child was keyed after its parent — the post-order is broken')
      }
      childIds.push(idOf.get(a))
      if (!freeOf.get(a)) free = false
    }
    // ⚠️ DELIMITED. Without separators `op` + `u-` + `''` and `op` + `u` + `-`
    // produce the same shape, and a collision under-counts exactly like the
    // fallback did.
    idOf.set(n, intern(`${n.type}\u0001${n.name ?? ''}\u0001${n.value ?? ''}\u0001${childIds.join(',')}`))
    freeOf.set(n, free)
  }
  return { idOf, freeOf, distinct: byShape.size }
}

/** How many DISTINCT subtrees the tree has. The number `budget:nodes` thresholds.
 *
 *  ⭐⭐ DISTINCT, NOT TOTAL — and it is honest ONLY because the interpreter
 *  memoises on the same ids. A translated script inlines rather than names (the
 *  closed table cannot bind an intermediate), so script 10's ATR term appears
 *  eight times in one column; counting the flattened tree charged a member eight
 *  times for a thing the engine computes once.
 *
 *  ⛔ THE TWO MOVE TOGETHER. Counting the DAG WITHOUT the memo is the opposite
 *  error and a far worse one — a budget under-reporting real cost. If the memo is
 *  ever narrowed, narrow this with it. */
export function nodeCount(ast) {
  return structuralMaps(ast).distinct
}

// --------------------------------------------------------------------------- //
// interpret
// --------------------------------------------------------------------------- //

/** Evaluate a canonical AST over bars → one `Float64Array`.
 *
 *  @param {object} ast    a canonical tree (`parse.js::canonicalise`'s output)
 *  @param {Array}  bars   `[{t,o,h,l,c,v}, …]`
 *  @param {object} inputs declared instance inputs, by name; finite numbers only
 *  @param {object} [budget] the definition's stored `compute.budget`. Resolved
 *                  through `effectiveBudget`, so it can only ever TIGHTEN the
 *                  default and a stored blob cannot turn off its own limit.
 *  @param {object} [scalars] this SYMBOL's values for the table's declared
 *                  scalars. Every declared name is seeded whether or not it
 *                  appears here; an absent or unusable value seeds NaN.
 *  @param {object} [opts] what the CALLER knows that the tree and the bars do
 *                  not. Today that is one key, `tf` — the timeframe these bars
 *                  are — and the clock's four timeframe booleans are its only
 *                  readers.
 *  @returns {Float64Array} exactly `bars.length` long, NaN-padded
 *
 *  Throws `TableRefusal` for anything the table refuses. Everything else — a
 *  `RangeError` from a tree deep enough to overflow the stack, say — is NOT a
 *  refusal and must never be caught and relabelled as one; see the header.
 *
 *  ⭐⭐ `opts` IS OPTIONAL AND TRAILING, AND IT IS THE WHOLE tableVersion-2
 *  INTERFACE CHANGE. Every caller written before it is unaffected — the
 *  signature is the cross-lane interface and `ast_interpret.interpret` grew the
 *  SAME trailing argument on the same day. ⛔ AND ITS ABSENCE FAILS CLOSED:
 *  with no `tf`, `isintraday` and its three siblings are NOT COMPUTABLE, never
 *  0 and never a guessed default. A caller that HAS a timeframe and drops it
 *  therefore produces a visibly unanswered column rather than a confident wrong
 *  one, which is what makes the two threading hand-backs (`nativeRegistry.js`
 *  and `scan_evaluator.py`) safe to land separately from this. */
export function interpret(ast, bars, inputs, budget, scalars, opts) {
  if (!Array.isArray(bars)) {
    // A PLAIN Error, NOT a TableRefusal: the table refuses what a USER wrote,
    // and the bars are the caller's. Conflating the two would let a wiring bug
    // read as "the formula was rejected" on a chip's tooltip.
    throw new Error(`interpret(ast, bars): bars must be an array, got ${typeof bars}`)
  }
  // ⭐ THE COMPUTE-TIME BUDGET, AND IT IS THE SAFETY HALF. It runs BEFORE the
  // scope is built and before a single node is walked, because the tree it
  // exists to refuse is the one that never returns. `assertBudget`'s
  // measurements are iterative, so this line survives the 8,001-node input that
  // makes the recursive walker below overflow — the guard does not need the
  // walker to be safe first.
  //
  // ⛔ NOT WRAPPED IN A `try`. A `RangeError` from a tree this admits must reach
  // the caller AS a `RangeError`; relabelling it as a budget refusal is the same
  // wrong-door defect this whole phase is about, wearing a different coat.
  assertBudget(ast, budget)
  const length = bars.length

  // ⛔ NULL PROTOTYPE, DELIBERATELY, AND IT IS THE FIRST OF TWO LOCKS.
  // `Object.create(null)` has no `toString`, no `constructor`, no `valueOf` —
  // so even a bare subscript finds nothing. The `hasOwnProperty` call in
  // `lookup` is the SECOND lock, because a future refactor seeding this from
  // `{}` would silently re-open every one of them and nothing else in this file
  // would notice.
  const scope = Object.create(null)
  for (const [name, spec] of Object.entries(TABLE.series)) {
    const col = new Float64Array(length)
    for (let i = 0; i < length; i++) {
      const v = bars[i] ? bars[i][spec.field] : undefined
      // ⚠️ NOT the Float64Array default of 0. A missing field is NOT a price of
      // zero; it is a bar we cannot compute on.
      col[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
    scope[name] = col
  }

  // ⭐ THE CLOCK (tableVersion 2). Seeded from `computeClock` exactly the way
  // the indicator functions bind to `computeRSI`: not one line of calendar
  // arithmetic lives in this file, and it CANNOT — `interpret.test.js` bans
  // `Date` and `Intl` here by an AST scan over this module's own source and
  // widens the allowlist for `indicators.js` only. A private calendar would
  // either break that proof or force it to be widened, and a purity claim that
  // widens whenever something needs a clock is not a purity claim.
  //
  // ⛔ THE MANIFEST DECIDES WHICH NAMES EXIST; `computeClock` DECIDES WHAT EACH
  // ONE MEANS; A DISAGREEMENT THROWS BY NAME. Seeding a NaN column for a
  // declared name the maths has no column for would be a clock reading "not
  // computable" on every bar of every symbol forever with nothing red anywhere.
  // A plain `Error`, because it is a WIRING defect — somebody edited the
  // manifest without the maths — not a formula the table refuses.
  //
  // ⚠️ COMPUTED EAGERLY, LIKE THE SERIES COLUMNS, AND THAT COSTS SOMETHING
  // HONEST: thirteen columns per call, for a formula that may name none of
  // them. It is deliberately NOT made conditional on the tree, because `scope`
  // is also what the shadow check reads and what `resolve:name` lists — a clock
  // name seeded only when it is used would let an input named `hour` shadow it
  // on every OTHER formula, silently.
  //
  // ⛔ THE COST IS TENS OF PERCENT OF ONE `interpret` CALL, ON **BOTH** BAR
  // KINDS -- daily is NOT free. ⚠⚠ A RANGE, DELIBERATELY: four careful A/B
  // runs on the Python mirror (same module, `clock` section removed) read
  // 9-38%, with per-configuration min..max spreads of 1.8-7.0 ms on
  // consecutive runs. The box is noisy; a single figure would invite the next
  // engineer to read a 2x drift as a regression.
  //
  // ⚠⚠ THE UNIT GATE SHORT-CIRCUITS THE **ZONE** WORK, NOT THE **SEEDING**:
  // `computeClock` allocates thirteen `Float64Array`s BEFORE the gate and
  // writes all thirteen whichever branch it takes. ⭐ ON THIS LANE THE NUMBER
  // THAT MATTERS IS ALLOCATION, NOT TIME, and that one IS exact because it is
  // arithmetic rather than a stopwatch: 13 columns x 5,000 bars x 8 B = ~507 KB
  // transient per call at full history -- GC churn on every repaint, and the
  // reason a lazy seed is the first thing to reach for if this shows in a
  // profile.
  {
    const cols = computeClock(bars, opts ? opts.tf : undefined)
    for (const name of Object.keys(TABLE.clock || {})) {
      const col = cols[name]
      if (!col) {
        throw new Error(
          `interpret: the table declares the clock name ${JSON.stringify(name)} and `
          + '`indicators.js::computeClock` produces no such column (it produces '
          + `${Object.keys(cols).sort().join(', ')}). The manifest is the authority over `
          + 'WHICH clock names exist and the maths over what each MEANS; seeding NaN here '
          + 'would make a declared name read `not computable` on every bar forever.')
      }
      scope[name] = col
    }
  }

  // ⭐ A DECLARED SCALAR IS ALWAYS IN SCOPE. Present or absent, the name
  // RESOLVES — an absent value seeds NaN, exactly like a bar with a missing
  // field. That is what separates "declared but not known for this symbol" (a
  // HOLE a sweep counts and reports) from "a name this table never declared"
  // (`resolve:name`, a formula defect). ⛔ AND NEVER 0: a missing market cap
  // read as zero makes `market_cap > 1e9` a confident False, which is a broken
  // symbol wearing a quiet one's answer.
  //
  // ⚠️ A BARE NUMBER, NOT A COLUMN. `lift1/2/3` already broadcast a scalar
  // against a column and `toColumn` already fills `bars.length` from a bare
  // number, so a scalar-only tree is a flat column — which is what makes it
  // composable with a per-bar one.
  //
  // ⛔ AND `inputs` IS SEEDED AFTER, SO THE SHADOW CHECK BELOW SEES IT.
  {
    const provided = scalars || {}
    for (const name of Object.keys(TABLE.scalars)) {
      const v = own(provided, name) ? provided[name] : undefined
      scope[name] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
  }

  for (const [name, value] of Object.entries(inputs || {})) {
    // ⛔ AND A RECURRENCE BINDING IS RESERVED TOO. `self` is not in `scope` and
    // not in `functions`, so without this line an input could take the name and
    // every body in the definition would silently read the KNOB instead of the
    // running value — a formula that still computes, and computes the wrong
    // thing. The list is derived from the manifest, never typed.
    if (own(scope, name) || own(TABLE.functions, name) || RECURRENCE_BINDINGS.includes(name)) {
      // A plain Error again: a definition whose input shadows `close` is a
      // WIRING defect, and silently letting it win would change what every
      // formula on that definition means.
      throw new Error(
        `interpret: the input ${JSON.stringify(name)} shadows a table name. `
        + `The table declares ${declared(TABLE.series)}, ${declared(TABLE.clock || {})}, `
        + `${declared(TABLE.functions)} and ${declared(TABLE.scalars)}.`)
    }
    // Only finite numbers are seeded. An input that is a function, an object or
    // a string is NOT a name this table can resolve, and leaving it out makes
    // referencing it a loud `resolve:name` refusal rather than a column of
    // `undefined` — which is what a scope that accepted anything would produce.
    if (typeof value === 'number' && Number.isFinite(value)) scope[name] = value
  }

  const lookup = (name) => {
    // ⛔ `hasOwnProperty.call`, NEVER `scope[name]`. See the header.
    if (!own(scope, name)) {
      // ⭐ A RECURRENCE BINDING IS NEVER IN SCOPE, EVEN INSIDE ITS OWN BODY —
      // `runRecurrence`'s step loop intercepts it before the walker gets here.
      // So reaching this line with one means it was written somewhere no running
      // value is being computed, and saying THAT is worth a guard of its own:
      // `unknown name "self"` beside a list of every price field would send the
      // reader looking for a typo in a name that is spelled correctly.
      if (RECURRENCE_BINDINGS.includes(name)) {
        refuse('interpret:recurrence',
          `— \`${name}\` was read outside the update of a ${declared(RECURRENCES)} call`)
      }
      refuse('resolve:name',
        `${JSON.stringify(name)} — this table declares ${Object.keys(scope).join(', ')}`)
    }
    return scope[name]
  }

  const evalNodeRaw = (n) => {
    // ⚠️ NOT `assertNode` — the `default` arm below IS the guard here, and it has
    // to be REACHABLE for the mutation that deletes it to be lethal. A validating
    // pre-pass would make `default:` unreachable, which is how a guard becomes an
    // equivalent mutant: deleting it changes nothing and no test can notice.
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      return refuse('interpret:node', `got ${JSON.stringify(n) ?? String(n)}`)
    }
    if ((n.type === 'op' || n.type === 'call') && !Array.isArray(n.args)) {
      return refuse('interpret:node',
        `a ${n.type} node carries an \`args\` array; got ${JSON.stringify(n.args)}`)
    }
    switch (n.type) {
      case 'num':
        if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
          refuse('interpret:node', `a num node carries a finite number; got ${JSON.stringify(n.value)}`)
        }
        return n.value
      case 'series':
        return lookup(n.name)
      case 'offset': {
        const back = offsetBars(n)
        // ⛔ MATERIALISED TO A COLUMN FIRST, ALWAYS. A scalar child (`20[3]`, or
        // a per-symbol scalar) has no history either, and broadcasting it and
        // THEN shifting is what makes "three bars ago" mean the same thing for
        // every child kind in both lanes. Special-casing the scalar to itself
        // would answer a question about a bar that does not exist.
        const src = toColumn(evalNode(n.args[0]), length)
        const out = nan(length)
        // ⭐⭐ THE LEFT EDGE, AND IT IS THE DEFINING RULE OF THIS ENGINE. `i <
        // back` has no bar to read, so the answer is NOT COMPUTABLE — NaN. ⛔
        // NEVER 0 and ⛔ NEVER `src[0]`: a clamped first bar makes `close >
        // close[3]` a confident answer on bar 1, which is the exact defect class
        // (`close > sma(close,300)` returning 200 confident zeroes) this codebase
        // spent a week removing. `nan(length)` already fills the prefix; the loop
        // deliberately starts AT `back` rather than clamping an index.
        for (let i = back; i < length; i++) out[i] = src[i - back]
        return out
      }
      case 'tf': {
        const code = String(n.value)
        assertResamplable(code, refuse)
        // \u26d4 STRICTLY ABOVE THE BASE, and only when the caller SAID what the base
        // is. `opts.tf` is what the caller knows and the bars do not; absent, this
        // check cannot run and does not pretend to \u2014 the same fail-closed-but-say-so
        // rule `computeClock` states for `isdaily`.
        const base = opts && opts.tf
        if (base !== undefined && base !== null) {
          const rb = tfRank(base)
          const rc = tfRank(code)
          if (rb >= 0 && rc >= 0 && rc <= rb) {
            refuse('interpret:timeframe',
              `'${code}' is not above '${String(base)}' \u2014 a higher-timeframe read can `
              + `only look UP from the bars it was handed, and '${code}' cannot be `
              + `resampled out of '${String(base)}'.`)
          }
        }
        const isos = bars.map((b) => isoDay(b && b.t))
        const { htf, at } = resampleTo(bars, isos, code)
        // \u2b50 THE CHILD IS EVALUATED ON THE HIGHER-TIMEFRAME BARS, which is the whole
        // value of the node: `tf(sma(close, 20), 'W')` is the 20-WEEK average, not the
        // 20-day average sampled weekly. `opts.tf` becomes the HTF code so a nested
        // clock or `tf` reads the right base.
        const child = toColumn(
          interpret(n.args[0], htf, inputs, budget, scalars, { ...(opts || {}), tf: code }),
          htf.length)
        // \u26d4\u26d4 THE LAST *CLOSED* BAR, AND THIS LINE IS THE REPAINT STORY. A base bar
        // in bucket `b` reads bucket `b - 1`. Reading `b` would hand a Monday its own
        // week's eventual close \u2014 every backtest using `tf` would then be reading the
        // future and still drawing a confident line. Bucket 0 has no closed
        // predecessor, so it is NOT COMPUTABLE, exactly as `offset`'s left edge is.
        const out = nan(length)
        for (let i = 0; i < length; i++) {
          const iso = isos[i]
          if (!iso) continue
          const b = at.get(tfBucket(iso, code))
          if (b > 0) out[i] = child[b - 1]
        }
        return out
      }
      case 'op':
        return applyOp(n, n.args.map(evalNode))
      case 'call': {
        const spec = fnSpec(n.name)
        assertArity(n, spec)
        // ⛔ AFTER THE ARITY AND BEFORE THE RECURRENCE ARM. The role check
        // indexes `n.args`, so it needs the arity settled first; and it sits
        // above the early return so a recurrence entry that ever declares a
        // `condition` role is covered without this line moving.
        assertArgRoles(n, spec)
        // ⭐ THE ONE ARM THAT DOES NOT EVALUATE ITS ARGUMENTS EAGERLY, and the
        // manifest says so rather than this line asserting it: an entry that
        // declares a `recurrence` carries a per-bar BODY, not a column. See
        // `runRecurrence`.
        if (own(RECURRENCES, n.name)) return runRecurrence(n, spec)
        const args = []
        for (let i = 0; i < n.args.length; i++) {
          args.push(spec.args[i] === 'int'
            ? windowLiteral(n, i)
            : toColumn(evalNode(n.args[i]), length))
        }
        // ⭐ THE SECOND ARM THE MANIFEST DECIDES. An entry declaring
        // `reads: 'bars'` is handed THESE bars — the real instants — and not a
        // pack of argument columns whose `t` is a bar index. The question asked
        // is "does this entry declare it", never "is this call `vwap`", so a
        // third such entry needs no edit here.
        if (own(BAR_FN, n.name)) return barColumn(n.name, bars, args, length)
        return FN[n.name](...args)
      }
      default:
        // ⛔ NOT A FALLTHROUGH TO SOMETHING PLAUSIBLE. `assertNode` above already
        // refuses anything outside the four types, so this is unreachable while
        // the two agree — and it is written as a refusal rather than a `return
        // NaN` because a tree nobody authored must refuse, not draw a blank line
        // that reads exactly like a warmup.
        return refuse('interpret:node',
          `unknown node type ${JSON.stringify(n.type)} — legal types are ${NODE_TYPES.join(', ')}`)
    }
  }

  // ─── STRUCTURAL MEMO ──────────────────────────────────────────────────────
  //
  // ⭐⭐ THE SAME SUBTREE, WRITTEN TWICE, COSTS ONCE. A translated script inlines
  // rather than names: script 10's `(high+low)/2 + 3*atr(high,low,close,22)`
  // appears EIGHT times in one column because the closed table has no way to bind
  // an intermediate. Without this the engine recomputes each one, per bar, per
  // ticker, over the whole universe.
  //
  // 🔴🔴 SELF-FREE ONLY, AND THAT IS THE WHOLE SAFETY ARGUMENT. `evalNodeRaw` is a
  // closure over fixed `bars`/`inputs`/`scalars`, so a subtree that does not read
  // a recurrence bind yields the same column every time. A subtree that DOES read
  // one is re-evaluated per step with a different running value, and caching it
  // would freeze the recurrence at its first step — a wrong NUMBER, silently, not
  // a crash. The two cross-lane parity fixtures are what would catch that, and
  // they are the acceptance test for this change.
  //
  // ⚠️ Sharing the returned `Float64Array` between call sites is safe because
  // every producer allocates: `lift1`/`lift2`/`lift3` each build a fresh `out` and
  // only READ their inputs, and `toColumn` allocates `col`. ⛔ A future builtin
  // that writes into a column it was handed would break this silently — allocate,
  // never mutate an input.
  // ⭐ THE SAME WALK THE BUDGET COUNTS ON — called, not re-implemented, so the
  // number a member is charged and the work the engine actually does cannot drift
  // apart. ⛔ If this stops calling `structuralMaps`, the budget begins reporting
  // a cost the engine does not pay.
  const { idOf, freeOf } = structuralMaps(ast)
  const memo = new Map()

  const evalNode = (n) => {
    // 🔴 SELF-FREE ONLY. A subtree that reads a recurrence bind is re-evaluated
    // per step with a different running value; caching it would freeze the
    // recurrence at step one — a wrong NUMBER, silently.
    //
    // ⚠️⚠️ AND IT IS **NOT** MUTATION-PROVEN — corrected 2026-08-22, having been
    // committed as "mutation-proven: drop it and 6 tests red". That WAS observed,
    // against the earlier string-keyed walk, which had a collision bug: removing
    // the condition then caused wrong SHARING, so the reds were proving the bug,
    // not the guard. Against the corrected walk the same mutation SURVIVES.
    // A probe confirms `evalNode` does receive a bind-reading node, so the branch
    // is live rather than dead — it is simply defence nothing currently exercises.
    // ⛔ KEEP IT: it is one property read, and being wrong here is a silent wrong
    // number. But do not call it proven, and if you can build the fixture that
    // kills the mutation, add it and delete this paragraph.
    const id = freeOf.get(n) ? idOf.get(n) : undefined
    if (id !== undefined && memo.has(id)) return memo.get(id)
    const value = evalNodeRaw(n)
    if (id !== undefined) memo.set(id, value)
    return value
  }

  const applyOp = (node, values) => {
    const name = node.name
    if (name === '?:') {
      if (values.length !== 3) {
        refuse('resolve:arity', `— the ternary ?: expects 3 arguments, got ${values.length}`)
      }
      return lift3(values[0], values[1], values[2], TERNARY, length)
    }
    if (own(UNARY, name)) {
      if (values.length !== 1) {
        refuse('resolve:arity', `— ${name} expects 1 arguments, got ${values.length}`)
      }
      return lift1(values[0], UNARY[name], length)
    }
    if (own(BINARY, name)) {
      if (values.length !== 2) {
        refuse('resolve:arity', `— ${name} expects 2 arguments, got ${values.length}`)
      }
      return lift2(values[0], values[1], BINARY[name], length)
    }
    return refuse('interpret:operator',
      `${JSON.stringify(name)} — this table declares ${declared(TABLE.operators)}`)
  }

  /** One operator, applied to BARE NUMBERS. The recurrence step loop's arm.
   *
   *  ⭐ THE SAME `UNARY`/`BINARY`/`TERNARY` ENTRIES `applyOp` USES, and that is
   *  not a convenience — `lift1/2/3` are pure elementwise applications of these
   *  very functions, so a body evaluated one bar at a time and a column
   *  evaluated all at once are the SAME ARITHMETIC by construction. A second
   *  scalar table here would be a second grammar, and the first thing to
   *  diverge would be the NaN rule (`cmp` answers 0, `logical` answers NaN) —
   *  a difference no cross-lane parity run would catch, because it would be
   *  wrong identically in both lanes. */
  const applyOpStep = (node, values) => {
    const name = node.name
    if (name === '?:') {
      if (values.length !== 3) {
        refuse('resolve:arity', `— the ternary ?: expects 3 arguments, got ${values.length}`)
      }
      return TERNARY(values[0], values[1], values[2])
    }
    if (own(UNARY, name)) {
      if (values.length !== 1) {
        refuse('resolve:arity', `— ${name} expects 1 arguments, got ${values.length}`)
      }
      return UNARY[name](values[0])
    }
    if (own(BINARY, name)) {
      if (values.length !== 2) {
        refuse('resolve:arity', `— ${name} expects 2 arguments, got ${values.length}`)
      }
      return BINARY[name](values[0], values[1])
    }
    return refuse('interpret:operator',
      `${JSON.stringify(name)} — this table declares ${declared(TABLE.operators)}`)
  }

  /** A declared recurrence — bar-to-bar state, bounded so the answer cannot
   *  depend on which bars the caller happened to fetch.
   *
   *  ⭐⭐ THE DEFINITION, AND EVERYTHING ELSE HERE FOLLOWS FROM IT. At bar `i`
   *  the state is SEEDED FRESH at bar `i - warmup` and the body is applied once
   *  per bar across `(i - warmup, i]`. So the value at bar `i` is a function of
   *  exactly `warmup + 1` bars and nothing else — the same bargain
   *  `sma(close, 20)` makes, and the reason panning a chart cannot change it.
   *
   *  ⛔ THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE, AND IT IS WRONG QUIETLY. A
   *  single forward pass from bar 0 is O(n) instead of O(n × warmup) and gives
   *  a DIFFERENT number for the same bar the moment the window moves — which is
   *  `lesson_a_derived_value_must_not_depend_on_the_request` exactly: a rolling
   *  value needs a warm-up prefix, a cumulative one needs an absolute seed, and
   *  "wherever this fetch started" is neither. Nothing about the output would
   *  look wrong; it would simply disagree with itself between two requests.
   *
   *  ⛔ AND THE PREFIX IS NaN, NEVER A SHORT RUN. Bars before `warmup` have no
   *  seed bar to start from, so they are not computable — a partial accumulation
   *  there would be a confident wrong number wearing a warm-up's clothes, the
   *  same shape as the clamped `src[0]` the offset arm refuses. */
  const runRecurrence = (node, spec) => {
    const rec = spec.recurrence
    const bind = rec.binds
    const warmup = windowLiteral(node, rec.warmup)
    const body = node.args[rec.body]

    // ⭐ THE ONE COST IN THIS ENGINE THE STATIC BUDGET CANNOT SEE. `budget.js`
    // takes no bars, and `warmup` alone is already capped by `budget:lookback`
    // like any other window — but the WORK is `bars × warmup`, and the bar count
    // arrives with the caller. So it is measured here, where it is known, and
    // refused BY NAME rather than turning a chart into a hang.
    if (length * warmup > MAX_RECURRENCE_STEPS) {
      refuse('interpret:steps',
        `— ${node.name} over ${length} bars with a ${warmup}-bar warm-up is `
        + `${length * warmup} steps and the ceiling is ${MAX_RECURRENCE_STEPS}`)
    }

    const isBind = (x) => !!x && typeof x === 'object' && x.type === 'series' && x.name === bind
    /** How many bars of its OWN past this body reads. 0 is the classic one-lag form. */
    let maxSelfLag = 0

    // Which nodes of the body read the running value. Memoised over node
    // IDENTITY, so a tree that shares a subtree object answers once.
    const readsBind = new Map()
    const reads = (x) => {
      if (readsBind.has(x)) return readsBind.get(x)
      let answer = isBind(x)
      // ⭐⭐ `self` BINDS TO THE NEAREST ENCLOSING RECURRENCE, and this line is the
      // whole of that rule. A NESTED recurrence brings its own `self`, so the
      // walk must not descend into one and count that inner `self` as a read of
      // the OUTER's running value — which is what it did, and why an independent
      // inner accumulator was refused as if it were ambiguous.
      //
      // ⛔ AND THE PAYOFF IS THE PARTITION BELOW, UNCHANGED. A subtree that does
      // not read this recurrence's bind is already evaluated ONCE as an ordinary
      // column; stopping here simply lets a nested `accum` be one of those. It
      // computes over every bar on its own, exactly as it would standing alone,
      // and the outer step loop reads its finished column per bar.
      //
      // ⭐ THIS IS WHAT THE TRAILING-STOP FAMILY NEEDS. `dir` is one recurrence
      // and `longStop` another; folding them into one accumulator made `self`
      // mean a direction in one place and a stop price in another. Two separate
      // accumulators, each owning its own `self`, is the shape that is correct.
      const nested = x && typeof x === 'object' && x.type === 'call' && own(RECURRENCES, x.name)
      if (!answer && !nested && x && typeof x === 'object' && Array.isArray(x.args)) {
        for (const child of x.args) if (reads(child)) { answer = true; break }
      }
      readsBind.set(x, answer)
      return answer
    }

    // ⭐ THE PARTITION, AND IT IS WHAT KEEPS THIS AFFORDABLE. Every maximal
    // subtree that does NOT read the running value is an ordinary column and is
    // evaluated ONCE, by the ordinary walker. Only the spine that actually
    // depends on the previous bar is re-evaluated per step — so `sma(volume,20)`
    // inside a body costs one pass, not `bars × warmup` of them.
    const columns = new Map()
    const planned = new Set()
    const plan = (x) => {
      if (planned.has(x)) return
      planned.add(x)
      if (!reads(x)) { columns.set(x, evalNode(x)); return }
      if (isBind(x)) return
      if (x.type === 'offset') {
        // ⭐⭐ `self[k]` IS THE SECOND-ORDER CASE, AND IT IS THE KEYSTONE. A 2-pole
        // filter is `c1*input + c2*prev + c3*prev_prev` by definition — Butterworth,
        // SuperSmoother, every Ehlers design — so a running value that can see only
        // ONE bar back cannot express the DSP family at all. The step loop now keeps
        // a bounded history instead of a single carried value.
        //
        // ⛔ ONLY WHEN THE OFFSET'S CHILD IS THE BIND ITSELF. `(self + close)[1]`
        // asks for a past value of an EXPRESSION, which the step loop never computed
        // and cannot reconstruct — that stays refused, and refusing it is what keeps
        // `self[k]` meaning exactly "the running value k bars ago".
        //
        // ⚠️ STILL STRICTLY BACKWARD. `value` is a non-negative literal ON the node
        // by construction (parse.js gives an offset no slot for an expression), so
        // this reads history and can never reach forward.
        if (isBind(x.args[0])) {
          if (x.value > MAX_SELF_LAG) {
            refuse('interpret:recurrence',
              `— \`${bind}[${x.value}]\` looks back ${x.value} steps and the ceiling is `
              + `${MAX_SELF_LAG}. The history is carried per step, so a deep one is paid `
              + `on every bar of every symbol.`)
          }
          maxSelfLag = Math.max(maxSelfLag, x.value)
          return
        }
        refuse('interpret:recurrence',
          `— \`${bind}\` sits under a bar offset in ${node.name}(…) applied to an `
          + `expression rather than to \`${bind}\` itself. A past value of the running `
          + `value is held; a past value of a formula containing it was never computed.`)
      }
      if (x.type === 'call') {
        const inner = fnSpec(x.name)
        if (own(RECURRENCES, x.name)) {
          refuse('interpret:recurrence',
            `— \`${bind}\` sits inside a nested ${x.name}(…), so which running value it names `
            + `would depend on where a reader started counting.`)
        }
        if (!isPointwise(inner)) {
          refuse('interpret:recurrence',
            `— \`${bind}\` sits inside ${x.name}(…), which reads a window of bars rather than `
            + `one. Write the windowed part outside the update, or spell it with `
            + `${declared(TABLE.operators)}.`)
        }
        assertArity(x, inner)
      }
      for (const child of (Array.isArray(x.args) ? x.args : [])) plan(child)
    }
    plan(body)

    const step = (x, j, history) => {
      if (columns.has(x)) {
        const v = columns.get(x)
        return isColumn(v) ? v[j] : v
      }
      if (isBind(x)) return history[0]
      // `self[k]`, resolved HERE rather than by the generic offset arm — that one
      // walks whole columns and has no idea this value exists only inside the loop.
      if (x.type === 'offset' && isBind(x.args[0])) return history[x.value]
      const values = x.args.map((child) => step(child, j, history))
      if (x.type === 'op') return applyOpStep(x, values)
      return POINTWISE[x.name](...values)
    }

    const seed = toColumn(evalNode(node.args[rec.seed]), length)
    const out = nan(length)
    for (let i = warmup; i < length; i++) {
      // ⭐ THE SEED FILLS EVERY LAG. Before a single step has run there is no "two
      // bars ago" to read, and the seed is the only defined value in scope — the
      // same initial condition Pine states by hand as `nz(x[1], x)`. ⛔ NOT zero: a
      // filter seeded at 0 spends its whole warm-up climbing back to price and
      // reports that climb as signal.
      const history = new Array(maxSelfLag + 1).fill(seed[i - warmup])
      for (let j = i - warmup + 1; j <= i; j++) {
        const next = step(body, j, history)
        for (let k = maxSelfLag; k > 0; k--) history[k] = history[k - 1]
        history[0] = next
      }
      out[i] = history[0]
    }
    return out
  }

  return toColumn(evalNode(ast), length)
}

// --------------------------------------------------------------------------- //
// lifting scalars and columns
// --------------------------------------------------------------------------- //
//
// A scalar stays a scalar until it meets a column, so `20 * 2` is 40 (a number)
// and `close * 2` is a column. That keeps `sma(close, 10 * 2)`… out of reach,
// deliberately — `windowLiteral` refuses a computed window because `maxLookback`
// must stay decidable without evaluating anything.

function lift1(a, f, length) {
  if (!isColumn(a)) return f(a)
  const out = nan(length)
  for (let i = 0; i < length; i++) out[i] = f(a[i])
  return out
}

function lift2(a, b, f, length) {
  if (!isColumn(a) && !isColumn(b)) return f(a, b)
  const ca = isColumn(a) ? a : null
  const cb = isColumn(b) ? b : null
  const out = nan(length)
  for (let i = 0; i < length; i++) out[i] = f(ca ? ca[i] : a, cb ? cb[i] : b)
  return out
}

function lift3(t, a, b, f, length) {
  if (!isColumn(t) && !isColumn(a) && !isColumn(b)) return f(t, a, b)
  const ct = isColumn(t) ? t : null
  const ca = isColumn(a) ? a : null
  const cb = isColumn(b) ? b : null
  const out = nan(length)
  for (let i = 0; i < length; i++) {
    out[i] = f(ct ? ct[i] : t, ca ? ca[i] : a, cb ? cb[i] : b)
  }
  return out
}
