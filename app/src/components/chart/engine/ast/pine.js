// ─── PINE IN, ONE FORMULA OUT ───────────────────────────────────────────────
//
// A member pastes a Pine script and gets a scan. This module is the door, and
// everything downstream of it is the door that was already there.
//
// ⭐⭐ IT PRODUCES **SOURCE TEXT**, NOT A STORED TREE. `parse.js` stays the ONLY
// producer of a persisted AST. The translator emits a UCT formula string, that
// string goes into the same box a member types into, and `parseFormula` makes the
// tree exactly as it does for a hand-typed formula. So `astHash` — which IS
// `compute.fn`, which IS `def_hash` — is byte-identical to what the builder would
// have produced for the same formula, the Python lane needs no change at all, and
// a jsep upgrade cannot desynchronise a Pine-authored definition from a typed one.
//
// ⭐⭐ AND THE TRANSLATION PROVES ITSELF. This module builds a canonical tree as
// it walks, prints text from it, RE-PARSES that text through `parseFormula`, and
// compares `astHash`. A printer bug is therefore a loud `pine:roundtrip` refusal
// and never a formula that means something else than the Pine said. Two
// independent producers must agree or nothing is emitted — that is the mechanical
// form of "a Pine script that half-translates is the worst possible outcome".
//
// ⭐⭐ THE FUNCTION MAP IS DERIVED FROM `closedTable.json` AT RUNTIME. There is no
// list of indicator names in this file. `ta.rsi` resolves because `rsi` is a key
// of `TABLE.functions`; the day another key lands there, the Pine name that
// normalises to it works with nothing here changing, and its ARITY and its
// ARGUMENT KINDS are read off the same declaration. `PINE_NAME_ALIASES` below is
// spelling only — it renames, it never asserts that anything exists.
//
// ⛔ EVERY UNSUPPORTED CONSTRUCT REFUSES BY NAME, AT ITS OWN TOKEN. Each refusal
// carries `{guard, message, line, column, token}` and the source line with a
// caret. The messages are pairwise disjoint from each other AND from `parse.js`'s,
// `interpret.js`'s, `budget.js`'s and `sentence.js`'s, for the reason those four
// are disjoint from one another: two gates sharing a phrase let a `toThrow(/…/)`
// pass with the safety deleted, and that has happened in this repo.
//
// ⭐ RESOLUTION RUNS **BACKWARDS FROM THE OUTPUTS**, AND THAT IS THE WHOLE REASON
// REAL SCRIPTS TRANSLATE. A published screener carries forty `input.symbol` rows,
// an `hline`, a `fill`, a table and a `func() =>` that the plot never touches.
// Refusing the script because line 31 declares a symbol input would refuse every
// real script on TradingView. So a statement is only ever REFUSED when it is on
// the path from a `plot()`/`alertcondition()` to its value; a statement nothing
// reaches is a NOTE, listed, never silently dropped.
// ⛔ THE ONE HOLE THAT WOULD OPEN IS `:=`, AND IT IS CLOSED BY CONSTRUCTION: a
// name reassigned ANYWHERE in the script — including inside an `if` or a `for`
// this module never reads — is marked opaque at its reassignment token, so
// inlining its first binding and ignoring the mutation is not reachable.
//
// ⛔ `close[1]` IS REFUSED, AND THAT IS A DECISION MADE ELSEWHERE. The manifest's
// `_no_offset` declares that there is no backward-index form, and
// `_no_offset_reopened_by` declares that re-opening it belongs to the owner of the
// repaint claim together with the owner of the manifest — "not a v2 feature
// request that any later task may grant on its own". Granting it here would make
// `maxLookback(ast)` stop being a tree sum. So the `[` token refuses, by name,
// and the message names `change(...)` when the shape is the one `change` already
// says.
//
// ⚠️ WHAT TRADINGVIEW'S OWN PINE SCREENER RESTRICTS IS A DIFFERENT AND MUCH
// SHORTER LIST than what this engine restricts, and pretending otherwise would be
// the over-claim. Measured 2026-08-09 against TradingView's own help centre
// (`support/solutions/43000742436`), the Pine Screener requires only: at least one
// `plot()` or `alertcondition()`; at most FIVE `request.*()` calls, whose
// timeframes come from a fixed list; a timeframe from that same list; one
// indicator per screen; no indicator-on-indicator; Pine v4 or higher; and it
// computes on THE LAST 500 BARS. It supports `request.*` — multi-timeframe and
// other-symbol data are ALLOWED there — and it supports most `input.*`, falling
// back to defaults for `input.timeframe`/`input.symbol`/`input.time`.
// ⛔ IT PUBLISHES NO RULE AT ALL about arrays, maps, user-defined types, `var`,
// loops, `barstate.*`, or strategies-versus-indicators. Those are legal Pine and
// TradingView runs them; they simply produce nothing a column can read. So a
// refusal below is almost always THIS ENGINE'S limit and not TradingView's, and
// the coverage map says which is which. Claiming "TradingView rejects arrays"
// would be a fabrication, and it is the kind a competitor can disprove in one
// screenshot.

import { TABLE, NODE_TYPES, parseFormula, astHash, isPointwise, TICKER_SHAPE } from './parse.js'
// ⭐ THE ONE `yields` RESOLVER IN THIS LANE. See `treeYieldsBool` — this module
// used to carry a second copy, and closed table v2 made the two disagree in a
// single commit. ⚠️ NOT A CYCLE: `sentence.js` imports `parse.js` and never
// imports this file, so the graph stays a tree.
import { yieldsOf, compileRules, SENTENCE_RULES } from './sentence.js'
// ⭐⭐ THE INTERPRETER'S OWN ARITHMETIC, BORROWED RATHER THAN COPIED — see
// `constantValueOf`. `FN` is the shipped implementation of every table function,
// and for a POINTWISE entry each one is documented in place as "the pointwise
// scalar applied per bar and nothing else". Calling it on one-bar columns is
// therefore the same number the chart draws, by construction.
// ⚠️ NOT A CYCLE, AND CHECKED: `interpret.js` imports `parse.js`, `budget.js`,
// `sentence.js` and `../../indicators.js`, none of which import this file; the
// only module that imports `pine.js` is `thinkscript.js`.
// ⛔ NOT `POINTWISE_FOR_PARITY`, whose own comment says it is exported "for the
// cross-lane parity run, and for nothing else … nothing in the app imports it".
// Importing it here would falsify a comment that is a claim about a run
// (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`), and `FN` is
// defined in terms of it anyway, so there is still exactly one authority.
import { FN } from './interpret.js'

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** A Pine construct this translator will not translate. Carries the guard AND
 *  the exact token, because "somewhere in your script" is not a refusal a member
 *  can act on. */
export class PineRefusal extends Error {
  constructor(guard, message, at) {
    super(message)
    this.name = 'PineRefusal'
    this.guard = guard
    this.at = at || null
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s, `interpret.js`'s, `budget.js`'s
 *  AND `sentence.js`'s TABLES TOO. `pine.test.js` asserts that over the UNION of
 *  all five, in both directions — "no message equals another" misses the half
 *  that matters, which is "no message is a SUBSTRING of another". */
export const REFUSALS = Object.freeze({
  'pine:empty':
    'there is no Pine here to translate',
  'pine:character':
    'Pine has no character like this one',
  'pine:statement':
    'this Pine line is not a shape the translator reads',
  'pine:declaration-strategy':
    'a strategy places orders to be backtested, and a screen filters symbols',
  'pine:declaration-library':
    'a Pine library exports functions instead of producing a plot to filter on',
  'pine:module':
    'importing another script pulls in code this engine never sees',
  'pine:strategy-call':
    'an order-placing call answers with no value a screen could filter',
  // ⚰️ IT SAID "another symbol or another timeframe is outside what one screened
  // column reads". BOTH are inside it: this very door emits `sym` and `tf`. What
  // it actually fires on is a request this door could not RESOLVE — a computed
  // symbol, a timeframe outside the servable ladder, a shape the folder cannot
  // reduce to a literal. Saying "outside what a column reads" told a member the
  // engine lacks a feature it ships, which is how a fixable script gets abandoned.
  'pine:request':
    'this request could not be resolved to one symbol and one servable timeframe. '
    + 'The engine reads another symbol as `sym` (limited to the benchmark roster) '
    + 'and another timeframe as `tf` (weekly and monthly from daily bars); what '
    + 'stops this one is that its arguments do not fold to those',
  'pine:drawing':
    'a drawing object paints on a chart and answers with no number',
  'pine:collection':
    'an array, a matrix or a map is outside the expression grammar this engine runs',
  // ⚰️ IT SAID persisting state is "outside this engine grammar". It is not:
  // `var s = 0.0` / `s := s + close` translates today to
  // `accum(0, self + close, 250)`. What is outside the grammar is state that does
  // not FORGET — the accumulator re-seeds a fixed number of bars back, so a value
  // whose whole history matters cannot ride it.
  'pine:state':
    'this value carries forward in a way the bounded accumulator cannot hold. '
    + '`var` state that re-seeds does translate, as `accum`; what this one needs '
    + 'is a running total with no window, which the grammar has no node for',
  'pine:reassign':
    'a name that is reassigned later cannot be folded into one expression',
  'pine:block':
    'a Pine block spans several statements and this engine stores a single expression',
  // ⚰️ "the four node shapes" — THERE ARE EIGHT, and the count was stale rather
  // than wrong-in-principle: `tf`, `sym` and `tf_live` all landed after it was
  // typed. A member reading it was told the engine is half the size it is. The
  // count is not restated here at all now, because a number beside a list it
  // describes is this repo's most repeated defect and `NODE_TYPES` already owns it.
  'pine:type':
    'a user-defined type is outside the node shapes this engine stores',
  'pine:function-def':
    'a Pine function definition introduces a name this engine has nowhere to keep',
  'pine:tuple':
    'this Pine call answers with several values at once and a column carries one',
  'pine:history-ref':
    'the bar-offset form has no node in this engine grammar yet',
  'pine:offset-literal':
    'a bar offset has to be a plain whole number written into the script',
  'pine:offset-negative':
    'a bar offset that runs forwards would read a bar that has not happened',
  // ⚰️ IT SAID "Pine na has no spelling in this engine grammar" — and bare `na`
  // translates to `0 / 0`, while `na(x)` and `nz(x, y)` are both DECLARED
  // FUNCTIONS. Measured: this guard now fires for exactly one name, `fixnan`,
  // whose job is to carry the LAST NON-NaN VALUE FORWARD — a per-bar memory, which
  // is a different thing from spelling not-computable.
  'pine:na':
    'this fills a gap by carrying an earlier bar\'s value forward, which needs a '
    + 'per-bar memory this grammar has no node for. `na` and `nz` themselves do '
    + 'translate',
  'pine:text-value':
    'text cannot be a value in a screened column',
  'pine:colour-value':
    'a colour cannot be a value in a screened column',
  // ⚰️ "no counterpart in the engine grammar" IS FALSE FOR AT LEAST `%`: the
  // table declares `mod`, whose own sentence reads "the remainder of {0} divided
  // by {1}". The blocker is not vocabulary, it is SEMANTICS — this engine's `mod`
  // truncates toward zero (the sign follows the LEFT operand) and no
  // TradingView-hosted page states how Pine's `%` rounds a NEGATIVE operand.
  // ⛔ SO IT STILL REFUSES, and that is right — but it now refuses for the reason
  // that is actually true, and names the one fact that would unblock it. A
  // refusal claiming a missing feature sends the reader to the manifest; this one
  // sends them to the Pine reference, which is where the answer is.
  'pine:operator':
    'this Pine operator has no counterpart this door is sure of. `%` maps to the '
    + 'declared `mod`, which truncates toward zero \u2014 but Pine does not publish '
    + 'how `%` rounds a negative operand, and guessing would answer a different '
    + 'number for half the inputs',
  'pine:builtin':
    'this Pine built-in names something the engine grammar does not hold',
  'pine:function':
    'this Pine function maps to nothing the engine grammar declares',
  'pine:arity':
    'the engine grammar declares a different signature for that name',
  'pine:named-argument':
    'a named argument cannot be matched onto the engine grammar positions',
  'pine:window':
    'a Pine length has to reach the engine as a plain whole number',
  'pine:input-kind':
    'this Pine input carries a default the engine grammar cannot hold',
  'pine:cycle':
    'this Pine name is defined in terms of itself',
  'pine:undefined':
    'this Pine name was never given a value in the pasted script',
  'pine:no-output':
    'the pasted script offers no plot and no alert condition to filter on',
  'pine:plot-offset':
    'a displaced plot writes its value at a different bar from the one that produced it',
  'pine:role-order':
    'this table states what kind each argument is and never what role it plays, '
    + 'so several price series cannot be matched onto it by position',
  'pine:roundtrip':
    'the translator wrote formula text it could not read back, so it emitted none',
})

// --------------------------------------------------------------------------- //
// the namespaces, by what they mean rather than by a list of members
// --------------------------------------------------------------------------- //

/** A Pine namespace prefix → the guard that refuses everything under it.
 *
 *  ⭐ A PREFIX, NOT A MEMBER LIST. `request.security`, `request.security_lower_tf`
 *  and whatever TradingView ships next all refuse under one entry, which is what
 *  keeps this from being the list-that-rots. The guard names WHY the whole
 *  namespace is out, and a namespace with several reasons would be several
 *  entries. */
/** Pine timeframe strings \u2192 this engine's codes.
 *
 *  \u26a0\ufe0f ONLY THE ONES `tf` CAN RESAMPLE. Pine spells a week `"W"` or `"1W"`, a
 *  month `"M"` or `"1M"`; everything else it can say \u2014 `"60"`, `"D"`, `"3M"` \u2014
 *  is deliberately absent, so those requests fall through to `pine:request`
 *  rather than translating into a timeframe the engine would then refuse at
 *  `interpret:timeframe`. Refusing at the DOOR the member typed at is the whole
 *  point of the translator. */
/** The Pine calls that OFFER A COLUMN, and the argument each names it with.
 *
 *  ⭐⭐ `plotshape` AND `plotchar` MARK BARS, AND A MARKED BAR *IS* A COLUMN.
 *  Pine draws a glyph where the first argument is true; this engine renders that
 *  as a marker series and SCANS it as the 0/1 column it already is. So they cost
 *  no new machinery at all — they are `alertcondition`'s shape with `plot`'s
 *  parameter name, and both of those were already here.
 *
 *  ⚠️ WHAT IS NOT CLAIMED: the GLYPH. Pine can ask for a triangle above the bar
 *  and this engine draws its own marker at the bar. The bars marked are exactly
 *  the bars Pine marks — the VALUE is identical and that is what a scan reads —
 *  but the shape and the vertical placement are ours. That is a difference in
 *  appearance, not in arithmetic, which is why it translates rather than refusing:
 *  contrast `plot(offset = n)`, which moves a value to a DIFFERENT BAR and is
 *  refused, because that one changes the answer.
 *
 *  ⛔ `plotcandle`, `plotbar`, `plotarrow` ARE DELIBERATELY ABSENT. Each needs
 *  more than one column to mean anything (`plotcandle` takes four), so reading one
 *  as a single series would offer a member a quarter of a candle under the
 *  script's title. They keep refusing at `pine:no-output` until there is a
 *  multi-column output shape to land them in. */
const OUTPUT_CALLS = Object.freeze({
  plot: 'series',
  alertcondition: 'condition',
  plotshape: 'series',
  plotchar: 'series',
  // ⭐ ONE SERIES, NOT FOUR — which is why it belongs here and `plotcandle` does
  // not. `plotarrow(series, …)` takes a single "series int/float" and draws an up
  // arrow where it is positive, a down arrow where it is negative, and nothing at
  // zero or `na`. It sat in `CHART_ONLY_CALLS` beside `plotcandle` and `plotbar`
  // under a comment reading "each needs more than one column to mean anything",
  // which is true of those two and was never true of this one.
  // ⚠️ THE VALUE IS THE ARROW'S OWN SERIES, and its SIGN is the whole meaning.
  // Nothing here reads it as a direction, so a member screening on it filters the
  // number the author computed — which is what the plot draws from and what
  // TradingView's own screener offers for it.
  plotarrow: 'series',
})

/** ⭐⭐ THE CALLS THAT DRAW A WHOLE CANDLE — FOUR COLUMNS, NOT ONE.
 *
 *  ⚰️ `plotcandle` AND `plotbar` WERE FILED AS PAINT, and the reason given was
 *  right about the problem and wrong about the answer: "offering one of them
 *  under the script's title is a quarter of a candle". So offer FOUR, each under
 *  its own role. TradingView's own screener requirements list `plotbar()` and
 *  `plotcandle()` beside `plot()` as outputs a screening filter may come from —
 *  the same sentence that got `plotarrow` released from this set.
 *
 *  ⭐ AND THE FOUR ARE ONLY USEFUL TOGETHER, which is the argument FOR emitting
 *  them all rather than against emitting any. The screen a member actually wants
 *  off `08-smoothed-heiken-ashi-candles` is "the smoothed Heikin-Ashi candle
 *  turned green" — `close > open` — and that needs BOTH columns to exist. One
 *  column would have been a quarter of a candle; four are a candle.
 *
 *  ⚠️ THE ROLE NAMES ARE PINE'S OWN PARAMETER NAMES, so a fully-named call
 *  (`plotcandle(close = c, open = o, …)`) picks the right series by name and a
 *  positional one picks by position. Reading position only would translate a
 *  reordered named call into a candle with its high and low swapped, which draws
 *  perfectly and screens backwards. */
const MULTI_OUTPUT_CALLS = Object.freeze({
  plotcandle: Object.freeze(['open', 'high', 'low', 'close']),
  plotbar: Object.freeze(['open', 'high', 'low', 'close']),
})

const PINE_TF_CODE = Object.freeze({ W: 'W', '1W': 'W', M: 'M', '1M': 'M' })

/** The spellings that mean “THIS chart's symbol”, across Pine versions.
 *
 *  ⚠️ `tickerid` AND `ticker` ARE THE v2/v3 NAMES for what v5 spells
 *  `syminfo.tickerid` / `syminfo.ticker`, and the community corpus is full of v3
 *  scripts that still use them (19-cm-macd-ult-mtf, 20-cm-ultimate-ma-mtf).
 *  Knowing only the v5 spelling would refuse the same script purely for having
 *  been written in 2015. */
/** Pine names for THIS CHART'S OWN timeframe, across versions.
 *
 *  ⛔⛔ A SET, NOT AN INLINE `||` PAIR, AND THE READER FOLLOWS BINDINGS FIRST.
 *  The comparison this replaces was written inline in `securityAsNode` as
 *  `tfNode.name === 'timeframe.period' || tfNode.name === 'period'`, which asks
 *  only what a node is CALLED — so `period = "60"` immediately above the call
 *  read as the chart's own timeframe and the script answered off daily bars while
 *  asking for hourly ones. That is the identical defect `ownSymbolNameOf` was
 *  fixed for three lines away, left standing on the timeframe side; the symbol
 *  fix even documents the ordering rule that this line then ignored. Caught by a
 *  shadowing CONTROL, not by review — for the second time. */
const OWN_TF_NAMES = new Set(['timeframe.period', 'period'])

const OWN_SYMBOL_NAMES = new Set([
  'syminfo.tickerid', 'syminfo.ticker', 'tickerid', 'ticker',
])

const NAMESPACE_GUARD = Object.freeze({
  request: 'pine:request',
  strategy: 'pine:strategy-call',
  line: 'pine:drawing',
  linefill: 'pine:drawing',
  label: 'pine:drawing',
  box: 'pine:drawing',
  polyline: 'pine:drawing',
  table: 'pine:drawing',
  array: 'pine:collection',
  matrix: 'pine:collection',
  map: 'pine:collection',
  str: 'pine:builtin',
  syminfo: 'pine:builtin',
  ticker: 'pine:builtin',
  timeframe: 'pine:builtin',
  session: 'pine:builtin',
  barstate: 'pine:builtin',
  chart: 'pine:builtin',
  color: 'pine:colour-value',
  runtime: 'pine:builtin',
  log: 'pine:builtin',
  alert: 'pine:builtin',
  currency: 'pine:builtin',
  earnings: 'pine:builtin',
  dividends: 'pine:builtin',
  splits: 'pine:builtin',
  adjustment: 'pine:builtin',
  display: 'pine:builtin',
  format: 'pine:builtin',
  location: 'pine:builtin',
  scale: 'pine:builtin',
  shape: 'pine:builtin',
  size: 'pine:builtin',
  extend: 'pine:builtin',
  xloc: 'pine:builtin',
  yloc: 'pine:builtin',
  order: 'pine:builtin',
  position: 'pine:builtin',
  text: 'pine:builtin',
  font: 'pine:builtin',
  dayofweek: 'pine:builtin',
})

/** The two namespaces whose members are ORDINARY VALUE FUNCTIONS that this engine
 *  may hold. Everything else under a dot is decided by `NAMESPACE_GUARD`.
 *
 *  ⛔ `ta` AND `math` ARE NOT AN ALLOW-LIST OF FUNCTIONS. They are the two places
 *  Pine keeps the kind of thing this table could declare; whether any particular
 *  member exists is `TABLE.functions`'s answer and nothing else's. */
const VALUE_NAMESPACES = Object.freeze(new Set(['ta', 'math']))

/**
 * ⭐⭐ THE ONE THING THE MANIFEST DOES NOT DECLARE, AND THE ONLY REASON THIS
 * TABLE EXISTS: `closedTable.json` states what KIND each argument is
 * (`["series","series","series","int"]`) and never what ROLE it plays. So for a
 * function with more than one series argument, "same name, same arity" does NOT
 * establish that Pine's positions line up with this table's — and the default
 * below is therefore to REFUSE, not to line them up and hope.
 *
 * ⛔ THIS WAS MEASURED, NOT ANTICIPATED. Pine's `ta.stoch(source, high, low, n)`
 * against this table's `stoch(h, l, c, n)` translated verbatim, produced a
 * plausible number, produced a plausible read-back, and was WRONG BY 126 POINTS
 * of a 0-100 oscillator. `pine.roles.test.js` is the probe that caught it and it
 * is a standing rail: every entry here is checked against the interpreter by
 * EVALUATING it on bars whose high, low and close are all different, so a
 * permutation that stops being right goes red instead of going unnoticed.
 *
 * `table` is a CANDIDATE KEY, resolved through the same derived index as any
 * other name — an entry naming a function the manifest does not declare refuses
 * at `pine:function` exactly like an undeclared one. `build` says how to fill
 * each of the TABLE's argument positions: `{pine: i}` takes Pine's i-th argument,
 * `{series: 'high'}` supplies a chart series Pine leaves implicit.
 *
 * ⛔ `ta.atr` IS ABSENT ON PURPOSE AND ITS ABSENCE IS A MEASUREMENT. Pine's
 * `ta.atr` is Wilder's RMA of true range; this table's `atr(h,l,c,n)` matches
 * NEITHER that (max difference 0.20) NOR a plain SMA of true range (0.21), so it
 * runs a third smoothing convention and a member reading Pine's number would get
 * a different one. It refuses at `pine:arity` today because the arities also
 * differ; if the arities ever agree it must still refuse until the conventions
 * are reconciled. Same reasoning holds for `ta.cci`, whose Pine definition is
 * built on an arbitrary `source` rather than on the typical price.
 */
export const PINE_CALL_SHAPES = Object.freeze({
  // Two series, and the ORDER MEANS SOMETHING: `ta.crossover(a, b)` is "a crossed
  // above b", and so is this table's `crossOver(a, b)`. Railed.
  crossover: { table: 'crossOver', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  crossunder: { table: 'crossUnder', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  // Two series and order-INSENSITIVE; the rail asserts the commutativity rather
  // than assuming it.
  min: { table: 'min', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  max: { table: 'max', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  // ⭐ THE PERMUTATION. Pine (source, high, low, length) → table (high, low, close,
  // length): Pine's `source` plays the role this table calls `c`.
  stoch: { table: 'stoch', pineArity: 4, build: [{ pine: 1 }, { pine: 2 }, { pine: 0 }, { pine: 3 }] },
  // Pine's `ta.wpr(length)` leaves high/low/close implicit; supplying them is an
  // identity, and the rail measures it at max difference 0.
  wpr: { table: 'williams_r', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
  // ⭐ THE SAME SHAPE AS `wpr`, AND IT CLOSES `pine:role-order`. Pine's
  // `ta.atr(length)` leaves high/low/close implicit against the chart's own
  // symbol; this table takes them explicitly so `atr(high, low, sma(close,3), 14)`
  // is sayable. Supplying the three declared series IS Pine's meaning, not a
  // guess — and the read-back says them out loud, so a member sees what was
  // understood. ⛔ Without this the translator could see that `atr` exists and
  // that it takes four arguments, and had no way to know WHICH three to fill:
  // refusing was right, and declaring the order is what makes it unnecessary.
  atr: { table: 'atr', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
  // ⭐⭐ THE THREE LEGS `ta.dmi` ANSWERS WITH. Pine has no singular spelling for
  // them — the only way to reach one is to destructure `[+DI, -DI, ADX]` — so
  // these keys are synthetic and `dmiParts` is their only caller.
  //
  // ⛔ THEY ARE DECLARED HERE RATHER THAN BUILT AT THE DESTRUCTURE, and that is
  // the point of this table: the manifest states what KIND each argument is and
  // never what ROLE it plays, so a translator that filled `high, low, close`
  // itself would be supplying a role order nobody measured. Written out, the
  // read-back says the three series out loud and a member sees what was
  // understood. (Building them inline refused at `pine:role-order`, correctly.)
  'dmiplusleg': { table: 'plusDI', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
  'dmiminusleg': { table: 'minusDI', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
  'dmiadxleg': { table: 'adx', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
})

/**
 * ⭐⭐ PINE'S OWN PARAMETER NAMES, PER FUNCTION, EACH CARRYING ITS EVIDENCE —
 * so this table cannot grow by convention.
 *
 * ⛔⛔ A ROLE ORDER AND A SET OF PARAMETER NAMES ARE DIFFERENT FACTS, AND THIS
 * FILE NEEDS BOTH BEFORE IT WILL MATCH A NAMED ARGUMENT. `PINE_CALL_SHAPES`
 * above holds a MEASURED permutation for `ta.stoch`; nothing in it says what Pine
 * CALLS those four parameters, and no TradingView-hosted page states them (only
 * third-party sites do). `ta.stoch` therefore has an entry there and none here,
 * and a named `ta.stoch(source = …)` still refuses. That asymmetry is the whole
 * design: `ta.stoch` mapped by convention was WRONG BY 126 POINTS of a 0-100
 * oscillator, and "source is usually first" is a convention.
 *
 * ⭐ THE KEY SPACE IS `PINE_CALL_SHAPES`'s — `normaliseName(base)` — so an entry
 * that has both is looked up the same way in both, and the census in
 * `pine.namedargs.test.js` can join them without a second normalisation.
 *
 * ⭐ THE STRUCTURAL SAFETY PROPERTY, ASSERTED BY THAT CENSUS: an entry here for a
 * table function with more than one `series` slot must ALSO have a shape.
 * Otherwise naming the arguments would be the only way to reach a role order
 * nobody measured — the door a positional call is refused at.
 *
 * ⚠️ VERSION TRAPS, KNOWN AND SURVIVED RATHER THAN IGNORED. Pine v4 spells RSI's
 * parameters `rsi(x, y)`, not `(source, length)`. `x`/`y` are absent here, so a
 * v4 script that names them refuses BY NAME rather than being matched by
 * position — the safe direction. And every name that IS here occupies the SAME
 * position in v4 and v5, so one version-independent table is honest today. A
 * version-aware table becomes necessary the day a name MOVES between versions,
 * not merely gets renamed.
 */
export const PINE_ARG_NAMES = Object.freeze({
  sma: {
    names: ['source', 'length'],
    evidence: 'tests/fixtures/pine_community/26-spy-to-es-qqq-to-nq.pine:47 '
      + '+ pine-script-reference/v5/#fun_ta.sma + migration-guides/to-pine-version-5',
  },
  ema: {
    names: ['source', 'length'],
    evidence: 'pine-script-reference/v5/#fun_ta.ema + migration-guides/to-pine-version-5',
  },
  wma: {
    names: ['source', 'length'],
    evidence: 'pine-script-reference/v5/#fun_ta.wma',
  },
  rsi: {
    names: ['source', 'length'],
    evidence: 'pine-script-reference/v5/#fun_ta.rsi + migration-guides/to-pine-version-5 '
      + '(⚠️ v4 spells these `x`, `y` — deliberately absent)',
  },
  crossover: {
    names: ['source1', 'source2'],
    evidence: 'migration-guides/to-pine-version-5 rename table: "crossover(x, y)" '
      + '→ "ta.crossover(source1, source2)"',
  },
})

/** ⛔⛔ NAMES THAT WERE DELIBERATELY NOT ADDED, AND WHY — because an absence is
 *  invisible and reads as an oversight to the next reader.
 *
 *  `stoch` — measured role order, NO evidenced names anywhere. The one call this
 *    change must not start accepting.
 *  `atr`, `wpr`, `highest`, `lowest`, `max`, `min` — the v5 migration guide lists
 *    these with EMPTY parentheses ("ta.atr()", "math.max()"), which evidences the
 *    namespace move and nothing about parameters. No corpus call site either.
 *  `crossunder` — its twin `ta.crossover(source1, source2)` is doc-evidenced;
 *    assuming the pair mirrors is a guess, and it is a guess about an
 *    ORDER-SENSITIVE function, which is the most expensive kind.
 *  `stdev`, `change`, `nz`, and the three synthetic `dmi*` legs — no corpus named
 *    call site and no readable TradingView signature. */

/** `request.security`'s parameters, IN PINE'S ORDER.
 *
 *  ⭐ ONE ORDERED LIST SERVES v4 AND v5, and that is a measurement rather than an
 *  assumption: v4's `security(symbol, resolution, expression, gaps, lookahead,
 *  ignore_invalid_symbol)` is v5's list with the second parameter RENAMED and the
 *  last two not yet added. A rename shares a slot; only a REORDER would force a
 *  version-aware table, and neither version reorders.
 *
 *  ⛔ WHY THIS DOOR NEEDED IT AT ALL: `securityAsNode` used to read
 *  `args.filter((a) => !a.name)` and drop every named argument on the floor, so a
 *  fully-named request fell through to `pine:request` — "another symbol or another
 *  timeframe is outside what one screened column reads" — a sentence that is FALSE
 *  about a call this door provably takes when the same arguments are written in
 *  order. A false refusal sends a member looking for a limit that does not exist.
 *
 *  ↳ v5: https://www.tradingview.com/pine-script-reference/v5/#fun_request.security
 *  ↳ v4: https://www.tradingview.com/pine-script-reference/v4/#fun_security */
const REQUEST_SECURITY_ARGS = Object.freeze([
  'symbol', 'timeframe', 'expression', 'gaps', 'lookahead',
  'ignore_invalid_symbol', 'currency', 'calc_bars_count',
])

/** v4's spelling for slot 1. A rename, not a reorder — see above. */
const REQUEST_SECURITY_ALIASES = Object.freeze({ resolution: 'timeframe' })

/** Pine v1–v4 spelled several of these WITHOUT a namespace; v5 moved them into
 *  one. `security(…)` in a v3 script is `request.security(…)`, and calling it
 *  "a function this table does not declare" would send a member looking for a
 *  spelling instead of telling them their script reads another timeframe.
 *
 *  ⛔ THE VALUE IS A NAMESPACE, NOT A GUARD. It routes into `NAMESPACE_GUARD`, so
 *  the reason a legacy name is refused is the same declaration that refuses its
 *  modern spelling and the two can never drift into different sentences. */
const LEGACY_BARE_NAMESPACE = Object.freeze({
  security: 'request',
  security_lower_tf: 'request',
  financial: 'request',
  quandl: 'request',
  splits: 'request',
  dividends: 'request',
  earnings: 'request',
})

/** Pine's own derived price series, expanded to the arithmetic Pine's reference
 *  manual defines them as.
 *
 *  ⚠️ AN EXPANSION IS ONLY ADMISSIBLE WHEN IT IS AN IDENTITY, and these four are:
 *  the Pine reference defines `hl2` AS `(high + low) / 2`. It is not a guess about
 *  what the author meant, and the read-back says the arithmetic out loud, so a
 *  member sees exactly what was understood. */
const DERIVED_SERIES = Object.freeze({
  hl2: ['high', 'low'],
  hlc3: ['high', 'low', 'close'],
  ohlc4: ['open', 'high', 'low', 'close'],
  hlcc4: ['high', 'low', 'close', 'close'],
})

/** The mean of those fields as a canonical tree, or null when the table is
 *  missing one of them.
 *
 *  ⭐⭐ EXPORTED, BECAUSE THINKORSWIM SPELLS THREE OF THESE THE SAME WAY AND MEANS
 *  THE SAME ARITHMETIC. `HL2` sat in `thinkscript.js`'s "price series this engine
 *  keeps no field for" list and refused, while this door expanded the identical
 *  name — two answers to one question, which is this repo's most repeated defect
 *  arriving between two lanes rather than inside one. thinkorswim's Constants
 *  page defines `HL2` as `(high + low) / 2` exactly as Pine's reference does, so
 *  the expansion is the same identity read from two manuals.
 *  ⚠️ `hlcc4` IS PINE-ONLY and stays declared here regardless: this map is what
 *  each dialect may ASK FOR, not what both happen to share. thinkScript asks for
 *  the three it publishes. */
export function derivedSeriesTree(name, table) {
  if (!own(DERIVED_SERIES, name)) return null
  const parts = DERIVED_SERIES[name]
  if (parts.some((p) => !own((table && table.series) || {}, p))) return null
  const sum = parts.map(cSeries).reduce((a, b) => cOp('+', [a, b]))
  return cOp('/', [sum, cNum(parts.length)])
}

/** Pine built-ins that are not a MEAN of price series but are still an exact
 *  expansion in this table's own vocabulary.
 *
 *  ⭐ `tr` IS THE WHOLE REASON THIS MAP EXISTS, and it became expressible the day
 *  the bounded backward offset landed: True Range is
 *  `max(high - low, max(abs(high - close[1]), abs(low - close[1])))`, which is
 *  the Pine reference manual's own definition rather than an approximation of
 *  it. Before the offset it could not be said at all; `DERIVED_SERIES` could not
 *  hold it either, because that map builds a mean and this is not one.
 *
 *  ⚠️ ONE BAR DIFFERS FROM PINE, AND IT DIFFERS IN THE SAFE DIRECTION. Pine's
 *  bare `ta.tr` falls back to `high - low` on the first bar, where `close[1]`
 *  does not exist; this expansion is NOT COMPUTABLE there, like every other
 *  lookback in this engine. `ta.tr(true)` asks for Pine's fallback explicitly and
 *  is refused rather than silently given this one — the extra NaN is a bar the
 *  member can see, and a fabricated first bar is not.
 *
 *  ⛔ AN EXPANSION IS ONLY ADMISSIBLE WHEN IT IS AN IDENTITY. Anything that
 *  needed a judgement about what the author meant belongs in a refusal. */
const BUILTIN_SERIES_TREE = Object.freeze({
  tr: () => {
    const prevClose = { type: 'offset', value: 1, args: [cSeries('close')] };
    const gap = (side) => cCall('abs', [cOp('-', [cSeries(side), prevClose])]);
    return cCall('max', [
      cOp('-', [cSeries('high'), cSeries('low')]),
      cCall('max', [gap('high'), gap('low')]),
    ]);
  },
})

/** ⭐⭐ PINE BUILT-INS THIS ENGINE'S EVALUATION MODEL ALREADY ANSWERS.
 *
 *  These are NOT approximations, and that distinction is the whole reason they are
 *  admissible. This engine evaluates CLOSED, HISTORICAL bars, once per bar — that
 *  is the Phase C cutover, not a property of this file — so `barstate.isconfirmed`
 *  is not "near enough to true", it IS true, on every bar this engine will ever
 *  evaluate. Same for the other three: there is no live tick here, no bar that is
 *  not history, and no second evaluation of a bar that would make one "not new".
 *
 *  ⛔ AND THAT IS EXACTLY WHY `barstate.islast` IS NOT HERE. It reads as the
 *  closest possible neighbour — same namespace, same shape, same one-word answer —
 *  but its value is decided by HOW MANY BARS WERE ASKED FOR, not by the engine, so
 *  a scan over 500 bars and the same scan over 5,000 disagree about which bar is
 *  the last one. That is `lesson_a_derived_value_must_not_depend_on_the_request`,
 *  and the split between these two maps is the whole judgement being made here.
 *  `BUILTIN_REQUEST_DEPENDENT` below holds the ones that must never move up.
 *
 *  A boolean is a `number` 1/0 in this table (see the `true` literal in `atom`),
 *  so all four cost the closed table exactly zero new names.
 */
export const BUILTIN_CONSTANT_TREE = Object.freeze({
  'barstate.isconfirmed': () => cNum(1),
  'barstate.ishistory': () => cNum(1),
  'barstate.isnew': () => cNum(1),
  'barstate.isrealtime': () => cNum(0),
})

/** The look-alikes of the four above — REFUSED, and refused with the reason.
 *
 *  ⛔ A GENERIC `pine:builtin` HERE WOULD BE THE WRONG SENTENCE. "This engine has
 *  no home for that name" is false: it has a home for its three siblings. The true
 *  sentence is that the answer would change with the request, and a member who
 *  reads it knows to rewrite the script rather than wait for us to add the name.
 */
export const BUILTIN_REQUEST_DEPENDENT = Object.freeze({
  'barstate.islast':
    'which bar is the last one depends on how many bars were asked for, so this '
    + 'would answer differently for the same stock on the same day',
  'barstate.isfirst':
    'which bar is the first one depends on how far back the request reached, so '
    + 'this would answer differently for the same stock on the same day',
  'barstate.islastconfirmedhistory':
    'this names a bar relative to the end of the request, so it would answer '
    + 'differently for the same stock on the same day',
})

/** Pine CALLS that take arguments and are an EXACT expansion in this table's own
 *  vocabulary. The sibling of `BUILTIN_SERIES_TREE`, which holds the zero-argument
 *  ones.
 *
 *  ⛔ AN EXPANSION IS ONLY ADMISSIBLE WHEN IT IS AN IDENTITY — the same rule that
 *  governs `tr`. Both of these are arithmetic on arguments the member already
 *  wrote, so nothing is chosen here and no vocabulary is added: `roc` and `avg`
 *  cost the closed table exactly zero new names.
 *
 *  ⚰️ `cum` AND `barssince` WERE MEANT TO BE HERE AND ARE NOT. See
 *  `PINE_INEXPRESSIBLE` below — they cannot be written as identities in this
 *  engine, and a near-miss under the right name is the worst outcome available.
 */
/** Pine calls whose NAMESPACED spelling means something this table can express,
 *  but whose BARE spelling already resolves to a different (also correct) thing.
 *
 *  ⭐⭐ `ta.pivothigh` IS THE CASE THIS EXISTS FOR, AND IT IS AN EXACT IDENTITY.
 *  Pine returns a pivot AT ITS CONFIRMATION BAR — `rightbars` after the pivot —
 *  which is why published scripts draw it with `offset=-rightbars`. This table's
 *  `pivothigh(source, left, right)` emits ON THE PIVOT BAR and honestly declares
 *  the forward reach that implies. The two are the same column at different
 *  indices, so:
 *
 *      ta.pivothigh(src, L, R)   ≡   pivothigh(src, L, R)[R]
 *
 *  ⭐ AND THE OFFSET DOES NOT MERELY RE-INDEX IT — IT CANCELS THE LOOK-AHEAD.
 *  Stepping back exactly `R` bars nets the child's forward reach to zero, so the
 *  translated column is `non-repainting` where the bare call is
 *  `preview-repaints`. That is not a badge we award it; it is what the reach
 *  walk computes, and it is exactly WHY Pine publishes the value at the
 *  confirmation bar in the first place.
 *
 *  ⛔ KEYED ON THE FULL PINE NAME, and consulted only for that spelling. The
 *  bare `pivothigh(...)` still resolves to this table's own function, unshifted,
 *  because a member typing the bare name in OUR box means OUR vocabulary — the
 *  same rule `ta.barssince` established. */
const PINE_NAMESPACED_TREE = Object.freeze({
  'ta.pivothigh': (a) => pivotAtConfirmation('pivothigh', a),
  'ta.pivotlow': (a) => pivotAtConfirmation('pivotlow', a),
  // ⭐⭐ THE SIGN FLIP, AND IT IS A NODE THIS TABLE HAS HAD ALL ALONG. Pine's
  // `ta.highestbars` returns the offset as a NON-POSITIVE number (0 on this bar,
  // −1 one bar back); ours returns the POSITIVE distance. The two are negations
  // of each other, and `u-` is a declared operator — so:
  //
  //     ta.highestbars(src, n)   ≡   -highestbars(src, n)
  //
  // ⚰️ THE ENTRY THAT USED TO SIT IN `PINE_INEXPRESSIBLE` SAID, IN WRITING: "TO
  // UNBLOCK: cite the Pine reference page that pins the sign, then apply `-` at
  // this door." It was read for weeks — including once in this session — as
  // "a negation is not a shift and there is no node for it", which is simply
  // false: `u-` is one of the fifteen operators the manifest declares. An
  // actionable refusal is only worth what it costs to RE-READ it.
  'ta.highestbars': (a) => negatedBars('highestbars', a),
  'ta.lowestbars': (a) => negatedBars('lowestbars', a),
})

/** `-<bars-fn>(src, n)` — Pine's non-positive offset from our positive distance.
 *
 *  ⚠️ THE ONE-ARGUMENT FORM DEFAULTS TO THE FUNCTION'S OWN EXTREME, never to
 *  `close`: `ta.lowestbars(5)` measures to the LOW, and reading it off closes
 *  would answer a different question with the same shape. */
function negatedBars(name, args) {
  const two = args.length >= 2
  const src = two ? args[0] : { type: 'series', name: name === 'highestbars' ? 'high' : 'low' }
  const len = two ? args[1] : args[0]
  if (!len) return null
  return cOp('u-', [cCall(name, [src, len])])
}

/** `<pivot>(src, L, R)` shifted to its confirmation bar, or null if `R` is not a
 *  literal (the offset's bar count is a FIELD, so it must be known here). */
function pivotAtConfirmation(name, args) {
  // Pine allows `ta.pivothigh(leftbars, rightbars)` with the source defaulting to
  // `high`/`low`. ⚠️ THE DEFAULT IS THE FUNCTION'S OWN EXTREME, not `close`:
  // reading a pivot LOW off closes would answer a different question entirely.
  const three = args.length >= 3
  const src = three ? args[0] : { type: 'series', name: name === 'pivothigh' ? 'high' : 'low' }
  const left = three ? args[1] : args[0]
  const right = three ? args[2] : args[1]
  if (!right || right.type !== 'num' || !Number.isInteger(Number(right.value))
      || Number(right.value) < 0) {
    return null
  }
  const call = cCall(name, [src, left, right])
  return Number(right.value) === 0
    ? call
    : { type: 'offset', value: Number(right.value), args: [call] }
}

const BUILTIN_CALL_TREE = Object.freeze({
  // ta.roc(src, n) = 100 * (src - src[n]) / src[n]  — TradingView's own definition.
  //
  // ⛔ GROUPED LEFT, AS THE LINE ABOVE READS: `(100 * (src - src[n])) / src[n]`.
  // The other association computes the same number and hashes DIFFERENTLY, which
  // would mean a member who typed TradingView's formula by hand got a tree that
  // did not match the imported one — two definitions, two cache entries, and a
  // "why are these different?" nobody can answer from the read-back. Matching the
  // natural spelling is what makes astHash equality worth having.
  roc: (a) => {
    const prev = { type: 'offset', value: a[1].value, args: [a[0]] }
    return cOp('/', [cOp('*', [cNum(100), cOp('-', [a[0], prev])]), prev])
  },
  // ta.avg(a, b, ...) is the mean OF ITS ARGUMENTS, not a rolling window. ⛔ Not
  // `sma`: reading it as one would turn a two-series average into a 2-bar average
  // of the first, which parses, scans and is wrong on every bar.
  avg: (a) => cOp('/', [
    a.slice(1).reduce((acc, x) => cOp('+', [acc, x]), a[0]),
    cNum(a.length),
  ]),
  // ta.cross(a, b) = they crossed in EITHER direction on this bar. The table
  // already declares both directions, so this costs zero new vocabulary — the
  // same bar `roc` and `avg` clear.
  //
  // ⛔ NOT `crossOver` ALONE, which is the near-miss that makes this worth
  // writing down: it parses, lints, saves, scans, and silently answers half the
  // question. A member screening "the 9 crossed the 200" who is handed only the
  // upward cross loses every breakdown in the list and has no way to see it.
  //
  // ⚠️ The operands appear TWICE, which is affordable for the reason stated
  // above `PCF`'s derived logic: `seriesRefs` counts DISTINCT reads, so naming a
  // column twice is still one column.
  // ⭐ `iff(cond, a, b)` IS PINE v2/v3's TERNARY, and this table already declares
  // the operator it means. Pine v4 replaced it with `? :`, which this door has
  // always taken — so a v3 script was being refused for spelling a thing we
  // support. ⚠️ The arms are NOT evaluated eagerly by our ternary either, so the
  // rewrite preserves Pine's own short-circuit shape rather than only its value.
  iff: (a) => cOp('?:', [a[0], a[1], a[2]]),
  // ⭐⭐ `ta.linreg(src, n, offset)` — THE VALUE OF A LEAST-SQUARES LINE, and it
  // costs this table ZERO NEW VOCABULARY. Fitting `y = a + b·x` over the last `n`
  // bars collapses, exactly, to two calls the manifest already declares:
  //
  //     linreg = sum(src,n)/n + (n·wma(src,n) − sum(src,n)) · C
  //     C      = 6·((n−1)/2 − offset) / (n·(n−1))
  //
  // ⭐ THE DERIVATION, because a magic constant nobody can re-derive is a number
  // the next reader has to take on faith: a weighted mean whose newest bar carries
  // weight `n` IS the first moment of the window, so Σxy falls out of `wma` and Σy
  // out of `sum`. Everything else in the normal equations is a function of `n`
  // alone and folds. Verified against a direct least-squares fit over 600 random
  // windows (n ∈ 2…200, offset ∈ 0…5): max relative error 6.0e-14, i.e. float noise.
  //
  // ⚠️ AND THE WEIGHTING DIRECTION WAS MEASURED, NOT ASSUMED. The identity only
  // holds if `wma` weights the NEWEST bar heaviest; weighted the other way the
  // slope comes out negated and the line leans the wrong way on every chart. Run
  // on a 1…5 ramp, this engine's `wma(close,3)` answers 4.333 (newest-heaviest),
  // not 3.667. Spelling is not agreement.
  //
  // ⛔ `n < 2` HAS NO REGRESSION and the constant divides by `n−1`, so it falls
  // through to a refusal rather than returning Infinity dressed as a price.
  // ⭐⭐ `vwma` IS TRADINGVIEW'S OWN CLOSED FORM, NOT AN APPROXIMATION. Its docs
  // publish the equivalent verbatim:
  //     pine_vwma(source, length) => ta.sma(source * volume, length)
  //                                / ta.sma(volume, length)
  // Every piece of that is already declared here — `sma`, `*`, `/`, `volume` — so
  // this costs the manifest NOTHING. A table entry would have been the reflex and
  // it would have added a name to the sayable vocabulary, the picker, the
  // plain-language door and both interpreters, to express something the table can
  // already say.
  // ⛔ THE LENGTH MUST BE A WHOLE NUMBER, checked here rather than left to `sma`:
  // the expansion uses it TWICE, so a bad window would produce two refusals
  // pointing at a function the member never wrote.
  vwma: (a) => {
    const n = a[1] && a[1].type === 'num' ? Number(a[1].value) : NaN
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null
    const vol = { type: 'series', name: 'volume' }
    return cOp('/', [
      cCall('sma', [cOp('*', [a[0], vol]), cNum(n)]),
      cCall('sma', [vol, cNum(n)]),
    ])
  },
  linreg: (a) => {
    const n = a[1] && a[1].type === 'num' ? Number(a[1].value) : NaN
    const off = a[2] === undefined ? 0
      : (a[2] && a[2].type === 'num' ? Number(a[2].value) : NaN)
    if (!Number.isFinite(n) || !Number.isFinite(off) || !Number.isInteger(n) || n < 2) return null
    const total = cCall('sum', [a[0], cNum(n)])
    const weighted = cCall('wma', [a[0], cNum(n)])
    const C = (6 * ((n - 1) / 2 - off)) / (n * (n - 1))
    return cOp('+', [
      cOp('/', [total, cNum(n)]),
      cOp('*', [cOp('-', [cOp('*', [cNum(n), weighted]), total]), cNum(C)]),
    ])
  },
  cross: (a) => cOp('||', [
    cCall('crossOver', [a[0], a[1]]),
    cCall('crossUnder', [a[0], a[1]]),
  ]),
})

/** 🔴 PINE NAMES THIS ENGINE CANNOT EXPRESS, EACH WITH THE REASON.
 *
 *  ⛔ THESE ARE NOT "NOT BUILT YET". Each has an obvious near-miss that would
 *  parse, lint, save and scan — and be WRONG — which is exactly why they refuse by
 *  name instead of quietly resolving to the neighbour.
 *
 *  ⭐ MEASURED, NOT ASSUMED: `accum(0, self + 1, 10)` reads 10 at bar 20 AND at
 *  bar 49 over a 50-bar series. It is a RE-SEEDED WINDOW, not a running total.
 */
// ⚠️ EXPORTED FOR THE RAIL ONLY, like `PINE_CALL_SHAPES`. `pine.derived.test.js`
// intersects it with `TABLE.functions` to exercise every name this list and the
// closed table SHARE — nothing in the app imports it.
export const PINE_INEXPRESSIBLE = Object.freeze({
  cum: 'a running total from the first bar. This engine\'s only accumulator '
    + 're-seeds a fixed number of bars back, so `cum` would silently become a '
    + 'rolling sum — and a true cumulative would change value with how many bars '
    + 'the chart requested, which this engine forbids by construction. '
    + 'Use `sum(source, n)` when a fixed window is what you meant.',
  // ⛔⛔ THE SIGN. `ta.highestbars`/`ta.lowestbars` return a NON-POSITIVE offset —
  // 0 on the current bar, -1 one bar back — and this table's `highestbars`
  // returns the POSITIVE distance. Ours is the NEGATION, so a member who pastes
  // real Pine gets a column that is plausible on every bar and wrong on every
  // bar, with no refusal and nothing red. That is the single worst outcome this
  // translator exists to prevent.
  //
  // 🔴 AND WE HAVE ALREADY GOT THIS SIGN WRONG ONCE, IN WRITING: this repo's own
  // W2a.7 brief writes Aroon with the opposite sign from TradingView's published
  // version. A convention we have demonstrably mis-transcribed is not one to
  // apply silently at a translation boundary.
  //
  // ⭐ THE REFUSAL NAMES WHAT WOULD UNBLOCK IT, because *"unmappable"* is what let
  // a false refusal hide for a whole task elsewhere in this wave. Two countable
  // things, not a judgement call.
  // ⚰️ `highestbars` AND `lowestbars` LIVED HERE UNTIL 2026-08-27. Their entry
  // said: "TO UNBLOCK: cite the Pine reference page that pins the sign, then
  // apply `-` at this door." Pine returns the offset as a NON-POSITIVE number
  // (0 on this bar, −1 one bar back) where this table returns the POSITIVE
  // distance, so `ta.highestbars(src, n)` is `-highestbars(src, n)` — and `u-`
  // is one of the fifteen operators the manifest declares. The expansion lives
  // in `PINE_NAMESPACED_TREE`.
  //
  // ⛔⛔ THE ENTRY WAS READ FOR WEEKS AS "a negation is not a shift and there is
  // no node for it" — including once, out loud, in the session that then fixed
  // it. The text never said that; it named the unblocker in its last sentence.
  // An actionable refusal is only worth what it costs to RE-READ, and the cost
  // of not re-reading one is that it looks like a wall.
  barssince: 'the number of bars since a condition was last true, UNBOUNDED. '
    + 'This table declares `barssince(condition, n)`, and it is NOT the same '
    + 'function: ours saturates at a declared window and answers `n` for "not '
    + 'true within the last n bars", while Pine\'s counts back as far as the '
    + 'condition requires. Translating the one-argument form onto it would '
    + 'silently cap the count — a different number wearing the same name. '
    + 'Write `barssince(condition, n)` with the window you actually mean.',
})

/** Pine keywords that begin a construct with no single-expression form. */
const BLOCK_KEYWORDS = Object.freeze(new Set(['if', 'for', 'while', 'switch']))
const TYPE_KEYWORDS = Object.freeze(new Set(['type', 'method', 'enum']))
const STATE_KEYWORDS = Object.freeze(new Set(['var', 'varip']))

/** Pine type qualifiers and type names that may sit between `var` and the bound
 *  name, or in front of a plain declaration (`float x = 0.0`). */
const TYPE_WORDS = Object.freeze(new Set([
  'series', 'simple', 'const', 'input',
  'int', 'float', 'bool', 'string', 'color',
  'line', 'linefill', 'label', 'box', 'polyline', 'table', 'array', 'matrix', 'map',
]))

/** Calls whose whole job is to paint the chart.
 *
 *  ⚠️ NOTED AS IGNORED, NOT REFUSED. `visuals/overview` says drawings "do not
 *  have external uses like creating alerts or exporting data", so a `bgcolor()`
 *  line changes nothing a screen could read on TradingView either, and refusing a
 *  script over one would refuse most published indicators.
 *
 *  ⚰️⚰️ THE SENTENCE THAT USED TO SIT HERE WAS FALSE, AND IT WAS LOAD-BEARING.
 *  It read: "WHETHER `plotshape`/`hline`/`fill` YIELD A COLUMN ON TRADINGVIEW IS
 *  UNDOCUMENTED — its docs group them under 'plots' but the screener article names
 *  only the two." It is documented, and the article names SEVEN. TradingView's
 *  "Pine Screener: key features and requirements" states that to be used as a
 *  screening filter an indicator must output at least one of `plot()`,
 *  `plotbar()`, `plotcandle()`, `plotchar()`, `plotshape()`, `plotarrow()` or
 *  `hline()` — or an `alertcondition()`.
 *
 *  ⛔ A CLAIM THAT A THING IS UNDOCUMENTED IS STILL A CLAIM, and this one was
 *  doing real work: it is the entire justification for treating a whole family of
 *  calls as paint. `plotshape` and `plotchar` were already read as outputs, so the
 *  comment did not even describe the code beside it — and being written as an
 *  admission of ignorance is exactly what stopped anyone re-checking it
 *  (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
 *
 *  ⭐ WHAT REMAINS IN THIS SET IS NOW A MEASURED RESIDUE, not a default:
 *  `bgcolor`, `barcolor`, `fill` and `alert` are absent from TradingView's list
 *  and stay paint. `hline` is on the list but draws a CONSTANT, so it would arrive
 *  as a column that is the same number on every bar and every symbol — already
 *  `hidden` by `readsBars`, and worth nothing to a screen. `plotcandle`/`plotbar`
 *  are on the list and take FOUR series each; they wait for the multi-column
 *  output shape, and refuse honestly meanwhile. */
// ⚰️ `plotcandle` AND `plotbar` LEFT THIS SET — see `MULTI_OUTPUT_CALLS`. What
// kept them here was that each yields four columns and the output loop built one
// row per statement; the loop now takes a ROLE, so the statement expands.
const CHART_ONLY_CALLS = Object.freeze(new Set([
  'plotshape', 'plotchar',
  'bgcolor', 'barcolor', 'fill', 'hline', 'alert',
]))

// --------------------------------------------------------------------------- //
// the derived function index
// --------------------------------------------------------------------------- //

const normaliseName = (name) => String(name).toLowerCase().replace(/_/g, '')

const INDEX_CACHE = new WeakMap()

/** `normalised name → the table's own key`, built from `Object.keys` of the
 *  manifest's `functions` section at call time.
 *
 *  ⭐ THIS IS THE WHOLE MAPPING. A function added to `closedTable.json` while this
 *  file is untouched is callable from Pine the moment it lands, under any spelling
 *  that normalises to its key — which is what `ta.rsi` → `rsi` and
 *  `ta.crossover` → `crossOver` both are. */
function functionIndex(table) {
  const cached = INDEX_CACHE.get(table)
  if (cached) return cached
  const index = new Map()
  for (const key of Object.keys((table && table.functions) || {})) {
    // First declaration wins, and the keys are walked in the manifest's own
    // order, so a collision is decided by the manifest rather than by chance.
    const n = normaliseName(key)
    if (!index.has(n)) index.set(n, key)
  }
  INDEX_CACHE.set(table, index)
  return index
}

const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key)

// --------------------------------------------------------------------------- //
// the lexer
// --------------------------------------------------------------------------- //

/** ⚠️ LONGEST FIRST, AND THE ORDER IS LOAD-BEARING. `PUNCT.find(startsWith)`
 *  returns the first match, so `+` ahead of `+=` would lex a compound assignment
 *  as a plus and an equals — and a compound assignment read as a BINDING is the
 *  silent misread this module exists to prevent (`total += x` would inline the
 *  first value and drop every later one). */
const PUNCT = [
  '=>', ':=', '==', '!=', '>=', '<=',
  '+=', '-=', '*=', '/=', '%=',
  '?', ':', ',', '(', ')', '[', ']',
  '>', '<', '+', '-', '*', '/', '%', '=', '!',
]

/** Every spelling of "this name changes after it was bound". */
const MUTATORS = Object.freeze(new Set([':=', '+=', '-=', '*=', '/=', '%=']))

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

/**
 * Source → a flat token list, the per-line indent, and the `//@version=` a Pine
 * script declares.
 *
 * ⚠️ NEWLINES ARE NOT TOKENS; each token carries its own `line`, and statement
 * grouping is a separate pass. Pine's continuation rule is about INDENT and
 * BRACKET DEPTH, and both are cleaner to read off a positioned token list than
 * off a stream with separators in it.
 */
export function lexPine(src) {
  const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n')
  const tokens = []
  const lines = text.split('\n')
  const indents = lines.map((line) => {
    const m = /^[ \t]*/.exec(line)
    return m ? m[0].length : 0
  })
  let version = null
  let i = 0
  let line = 1
  let lineStart = 0

  const at = (index, ln, col, raw) => ({ line: ln, column: col, index, token: raw })

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { i += 1; line += 1; lineStart = i; continue }
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    const col = i - lineStart + 1

    // comments — and the version pragma, which is one
    if (ch === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      const comment = text.slice(i, end)
      const m = /^\/\/\s*@version\s*=\s*(\d+)/.exec(comment)
      if (m && version === null) version = Number(m[1])
      i = end
      continue
    }

    // colour literal — a value this grammar has no room for, lexed so the
    // refusal can point at it rather than at "an unexpected character".
    if (ch === '#') {
      let j = i + 1
      while (j < text.length && /[0-9A-Fa-f]/.test(text[j])) j += 1
      tokens.push({ kind: 'colour', value: text.slice(i, j), line, column: col, index: i })
      i = j
      continue
    }

    // string
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && j + 1 < text.length) { out += text[j + 1]; j += 2; continue }
        if (text[j] === '\n') break
        out += text[j]
        j += 1
      }
      if (j >= text.length || text[j] !== ch) {
        throw new PineRefusal('pine:character', REFUSALS['pine:character'],
          at(i, line, col, ch))
      }
      tokens.push({ kind: 'string', value: out, line, column: col, index: i })
      i = j + 1
      continue
    }

    // number
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || ''))) {
      let j = i
      while (j < text.length && DIGIT.test(text[j])) j += 1
      if (text[j] === '.') { j += 1; while (j < text.length && DIGIT.test(text[j])) j += 1 }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1
        if (text[k] === '+' || text[k] === '-') k += 1
        if (DIGIT.test(text[k] || '')) { k += 1; while (k < text.length && DIGIT.test(text[k])) k += 1; j = k }
      }
      const raw = text.slice(i, j)
      tokens.push({ kind: 'number', value: Number(raw), raw, line, column: col, index: i })
      i = j
      continue
    }

    // identifier, possibly dotted (`ta.sma`, `input.int`, `strategy.entry`)
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < text.length && IDENT_PART.test(text[j])) j += 1
      while (text[j] === '.' && IDENT_START.test(text[j + 1] || '')) {
        j += 1
        while (j < text.length && IDENT_PART.test(text[j])) j += 1
      }
      tokens.push({ kind: 'ident', value: text.slice(i, j), line, column: col, index: i })
      i = j
      continue
    }

    // punctuation
    const punct = PUNCT.find((p) => text.startsWith(p, i))
    if (punct) {
      tokens.push({ kind: 'punct', value: punct, line, column: col, index: i })
      i += punct.length
      continue
    }

    throw new PineRefusal('pine:character', REFUSALS['pine:character'], at(i, line, col, ch))
  }

  return { tokens, indents, version, lines }
}

// --------------------------------------------------------------------------- //
// statements
// --------------------------------------------------------------------------- //

/** ⭐ THE FIVE WORDS THAT OPEN AN INDENTED BLOCK, AND NOTHING ELSE DOES.
 *
 *  This set is what makes the splitter below deterministic instead of heuristic.
 *  A deeper-indented line in Pine is EITHER the body of a block OR a
 *  continuation of the expression above it, and the two are told apart by one
 *  question: did the line above open a block? Pine's answer is a closed list —
 *  these five words and the `=>` of a function definition. Guessing instead
 *  ("does the previous line end in an operator?") is the shape that reads
 *  `maColour = not colourMA ? teal :` / `     risingMA ? green :` as a block. */
const BLOCK_OPENERS = Object.freeze(new Set(['if', 'else', 'for', 'while', 'switch']))

/**
 * Tokens → a TREE of statements: `{header, body, sub}` at every level.
 *
 * ⭐⭐ THIS REPLACED A FLATTENER, AND THAT IS THE WHOLE VARIABLES FEATURE'S
 * FOUNDATION. The previous rule glued every indented line onto the statement
 * above it, so `if cond` / `    x := 1` was ONE opaque statement and the only
 * honest thing to do with it was refuse. Reading the body as its own statement
 * list is what lets a conditional reassignment become a ternary.
 *
 * A statement at this level starts on a line whose indent is `indent`, at
 * bracket depth 0. It continues onto a deeper-indented line while it is inside
 * brackets, or while it has not yet opened a block. Once it HAS opened a block
 * (a `BLOCK_OPENERS` word or a `=>` seen at depth 0), the next deeper line is
 * the body, and the body runs until the indent comes back to `indent` or less.
 *
 * ⚠️ `else` IS A SEPARATE STATEMENT AT THE SAME INDENT, not part of the `if`.
 * Pine writes it that way and so does this; `ifBranches` re-joins them.
 */
function blockStatements(toks, indents, indent) {
  const out = []
  let i = 0
  while (i < toks.length) {
    const header = []
    let depth = 0
    let opened = false
    while (i < toks.length) {
      const tok = toks[i]
      const ln = indents[tok.line - 1] || 0
      const firstOnLine = header.length > 0 && tok.line !== header[header.length - 1].line
      if (firstOnLine && depth === 0 && (ln <= indent || opened)) break
      header.push(tok)
      if (tok.kind === 'punct') {
        if (tok.value === '(' || tok.value === '[') depth += 1
        else if (tok.value === ')' || tok.value === ']') depth = Math.max(0, depth - 1)
      }
      if (depth === 0
        && ((tok.kind === 'ident' && BLOCK_OPENERS.has(tok.value)) || isPunct(tok, '=>'))) {
        // ⚠️ THE FLAG TAKES EFFECT AT THE NEXT LINE BOUNDARY, which is exactly
        // when an `if`'s condition has finished — a condition on the same line is
        // already in the header, and one wrapped over lines is inside brackets.
        opened = true
      }
      i += 1
    }
    const body = []
    let bodyIndent = null
    while (i < toks.length) {
      const tok = toks[i]
      const ln = indents[tok.line - 1] || 0
      if (ln <= indent) break
      if (bodyIndent === null) bodyIndent = ln
      body.push(tok)
      i += 1
    }
    if (header.length === 0) break

    // ⭐ `fastLength = input(12), slowLength = input(26)` — SEVERAL BINDINGS ON
    // ONE LINE, a v2/v3 idiom, and the whole of what held `19-cm-macd-ult-mtf`
    // once its timeframe cleared. The refusal it produced named the SECOND name
    // on the line rather than the comma that stopped it, which is why it read as
    // an unparseable expression rather than a missing statement shape.
    //
    // ⛔ NARROW ON PURPOSE, because a comma means several things in Pine and
    // this is one of them. A line with a BLOCK beneath it never splits — the
    // body belongs to the line as a whole and there is no honest answer to which
    // segment owns it. And EVERY segment must carry its own top-level `=`, all or
    // nothing: a partial split would bind one name and silently drop whatever the
    // member wrote after the comma, which is a script that translates while
    // missing an output it declared. A comma inside a call is at bracket depth
    // and was never a candidate — `splitTopLevel` is the same depth rule
    // `findTop` uses, so there is one definition of "top level" here.
    const parts = body.length === 0 ? splitTopLevel(header, ',') : [header]
    if (parts.length > 1 && parts.every(isBindingSegment)) {
      for (const part of parts) out.push({ header: part, body: [], sub: [] })
      continue
    }
    // ⚰️ A REFUSAL HERE FOR AN UNSPLITTABLE TOP-LEVEL COMMA WAS WRITTEN AND
    // REMOVED THE SAME HOUR. The argument for it was real — `a = 1, plot(close)`
    // binds the whole line, the `plot` is never collected, and the script refuses
    // with "offers no plot" while a plot sits on the line the member is reading.
    // ⛔ BUT THE OWNER CORPUS ANSWERED IT: `screener(tid_001), screener(tid_002),
    // …` is a legitimate several-calls-on-one-line idiom, and refusing every
    // comma we cannot split refuses that too. A better-worded refusal is not worth
    // a refusal where none belongs, so a line that does not split is left EXACTLY
    // as it was. Fixing the misleading sentence needs a reader that knows which
    // segments are outputs — a different job from splitting bindings.

    out.push({
      header,
      body,
      sub: body.length ? blockStatements(body, indents, bodyIndent) : [],
    })
  }
  return out
}

const isPunct = (tok, value) => !!tok && tok.kind === 'punct' && tok.value === value

/** Is this token run `… name = expression`, i.e. one binding?
 *
 *  ⚠️ The left side is required to be BARE NAMES so that `float a = 1` counts
 *  and `f(x) = 1` does not. `==`, `:=` and `>=` lex as single tokens of their own,
 *  so matching a bare `=` cannot pick up a comparison. */
function isBindingSegment(toks) {
  const eq = findTop(toks, (t) => isPunct(t, '='))
  if (eq <= 0 || eq >= toks.length - 1) return false

  // ⭐ A TUPLE DESTRUCTURE IS A BINDING TOO — `[tid, out] = feed(sym)`, and the
  // owner corpus writes SEVERAL of them comma-separated on one line. Requiring
  // bare names on the left rejected it, and the refusal that produced was worse
  // than the one it replaced: a script that used to refuse late, having offered
  // ten translated outputs, refused at the comma with none. Caught by the owner
  // corpus snapshot, which pins outputs as well as guard — a gate gate on the
  // guard alone would have called that regression green.
  if (isPunct(toks[0], '[')) {
    const close = toks.findIndex((t) => isPunct(t, ']'))
    if (close < 1 || close !== eq - 1) return false
    for (let i = 1; i < close; i += 1) {
      const t = toks[i]
      if (t.kind !== 'ident' && !isPunct(t, ',')) return false
    }
    return true
  }

  for (let i = 0; i < eq; i += 1) if (toks[i].kind !== 'ident') return false
  return true
}

/** The index of the first token at bracket depth 0 matching `pred`, or -1. */
/** One token run split on a top-level separator — the depth rule `findTop` uses.
 *  ⛔ Depth-aware on purpose: `[f(a, b), c]` is TWO parts, and a naive comma
 *  split would make it three and hand a fragment to the parser. */
function splitTopLevel(toks, sep) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind === 'punct') {
      if (tok.value === '(' || tok.value === '[') { depth += 1; continue }
      if (tok.value === ')' || tok.value === ']') { depth -= 1; continue }
      if (depth === 0 && tok.value === sep) { out.push(toks.slice(start, i)); start = i + 1 }
    }
  }
  out.push(toks.slice(start))
  return out
}

/** One token run split on a top-level separator — the depth rule `findTop` uses.
 *  ⛔ Depth-aware on purpose: `[f(a, b), c]` is TWO parts, and a naive comma
 *  split would make it three and hand a fragment to the parser. */
/** The index of the bracket closing the one at `open`, or -1.
 *
 *  ⛔ NOT `findTop`. That walker `continue`s on every bracket, so its predicate
 *  is never offered one — asking it for a `]` always answers -1, which is
 *  exactly how the first cut of tuple support silently did nothing at all. */
function matchBracket(toks, open) {
  let depth = 0
  for (let i = open; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind !== 'punct') continue
    if (tok.value === '(' || tok.value === '[') depth += 1
    else if (tok.value === ')' || tok.value === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** The `=` after a destructure's `]`, or -1. */
function eqAtDmi(toks, close) {
  const rel = findTop(toks.slice(close + 1), (t) => isPunct(t, '='))
  return rel < 0 ? -1 : close + 1 + rel
}

/** `[a, b, c] = ta.dmi(diLen, adxLen)` → three bindings, or `null`.
 *
 *  ⛔ NOTHING IS INVENTED HERE. Each part is an ordinary Pine call node naming a
 *  function the MANIFEST declares (`plusDI`/`minusDI`/`adx`), handed to the same
 *  resolver every other call goes through — so the arity, the argument roles and
 *  the lookback all come from the table rather than from this function. */
function dmiParts(toks, close, names, env, first) {
  if (names.length !== 3) return null
  const eq = eqAtDmi(toks, close)
  let call = null
  try { call = parseWholeExpression(toks.slice(eq + 1)) } catch { return null }
  // `ta.dmi` and a bare `dmi` are the same call; `normaliseName` lowercases and
  // drops underscores but keeps the namespace, so the segment is taken here.
  const bare = normaliseName(String(call.name).split('.').pop())
  if (!call || call.type !== 'call' || bare !== 'dmi') return null
  const args = (call.args || []).map((a) => a.value)
  if (args.length !== 2) return null
  const at = locate(first)
  // Each leg is an ordinary Pine call whose ROLE ORDER is declared in
  // `PINE_CALL_SHAPES`, so the three series come from the table's own statement
  // of them rather than from this function. (Filling them here refused at
  // `pine:role-order`, correctly.)
  // ⛔ THE TWO PERIODS ARE COMPARED AT RESOLVE TIME, NOT HERE. At fold time a
  // name is not a value, so the first cut compared the two argument nodes by
  // SPELLING — which refused `ta.dmi(diLen, adxSmooth)` even when both inputs
  // hold 14, and that is exactly the call the corpus's ADX script makes.
  // Deferring it is the same shape `switch` and a tuple part already use.
  const leg = (pineName) => ({
    kind: 'dmiLeg', pineName, a: args[0], b: args[1], env: new Map(env), at,
  })
  return [leg('dmiplusleg'), leg('dmiminusleg'), leg('dmiadxleg')]
}

/** Does this UNRESOLVED right-hand side read `name`'s own previous bar?
 *
 *  ⚠️ THE PARSED TREE, NOT THE CANONICAL ONE — this runs before resolution, which
 *  is the only moment the decision can be made: resolution is what turns
 *  `name[1]` into `self`, and it has to know it is inside a recurrence first.
 *  ⛔ An offset node is identified STRUCTURALLY (it owns an `n` and an `arg`)
 *  rather than by a type string, so a unary `-name` — which also carries `arg` —
 *  cannot be mistaken for a bar read. */
function readsOwnPrevious(node, name) {
  let found = false
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return
    if (Object.prototype.hasOwnProperty.call(n, 'n')
        && n.arg && n.arg.type === 'name' && n.arg.name === name) {
      found = true
      return
    }
    for (const key of Object.keys(n)) {
      const v = n[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(node)
  return found
}

/** A resolved `na(self) ? SEED : UPDATE` → `{seed, update}`, or null.
 *
 *  ⭐⭐ EXPORTED FOR `thinkscript.js`, and it is language-neutral BY CONSTRUCTION:
 *  it reads canonical nodes and `table.functions.accum.recurrence.binds`, and
 *  nothing Pine-shaped. Both dialects spell the seeded self-reference the same
 *  way once translated — Pine's `na(x[1]) ? … : …` and thinkScript's
 *  `if IsNaN(x[1]) then … else …` are the same tree — so asking it twice from two
 *  copies is how two translators come to disagree about one engine function. It
 *  lives here only because Pine needed it first, exactly as `forgetsItsSeed` does.
 *
 *  ⛔ THE SEED MUST NOT ITSELF READ `self`. A first-bar value defined in terms of
 *  the value it is seeding is not a seed, and the accumulator would carry that
 *  hole forward on every re-seed — so that shape falls through to the refusal
 *  rather than building something that computes and means nothing.
 *  ⛔ AND THE UPDATE ARM MUST READ `self`. `na(x[1]) ? a : b` with a self-free
 *  `b` is a first-bar test, not a recurrence; folding it into an accumulator
 *  would answer with `b` forever and quietly lose the first bar. */
export { containsFreeSelfSeries }

export function seedAndUpdateOf(body, table) {
  if (!body || body.type !== 'op' || body.name !== '?:') return null
  const args = body.args || []
  if (args.length !== 3) return null
  const [test, seed, update] = args
  if (!test || test.type !== 'call' || test.name !== 'na') return null
  if (!containsFreeSelfSeries(test, table)) return null
  if (containsFreeSelfSeries(seed, table)) return null
  if (!containsFreeSelfSeries(update, table)) return null
  return { seed, update }
}

/** Does this tree read a `self` that NOTHING HAS BOUND?
 *
 *  ⛔⛔ `containsSelfSeries` CANNOT ANSWER THIS AND THE DIFFERENCE IS A WRONG
 *  COLUMN, not a refusal. An accumulator's body slot BINDS `self`, so a tree that
 *  merely mentions another recurrence — `x = na(x[1]) ? 0 : someOtherAccumulator`
 *  — reads no `self` of its own. Asking the undistinguishing question there
 *  builds `accum(0, accum(…), 250)` whose outer body never mentions its own
 *  state: a running value that does not run, drawn without complaint.
 *  ⭐ THE BOUND SLOT IS READ OFF THE MANIFEST'S OWN `recurrence`, per call, so a
 *  second recurrence function added to the table is handled the day it lands and
 *  this file never types `accum`.
 *  ⚠️ `forgetsItsSeed` DELIBERATELY STILL ASKS THE OTHER ONE. A nested
 *  accumulator inside an update makes it answer NO, which over-refuses rather
 *  than over-accepts — and its whole contract is that an unrecognised shape
 *  answers NO. Changing it there is a separate decision with its own measurement. */
function containsFreeSelfSeries(node, table) {
  const spec = table && table.functions && table.functions.accum
  if (!spec || !spec.recurrence) return false
  const bind = spec.recurrence.binds
  const walk = (n) => {
    if (!n || typeof n !== 'object') return false
    if (n.type === 'series' && n.name === bind) return true
    const args = n.args || []
    const inner = n.type === 'call' && table.functions[n.name]
      && table.functions[n.name].recurrence
    if (inner) return args.some((a, i) => i !== inner.body && walk(a))
    return args.some(walk)
  }
  return walk(node)
}

function containsSelfSeries(node, table) {
  const spec = table.functions.accum
  if (!spec) return false
  const bind = spec.recurrence.binds
  const walk = (n) => {
    if (!n || typeof n !== 'object') return false
    if (n.type === 'series' && n.name === bind) return true
    return (n.args || []).some(walk)
  }
  return walk(node)
}

/** ⭐⭐ DOES THIS UPDATE FORGET ITS SEED? `accum` RE-SEEDS a fixed number of bars
 *  back — deliberately, so a column cannot depend on where a fetch happened to
 *  start — and that is sound ONLY for an update that forgets where it began.
 *
 *  `min`/`max` against a self-free operand forget once that operand dominates; a
 *  ternary arm that holds or passes through forgets; `nz` passes through.
 *  `self + x` NEVER forgets.
 *
 *  ⭐ EXPORTED FOR `thinkscript.js` (W3.5 hand-back, one word). This is a rule
 *  about the ENGINE's `accum`, not about Pine — it reads
 *  `table.functions.accum.recurrence.binds` and nothing Pine-shaped — and it
 *  lives here only because Pine needed it first. thinkScript's `CompoundValue`
 *  is the same accumulator reached from another language, so it asks the same
 *  question, and it must never ask a SECOND copy of it: two convergence rules is
 *  how two translators come to disagree about one engine function.
 *
 *  🔴 `x := x[1] + volume` is OBV by hand, and folding it would turn a running
 *  total into a ROLLING SUM — a plausible column that is not the indicator
 *  anybody wrote. That is the same fact `cum` refuses for, reached from the other
 *  side, so the two rules finally agree.
 *
 *  ⭐⭐ A LINEAR CONTRACTION FORGETS TOO, AND IT IS THE COMMONEST SMOOTHER THERE
 *  IS. `(self + close) / 2`, `(self * 13 + close) / 14` (Wilder), `self * 0.9 +
 *  close * 0.1` (an EMA by hand) and the classic Heikin-Ashi open are all
 *  `a * self + <self-free>` with `|a| < 1`, so the seed's influence decays
 *  GEOMETRICALLY. Every one of them answered NO before, which meant this engine
 *  refused the single most common stateful shape published in Pine while holding
 *  the node that computes it.
 *
 *  ⛔ `|a| < 1` IS NOT THE TEST, AND SAYING WHY IS THE POINT. `accum` re-seeds a
 *  FIXED number of bars back, so "forgets eventually" is not the question —
 *  "forgets within `warmup` bars" is. At `a = 0.999` the seed still carries 78%
 *  of its weight after 250 bars, which is a rolling window wearing a smoother's
 *  clothes. So the test is the RESIDUAL ITSELF: `|a| ** warmup` must sit at or
 *  under one part in a million, three orders of magnitude below a penny on a
 *  hundred-dollar stock. That is why `warmup` is a REQUIRED argument — the number
 *  belongs to the caller's accumulator, and defaulting it here would put a second
 *  authority on the one constant this answer depends on.
 *
 *  ⚠️ A TERNARY'S CONDITION MAY TEST `self` FREELY — it picks a branch without
 *  carrying the value forward. Only the ARMS must forget.
 *  ⛔ Conservative by construction: an unrecognised shape answers NO. A wrong yes
 *  is invisible in the output; a wrong no is a named refusal somebody can read. */
export const SEED_RESIDUAL_TOLERANCE = 1e-6

export function forgetsItsSeed(node, table, warmup) {
  const spec = table.functions.accum
  if (!spec) return false
  if (!Number.isFinite(warmup) || warmup < 1) return false
  const bind = spec.recurrence.binds
  const isSelf = (n) => !!n && n.type === 'series' && n.name === bind
  const carries = (n) => containsSelfSeries(n, table)

  /** The coefficient `a` in `a * self + <self-free>`, or null when this shape is
   *  not linear in `self` — which includes `self * self`, `self[1]` (an offset is
   *  a SECOND state variable, not a multiple of this one) and anything divided by
   *  a term that carries `self`. Null means "unknown", and unknown answers NO. */
  const coefficient = (n) => {
    if (!n || typeof n !== 'object') return null
    if (isSelf(n)) return 1
    if (!carries(n)) return 0
    const args = n.args || []
    if (n.type === 'op' && n.name === 'u-' && args.length === 1) {
      const a = coefficient(args[0])
      return a === null ? null : -a
    }
    if (n.type === 'op' && (n.name === '+' || n.name === '-') && args.length === 2) {
      const a = coefficient(args[0])
      const b = coefficient(args[1])
      if (a === null || b === null) return null
      return n.name === '+' ? a + b : a - b
    }
    if (n.type === 'op' && n.name === '*' && args.length === 2) {
      if (carries(args[0]) && carries(args[1])) return null
      const carrier = carries(args[0]) ? args[0] : args[1]
      const scale = carries(args[0]) ? args[1] : args[0]
      const k = constantValueOf(scale)
      const a = coefficient(carrier)
      if (a === null || typeof k !== 'number' || !Number.isFinite(k)) return null
      return a * k
    }
    if (n.type === 'op' && n.name === '/' && args.length === 2) {
      if (carries(args[1])) return null
      const k = constantValueOf(args[1])
      const a = coefficient(args[0])
      if (a === null || typeof k !== 'number' || !Number.isFinite(k) || k === 0) return null
      return a / k
    }
    return null
  }

  const contracts = (n) => {
    const a = coefficient(n)
    if (a === null || !Number.isFinite(a)) return false
    return Math.abs(a) ** warmup <= SEED_RESIDUAL_TOLERANCE
  }

  const ok = (n) => {
    if (!n || typeof n !== 'object') return true
    if (isSelf(n)) return true
    if (!carries(n)) return true
    const args = n.args || []
    if (n.type === 'call' && (n.name === 'min' || n.name === 'max')) {
      const withSelf = args.filter(carries)
      return withSelf.length === 1 && ok(withSelf[0])
    }
    if (n.type === 'call' && n.name === 'nz') return args.every(ok)
    if (n.type === 'op' && n.name === '?:') return ok(args[1]) && ok(args[2])
    return contracts(n)
  }
  return ok(node)
}

function findTop(toks, pred) {
  let depth = 0
  for (let i = 0; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind === 'punct') {
      if (tok.value === '(' || tok.value === '[') { depth += 1; continue }
      if (tok.value === ')' || tok.value === ']') { depth -= 1; continue }
    }
    if (depth === 0 && pred(tok)) return i
  }
  return -1
}

// --------------------------------------------------------------------------- //
// the Pine expression parser
// --------------------------------------------------------------------------- //
//
// Precedence-climbing over one statement's tokens. It builds a PINE tree (not a
// canonical one) so that resolution can happen later, from the outputs backwards.

const PINE_BINARY = Object.freeze({
  or: 1, and: 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
})

class Cursor {
  constructor(toks) { this.toks = toks; this.i = 0 }

  peek(k = 0) { return this.toks[this.i + k] || null }

  next() { const t = this.toks[this.i]; this.i += 1; return t }

  eat(value) {
    const t = this.peek()
    if (isPunct(t, value)) { this.i += 1; return t }
    return null
  }

  expect(value) {
    const t = this.eat(value)
    if (!t) {
      const bad = this.peek() || this.toks[this.toks.length - 1]
      throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(bad))
    }
    return t
  }
}

const locate = (tok) => (tok
  ? { line: tok.line, column: tok.column, index: tok.index, token: String(tok.raw ?? tok.value) }
  : null)

function parseExpression(cur, minBp = 0) {
  let left = parseUnary(cur)
  for (;;) {
    const tok = cur.peek()
    if (!tok) break
    let op = null
    if (tok.kind === 'punct' && own(PINE_BINARY, tok.value)) op = tok.value
    else if (tok.kind === 'ident' && (tok.value === 'and' || tok.value === 'or')) op = tok.value
    if (op === null) break
    const bp = PINE_BINARY[op]
    if (bp < minBp) break
    cur.next()
    const right = parseExpression(cur, bp + 1)
    left = { type: 'binary', op, left, right, tok }
  }
  // the ternary binds loosest and is right-associative
  if (minBp <= 0 && isPunct(cur.peek(), '?')) {
    const tok = cur.next()
    const yes = parseExpression(cur, 0)
    cur.expect(':')
    const no = parseExpression(cur, 0)
    return { type: 'ternary', test: left, yes, no, tok }
  }
  return left
}

function parseUnary(cur) {
  const tok = cur.peek()
  if (isPunct(tok, '-')) { cur.next(); return { type: 'unary', op: '-', arg: parseUnary(cur), tok } }
  if (isPunct(tok, '+')) { cur.next(); return parseUnary(cur) }
  if (isPunct(tok, '!')) {
    // ⚠️ PINE HAS NO `!`, `&&` OR `||` — the operators page lists `not`, `and`,
    // `or` and nothing else. Somebody typing `!` has written JavaScript, and
    // saying so is more use than "unexpected character".
    throw new PineRefusal('pine:operator',
      `${REFUSALS['pine:operator']} — \`!\`. Pine spells negation \`not\``, locate(tok))
  }
  if (tok && tok.kind === 'ident' && tok.value === 'not') {
    cur.next()
    return { type: 'unary', op: 'not', arg: parseUnary(cur), tok }
  }
  return parsePostfix(cur)
}

function parsePostfix(cur) {
  let node = parsePrimary(cur)
  for (;;) {
    const tok = cur.peek()
    if (isPunct(tok, '[')) {
      // ⭐ PINE'S HISTORY-REFERENCING OPERATOR, READ IN FULL AND CONSTRAINED HERE.
      // The constraints are the engine's, not this parser's taste, and they are
      // the ones that keep `maxLookback(ast)` a TREE SUM and a forward reference
      // INEXPRESSIBLE: the index must be a whole-number literal, and it must not
      // be negative. A variable index would make the window depend on a knob and
      // the repaint linter could not bound it; a negative one is `close[-1]`,
      // which is next bar.
      cur.next()
      const idx = parseOffsetIndex(cur, tok)
      cur.expect(']')
      // ⛔ ONE APPLICATION PER VALUE, exactly as Pine itself rules: `close[1][2]`
      // is an error there, and letting it through here would compose two windows
      // this module then has to reason about.
      if (isPunct(cur.peek(), '[')) {
        throw new PineRefusal('pine:offset-literal',
          `${REFUSALS['pine:offset-literal']} — and Pine allows only one \`[…]\` per value`,
          locate(cur.peek()))
      }
      node = { type: 'offset', arg: node, n: idx, tok }
      continue
    }
    if (isPunct(tok, '(')) {
      // `f(x)(y)` and `arr.get(i)(j)` — a call of a call has no bare name.
      throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
    }
    break
  }
  return node
}

/** The `n` in `close[n]`, or a refusal naming which rule it broke.
 *
 *  ⛔ TWO SEPARATE GUARDS, BECAUSE THEY ARE TWO SEPARATE MISTAKES. A variable
 *  index (`close[len]`) is a window the repaint linter cannot bound; a negative
 *  index (`close[-1]`) is a bar that has not happened. Reporting both as "bad
 *  offset" would hide from a member which one they made. */
function parseOffsetIndex(cur, openTok) {
  const negative = isPunct(cur.peek(), '-')
  if (negative) cur.next()
  const tok = cur.peek()
  if (!tok || tok.kind !== 'number' || !Number.isInteger(tok.value)) {
    // ⭐⭐ AN INPUT IS ALREADY A CONSTANT EVERYWHERE ELSE, AND THIS WAS THE ONE
    // PLACE IT WAS NOT. `ta.sma(close, n)` with `n = input.int(10)` folds to
    // `sma(close, 10)` — the window arm RESOLVES its argument and then requires a
    // `num`. This arm demanded a numeric TOKEN, so the very same folded 10 was a
    // legal length and an illegal offset.
    //
    // ⚠️ OWNER DECISION, 2026-08-11: THE STORED TREE IS AUTHORITATIVE. Folding an
    // input therefore freezes its default into the saved definition — and that is
    // ALREADY true of every length, so folding the offset makes the two agree
    // rather than introducing a new surprise. A member's knob is frozen for both
    // or for neither; it was frozen for one.
    //
    // ⛔ THE CANONICAL GUARANTEE IS UNTOUCHED. What is deferred is WHEN the number
    // is known, never whether: the expression resolves before an offset node is
    // built, and anything that is not a non-negative whole number refuses exactly
    // as it did. `parse.js` still gives an offset no slot for an expression, so
    // "the offset is a literal" stays true by construction of the emitted node.
    if (tok && !isPunct(tok, ']')) {
      const expr = parseExpression(cur, 0)
      if (!isPunct(cur.peek(), ']')) {
        throw new PineRefusal('pine:offset-literal', REFUSALS['pine:offset-literal'],
          locate(cur.peek() || tok))
      }
      return { expr, tok }
    }
    throw new PineRefusal('pine:offset-literal', REFUSALS['pine:offset-literal'],
      locate(tok || openTok))
  }
  cur.next()
  // ⚠️ THE `]` IS CHECKED HERE RATHER THAN BY THE CALLER, so `close[1 + 1]`
  // reports the OFFSET rule it broke instead of "this line is not a shape the
  // translator reads" — the literal is the first token of a computed index, and a
  // guard that only looks at the first token names the wrong mistake.
  if (!isPunct(cur.peek(), ']')) {
    throw new PineRefusal('pine:offset-literal', REFUSALS['pine:offset-literal'],
      locate(cur.peek() || tok))
  }
  if (negative) {
    throw new PineRefusal('pine:offset-negative',
      `${REFUSALS['pine:offset-negative']} — \`[-${tok.value}]\``, locate(tok))
  }
  return tok.value
}

function parsePrimary(cur) {
  const tok = cur.next()
  if (!tok) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], null)

  if (tok.kind === 'number') return { type: 'number', value: tok.value, tok }
  if (tok.kind === 'string') return { type: 'string', value: tok.value, tok }
  if (tok.kind === 'colour') return { type: 'colour', value: tok.value, tok }

  if (isPunct(tok, '(')) {
    const inner = parseExpression(cur, 0)
    cur.expect(')')
    return inner
  }

  if (isPunct(tok, '[')) {
    // A `[…]` where a VALUE was expected is a Pine tuple or an array/options
    // literal (`options = ['A', 'B']`). Naming it "a line this translator does
    // not read" would send a member looking for a typo.
    //
    // ⭐⭐ IT IS A NODE, NOT A THROW, AND THAT IS THE MODULE'S OWN RULE APPLIED
    // WHERE IT WAS NOT. Resolution runs backwards from the outputs precisely so
    // that a construct nothing reads is a NOTE; throwing here made the one
    // collection literal every published script carries — `input(…, options=["A",
    // "B"])`, an argument this translator never even looks at — refuse the whole
    // script from a line no column depends on. Now it refuses only if something
    // actually reads it, at `resolve`, with the same guard and the same token.
    let depth = 1
    while (depth > 0) {
      const t = cur.next()
      if (!t) throw new PineRefusal('pine:collection', REFUSALS['pine:collection'], locate(tok))
      if (isPunct(t, '[') || isPunct(t, '(')) depth += 1
      else if (isPunct(t, ']') || isPunct(t, ')')) depth -= 1
    }
    return { type: 'collection', tok }
  }

  if (tok.kind === 'ident') {
    if (tok.value === 'true') return { type: 'number', value: 1, tok }
    if (tok.value === 'false') return { type: 'number', value: 0, tok }
    if (BLOCK_KEYWORDS.has(tok.value)) {
      throw new PineRefusal('pine:block', REFUSALS['pine:block'], locate(tok))
    }
    if (isPunct(cur.peek(), '(')) {
      cur.next()
      const args = parseArguments(cur)
      return { type: 'call', name: tok.value, args, tok }
    }
    return { type: 'name', name: tok.value, tok }
  }

  throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
}

/** `(a, b, title=c)` — positional and named, in Pine's own order. */
function parseArguments(cur) {
  const args = []
  if (cur.eat(')')) return args
  for (;;) {
    let name = null
    const first = cur.peek()
    const second = cur.peek(1)
    if (first && first.kind === 'ident' && isPunct(second, '=')) {
      name = first.value
      cur.next(); cur.next()
    }
    const value = parseExpression(cur, 0)
    args.push({ name, value, tok: first })
    if (cur.eat(',')) continue
    cur.expect(')')
    break
  }
  return args
}

/** One statement's tokens → one Pine expression, with nothing left over. */
function parseWholeExpression(toks) {
  const cur = new Cursor(toks)
  const node = parseExpression(cur, 0)
  const rest = cur.peek()
  if (rest) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(rest))
  return node
}

// --------------------------------------------------------------------------- //
// canonical nodes and the printer
// --------------------------------------------------------------------------- //

const cNum = (value) => (value < 0
  // ⚠️ A NEGATIVE LITERAL IS `u-` APPLIED TO A POSITIVE ONE, because that is what
  // jsep produces when it reads the text this module prints. Emitting a `num`
  // with a negative value would print text that re-parses to a DIFFERENT tree and
  // the round-trip check would refuse a formula that is perfectly fine.
  ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] }
  : { type: 'num', value })
const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
const cCall = (name, args) => ({ type: 'call', name, args })

/** ⭐⭐ A TRANSLATE-TIME FOLD IS A COMPUTE BUDGET, NOT JUST A DEPTH LIMIT.
 *  A member can paste `1 + 1 + … ` ten thousand times and every term of it IS a
 *  constant, so a fold with no ceiling would happily walk the whole thing on the
 *  request path. Counting NODES bounds breadth and depth with one number. */
export const MAX_FOLD_NODES = 256

/** The four operators this fold applies, and NOTHING ELSE.
 *
 *  ⛔ DELIBERATELY NOT THE COMPARISONS OR THE LOGICALS. `interpret.js` wraps
 *  those in `cmp` and `logical`, which encode two rulings this file must not
 *  restate — a comparison against NaN is 0, and a logical over NaN is NaN. Plain
 *  `+ - * /` on two finite numbers has no such ruling to get wrong, and `R1` in
 *  `pine.window.test.js` asserts every one of these against the interpreter
 *  evaluating the same tree, so even this much cannot drift unnoticed.
 *
 *  ⚠️ A WINDOW SLOT IS THE ONLY CALLER, and a window is a number of bars — a
 *  folded `close > open` would be a 0/1 that is not a length. Widening this set
 *  is a decision about what a fold MEANS, not a completeness exercise. */
const FOLD_BINARY = Object.freeze({
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
})

/** A canonical tree that names NO bar → its scalar value; `null` when it does
 *  not reduce to one.
 *
 *  ⭐⭐ THE ARITHMETIC IS THE INTERPRETER'S OWN. A call is evaluated by handing
 *  `FN[name]` one-bar columns, so `round` here is the engine's `round` — half
 *  AWAY FROM ZERO, the way Pine rounds and the way BOTH lanes already round —
 *  and not `Math.round`, which rounds a half toward +∞. A translator that spelled
 *  its own rounding would disagree with the chart on every `.5`, and the
 *  disagreement would be invisible: the formula reads perfectly either way.
 *
 *  ⭐ THE FOLDABLE CALL SET IS `isPointwise`'s, DERIVED FROM THE MANIFEST. It is
 *  exactly the set a recurrence body may call one bar at a time — `lookback: 0`,
 *  no `forward`, every argument a `series` — which is the same question this asks:
 *  can this call be evaluated without reading any other bar? The day the manifest
 *  declares `floor`, this folds it with no edit here; the day a name leaves,
 *  `R2` goes red rather than leaving the fold holding a name the engine dropped.
 *
 *  ⛔ EVERY NON-FINITE INTERMEDIATE FAILS CLOSED. `len / 0` is Infinity and
 *  `sqrt(0 - len)` is NaN; both are numbers JavaScript is happy to carry and
 *  neither is a count of bars. Declining at the node where it appears also stops
 *  a later `nz` laundering it back into something that looks like a length.
 *
 *  ⛔ AN `offset` IS NULL EVEN OVER A CONSTANT CHILD. `close[1]` has a constant
 *  index and reads a bar; the index is not the value.
 *
 *  ⚠️ EXPORTED FOR `pine.window.test.js`'s derivation rails (R1/R2), which drive
 *  it directly against `interpret` on the same trees. Nothing else imports it. */
export function constantValueOf(node, budget = { left: MAX_FOLD_NODES }) {
  if (!node || typeof node !== 'object') return null
  if (budget.left <= 0) return null
  budget.left -= 1

  if (node.type === 'num') {
    return typeof node.value === 'number' && Number.isFinite(node.value) ? node.value : null
  }

  if (node.type === 'op') {
    const args = node.args || []
    if (node.name === 'u-') {
      if (args.length !== 1) return null
      const v = constantValueOf(args[0], budget)
      if (v === null) return null
      return Number.isFinite(-v) ? -v : null
    }
    const fn = own(FOLD_BINARY, node.name) ? FOLD_BINARY[node.name] : null
    if (!fn || args.length !== 2) return null
    const a = constantValueOf(args[0], budget)
    if (a === null) return null
    const b = constantValueOf(args[1], budget)
    if (b === null) return null
    const out = fn(a, b)
    return Number.isFinite(out) ? out : null
  }

  if (node.type === 'call') {
    const spec = own(TABLE.functions, node.name) ? TABLE.functions[node.name] : null
    // ⛔ ALL THREE CONDITIONS, NOT TWO. `isPointwise` answers the manifest's
    // question; `FN[name]` is the implementation actually shipped; the arity check
    // stops a malformed tree reaching an implementation that would read
    // `undefined` and answer NaN rather than refusing.
    if (!spec || !isPointwise(spec) || typeof FN[node.name] !== 'function') return null
    const args = node.args || []
    if (args.length !== spec.args.length) return null
    const cols = []
    for (const a of args) {
      const v = constantValueOf(a, budget)
      if (v === null) return null
      cols.push([v])
    }
    // ⚠️ `Array.isArray` IS THE WRONG TEST HERE AND WAS THE FIRST BUG. The engine's
    // columns are `Float64Array`s (`interpret.js::nan`), for which `Array.isArray`
    // is FALSE — so a length check on the returned column is what actually asks
    // "did this compute a bar?". Written out because the wrong version failed
    // CLOSED: every call silently declined to fold and the fold looked like it
    // simply did not support calls.
    const out = FN[node.name](...cols)
    const v = (out && typeof out.length === 'number' && out.length > 0) ? out[0] : NaN
    return Number.isFinite(v) ? v : null
  }

  // `series`, `offset`, `tf`, `tf_live`, `sym`, and anything this file has never
  // heard of. Fail closed rather than guess.
  return null
}

/** ⭐⭐ IT CAN ONLY EVER HAND BACK AN EXACT WHOLE NUMBER. Anything else — a
 *  fraction, a NaN, an Infinity, a negative, a bar read — returns the ORIGINAL
 *  node, and the guard downstream refuses it with the sentence and the token it
 *  always used. So this fold can widen what is accepted and can NEVER round a
 *  length.
 *
 *  ⭐ WHY `>= 0` AND NOT `>= 1`: `interpret.js::windowLiteral` owns the "at least
 *  1" bound and NAMES it in its own refusal. Restating it here is
 *  `lesson_a_second_authority_over_one_value`. With `>= 0`, a folded zero reaches
 *  the engine and is refused there — byte-identical to a WRITTEN `sma(close, 0)`,
 *  which is measured to do exactly that today. A negative folds through `cNum` to
 *  `u-(num n)`, which is not a `num`, so it refuses at THIS door — again
 *  byte-identical to a written `-4`. */
function foldWindow(node) {
  const v = constantValueOf(node)
  return (v !== null && Number.isInteger(v) && v >= 0) ? cNum(v) : node
}

/** The extra half of a `pine:window` sentence, for the one case where the length
 *  DID reduce to a constant and that constant is not a whole number of bars.
 *  Empty string for every other decline, so those keep the sentence they had.
 *
 *  ⭐⭐ A REFUSAL MUST NAME WHAT WOULD UNBLOCK IT, AND THIS ONE CAN NAME IT
 *  EXACTLY. `len / 2` with `len = input(21)` is 10.5, and the member cannot see
 *  that from their own source because `len` is an input — so the sentence prints
 *  both the reduced expression and its value, and hands back the literal text
 *  that works. `pine.window.test.js::U1` asserts the advice actually translates;
 *  advice nobody can act on is worse than none.
 *
 *  ⛔ AND IT SAYS WHY, WITH TRADINGVIEW'S OWN RULE, because "10.5 is not a whole
 *  number" reads like an arithmetic error to someone who believes Pine truncates
 *  int division. It does not: their operators page states verbatim that "when
 *  using the division operator with \"int\" operands, if the two \"int\" values
 *  are not evenly divisible, the result of the division is always a number with a
 *  fractional value, e.g., 5/2 = 2.5".
 *
 *  ⚠️ WHAT THIS SENTENCE DELIBERATELY DOES NOT DO IS PICK A ROUNDING. No
 *  TradingView-hosted page states what `ta.sma`/`ta.wma` do with a fractional
 *  length; rounding it here would compute a different indicator under the
 *  member's own title, and no chart announces the substitution. */
function fractionalWindowAdvice(node) {
  const v = constantValueOf(node)
  if (v === null || Number.isInteger(v)) return ''
  let text = null
  try { text = printFormula(node) } catch { text = null }
  const named = text ? `\`${text}\`` : 'that length'

  // ⭐ THE TWO WHOLE NUMBERS EITHER SIDE, NAMED WITH THEIR VALUES. A member
  // told only to "write `round(…)`" cannot see that the other choice exists,
  // still less that it is the one this engine's own entries use.
  const down = Math.floor(v)
  const up = Math.round(v)
  // ⛔ `floor` IS NOT DECLARED — `idiv` IS, and it is the only spelling of the
  // downward choice a member can actually type. Deriving the roster rather than
  // asserting it means this sentence stops offering `idiv` on the day the
  // manifest stops declaring it, instead of advising a name that refuses.
  //   AND ONLY ABOVE ZERO. `idiv` is declared as "rounded toward ZERO", which
  //   equals `floor` for a positive value and NOT for a negative one. A window is
  //   >= 1 by the `int` kind, so the two never diverge where this sentence is
  //   reached — but offering a spelling whose semantics only coincide inside the
  //   range you happen to be in is how the next reader inherits a false general
  //   claim, so the bound is written down rather than relied upon.
  const has = (k) => own(TABLE.functions || {}, k)
  const downSpell = (has('idiv') && text && v > 0) ? `\`idiv(${text}, 1)\`` : null
  const upSpell = has('round') && text ? `\`round(${text})\`` : null

  let choice = ''
  if (downSpell && upSpell && down !== up) {
    choice = `. WHICH whole number is a real choice and the two are different `
      + `indicators: ${downSpell} is ${down}, ${upSpell} is ${up}`
    // ⚰⚰ THIS SENTENCE USED TO NAME `round` ALONE, AND THAT WAS A SECOND
    // AUTHORITY OVER A VALUE THE MANIFEST ALREADY DECLARES. `closedTable.json::
    // _functions_hull` states Hull's half-window as `floor(n / 2)` and both lanes
    // implement it (`interpret.js` `Math.max(1, Math.floor(n / 2))`,
    // `ast_interpret.py` `max(1, int(n) // 2)`). So a member hand-expanding a Hull
    // average, following this advice, got `round(55 * 1/2)` = 28 where `hma(close,
    // 55)` uses 27 — measured 0.636 apart over 140 bars on the same series, under
    // the member's own title, with nothing on the chart announcing it.
    // ⛔ THE FIX IS NOT TO SWAP ONE NAME FOR THE OTHER. The docblock above is
    // right that no TradingView page states a rounding for `ta.sma`, so PICKING
    // one here would be the same defect pointing the other way. What the sentence
    // owes the member is both spellings, both values, and — where this engine
    // HAS a declared convention for the shape they are writing — which way its
    // own entry goes.
    // ⛔ A HALF-INTEGER IS `v * 2` BEING WHOLE while `v` is not — which is
    // exactly the shape `n / 2` produces for an odd `n`, and the only shape a
    // hand-expanded Hull half-window can take.
    if (Number.isInteger(v * 2) && has('hma')) {
      choice += `. ⚠ If you are expanding a HULL average by hand, this engine's own `
        + `\`hma\` declares the half-window as the DOWNWARD one (\`floor(n / 2)\`, `
        + `\`closedTable.json::_functions_hull\`) — so \`hma(…)\` uses ${down} here, `
        + `and \`hma\` is already declared, which spares you the expansion entirely`
    }
  } else if (upSpell) {
    choice = `. Write ${upSpell} if that is the length you mean`
  }

  return ` — ${named} reduces to ${v}, and Pine's \`/\` on two whole numbers keeps `
    + 'the fraction (their own docs: `5 / 2 = 2.5`), so this is not a whole number '
    + `of bars${choice}`
}

/** Is this tree the literal `na` this translator emits — `0 / 0`?
 *
 *  ⛔ A LITERAL SHAPE ONLY, never "might be NaN at runtime". Deciding that in
 *  general is the halting problem wearing a hat; deciding THIS is reading two
 *  `num` nodes. It exists so a seed that can only ever be blank is refusable at
 *  translation time rather than discovered by a member whose scan finds nothing. */
const isNaNLiteral = (n) => !!n && n.type === 'op' && n.name === '/'
  && n.args && n.args.length === 2
  && n.args[0].type === 'num' && n.args[0].value === 0
  && n.args[1].type === 'num' && n.args[1].value === 0

/** Printing precedence. Deliberately a LOCAL copy of `parse.js`'s binding powers
 *  rather than an import, and the copy is safe for exactly one reason: every
 *  string this printer produces is re-parsed and hashed against the tree it was
 *  printed from. A drift between the two tables cannot ship a wrong formula — it
 *  can only make `pine:roundtrip` fire, loudly, with nothing emitted. */
const PRINT_BP = Object.freeze({
  '||': 1, '&&': 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10,
})

const TERNARY_BP = 0
const UNARY_BP = 11
/** ⚠️ ABOVE `UNARY_BP`, AND THAT IS LOAD-BEARING. `[n]` is postfix, so it binds
 *  tighter than unary minus: printing `(-close)[1]` as `-close[1]` would re-parse
 *  as `-(close[1])`, a different tree. The round-trip check would catch it, but
 *  it would catch it as a refusal a member could not act on. */
const POSTFIX_BP = 12

function printNumber(value) {
  if (!Number.isFinite(value)) {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
  return String(value)
}

/** A canonical tree → UCT formula text, with the fewest parentheses that survive
 *  a round trip through `parseFormula`. */
export function printFormula(node, parentBp = 0) {
  if (!node || typeof node !== 'object') {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
  switch (node.type) {
    case 'num': return printNumber(node.value)
    case 'series': return node.name
    case 'call':
      return `${node.name}(${node.args.map((a) => printFormula(a, 0)).join(', ')})`
    case 'offset':
      // The engine's fifth node type, spelled the way its own parser reads it —
      // which is the way Pine spells it too, so what a member sees in the formula
      // box is the sub-expression they pasted.
      return `${printFormula(node.args[0], POSTFIX_BP)}[${printNumber(node.value)}]`
    case 'tf':
      // The SIXTH node type, spelled the way this engine's own parser reads it:
      // `tf(<expr>, '<TF>')`. ⚠️ The child prints at precedence 0 so a composite
      // one is fully parenthesised inside the call — the same reason `call`
      // above does it, and what keeps `tf(a > b, 'W')` from re-parsing as
      // something else.
      return `tf(${printFormula(node.args[0], 0)}, '${node.value}')`
    case 'tf_live':
      // ⚠️ ITS OWN SPELLING, never `tf` with a flag — a member reading the formula
      // back must be able to see that this one reads the FORMING period.
      return `tf_live(${printFormula(node.args[0], 0)}, '${node.value}')`
    case 'sym':
      // ⭐ THE SEVENTH NODE TYPE, and the TICKER COMES FIRST — `sym('SPY', expr)`
      // — because that is the order this engine's own parser reads, which is in
      // turn the order every platform a member arrives from writes it
      // (`request.security(symbol, tf, expr)`). The child prints at precedence 0
      // for the same reason `tf` above does.
      return `sym('${node.value}', ${printFormula(node.args[0], 0)})`
    case 'op': {
      if (node.name === 'u-' || node.name === '!') {
        const sym = node.name === 'u-' ? '-' : '!'
        const inner = printFormula(node.args[0], UNARY_BP)
        const text = `${sym}${inner}`
        return UNARY_BP < parentBp ? `(${text})` : text
      }
      if (node.name === '?:') {
        const text = `${printFormula(node.args[0], TERNARY_BP + 1)} ? `
          + `${printFormula(node.args[1], TERNARY_BP + 1)} : `
          + `${printFormula(node.args[2], TERNARY_BP)}`
        return parentBp > TERNARY_BP ? `(${text})` : text
      }
      const bp = PRINT_BP[node.name]
      if (typeof bp !== 'number') {
        throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
      }
      const text = `${printFormula(node.args[0], bp)} ${node.name} ${printFormula(node.args[1], bp + 1)}`
      return bp < parentBp ? `(${text})` : text
    }
    default:
      throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
}

// --------------------------------------------------------------------------- //
// resolution — from the outputs backwards
// --------------------------------------------------------------------------- //

// --------------------------------------------------------------------------- //
// the bar offset — ONE SEAM, and it is the only thing waiting on another lane
// --------------------------------------------------------------------------- //

/**
 * ⭐⭐ `close[3]` → whatever node the ENGINE declares for a bar offset.
 *
 * Pine's history-referencing operator is read in full by `parsePostfix` above,
 * with the engine's own constraints applied AT PARSE — a whole-number literal,
 * never negative, one application per value. Everything about `[n]` on the Pine
 * side is therefore finished, and so is the node it becomes.
 *
 * ⚰️ THIS PARAGRAPH SAID THE OPPOSITE: that the node "is not finished" because
 * the manifest's `_no_offset` "says there is none yet". Read that entry today and
 * it opens "⭐ THERE IS A BOUNDED BACKWARD OFFSET" — `expr[n]` canonicalises to
 * `{type: 'offset', value: n, …}`, and `offset` is one of the eight declared node
 * types. The manifest was re-opened exactly as its own `_no_offset_reopened_by`
 * required; this comment was not moved with it, and went on describing a shut door
 * to everyone who read the parser before the manifest.
 *
 * ⛔ THE CONSTRAINT IT CARRIED IS STILL LIVE AND IS WHY THIS NOTE STAYS: a FORWARD
 * offset remains unsayable by construction, and re-opening that is a SPEC decision
 * belonging to the owner of the repaint claim together with the owner of the
 * manifest — so this module may not invent one.
 *
 * ⛔ AND IT MUST NOT INVENT ONE EVEN TEMPORARILY. A second offset representation
 * would be a second grammar with a second Python walker and a second thing
 * `maxLookback` has to know about, and `compute.fn` is `astHash` — so a shape
 * guessed today is a shape every persisted definition is stuck with. That is the
 * `williams_r`/`williamsR` cost, paid up front and permanently.
 *
 * ⭐ SO IT IS DISCOVERED FROM THE MANIFEST, WHICH IS WHERE THIS REPO PUTS A FACT
 * BOTH LANES READ. When the offset lands it will declare itself there; this
 * reads that declaration and emits the node. Until then it refuses BY NAME and
 * says what it is waiting for — a refusal that names its own dependency, rather
 * than a wall that reads like a decision.
 *
 * The declaration this looks for:
 *
 *     "_bar_offset": { "fn": "<the function key>" }
 *
 * and the emitted node is `call(<fn>, [<child>, num(n)])` — the ONE shape under
 * which `maxLookback` stays a tree sum, because the manifest's existing
 * `"lookback": "arg1"` machinery already turns the literal second argument into
 * the window (`lint.js::resolveDeclaration`), and the outer window composes onto
 * the child's through `addReach` with not a line of the linter changing.
 * `pine.offset.test.js` proves that end to end against a synthetic manifest, so
 * the day the real one lands this is a fact rather than a hope.
 */
function barOffsetNode(child, n, table, tok, wrote) {
  // `x[0]` is `x`, at every bar, under any representation. Emitting it needs no
  // node and no dependency.
  if (n === 0) return child

  // ⭐ DISCOVERED FROM `NODE_TYPES`, WHICH `parse.js` EXPORTS AND ASSERTS BY
  // WALKING A PARSED TREE. Not a version check, not a feature flag and not a
  // `try { … } catch`: the canonical vocabulary is a value this module can read,
  // so "does the engine have a bar offset" is answered by the engine.
  if (NODE_TYPES.includes('offset')) {
    return { type: 'offset', value: n, args: [child] }
  }

  throw new PineRefusal('pine:history-ref',
    `${REFUSALS['pine:history-ref']}${wrote ? ` — \`${wrote}\`` : ''}. It is being added `
    + 'as a bounded constant offset; until it lands, a one-bar difference is '
    + '`change(x)` and a one-bar crossing is `crossOver(a, b)` / `crossUnder(a, b)`, '
    + 'both of which this table already declares', locate(tok))
}

const PINE_OP_TO_TABLE = Object.freeze({
  '+': '+', '-': '-', '*': '*', '/': '/',
  '>': '>', '<': '<', '>=': '>=', '<=': '<=',
  '==': '==', '!=': '!=',
  and: '&&', or: '||',
})

/** `x && 1` → `x`, `x || 0` → `x`, and their mirrors — ONLY when `x` is a boolean.
 *
 *  ⭐ WHY THIS EXISTS: `barstate.isconfirmed` resolves to the constant 1 (this
 *  engine evaluates closed bars, so it IS true), which is correct and left every
 *  guarded script reading `… && 1 ? 1 : 0`. The member sees an unexplained `and 1`
 *  and the English read-back says "…and 1) is not zero". Measured in production
 *  2026-08-11 on a real pasted script.
 *
 *  ⛔⛔ THE BOOLEAN GUARD IS NOT OPTIONAL, AND IT IS WHY THIS IS NOT A ONE-LINER.
 *  `x && 1` is `x` only when `x` is already 0/1. For an ordinary number it is NOT:
 *  `5 && 1` is 1 while `5` is 5, so folding unguarded would silently change what a
 *  member's formula computes — the worst outcome available and precisely the
 *  look-alike class this engine refuses everywhere else. `treeYieldsBool` is the
 *  table's own answer to "is this 0/1", the same one the plot linter uses.
 *
 *  ⚠️ NaN is safe on purpose: `NaN && 1` is "nothing" and so is `NaN`, so the
 *  not-computable case folds to itself rather than to a number.
 */
function foldLogicalIdentity(op, left, right, table) {
  const isNum = (n, v) => n && n.type === 'num' && n.value === v
  const identity = op === '&&' ? 1 : op === '||' ? 0 : null
  if (identity !== null) {
    if (isNum(right, identity) && treeYieldsBool(left, table)) return left
    if (isNum(left, identity) && treeYieldsBool(right, table)) return right
  }
  return cOp(op, [left, right])
}

/** ⛔ THE RECURSION CEILING FOR USER FUNCTIONS. A Pine function that calls
 *  itself is illegal Pine, but nothing here parses Pine's legality — so the
 *  depth is what stops a self-call from being a stack overflow instead of a
 *  refusal. It is deliberately far above anything a real script nests (the
 *  corpus tops out at two). */
const MAX_CALL_DEPTH = 24

class Resolver {
  constructor(env, table, types, opts = {}) {
    this.env = env
    this.table = table
    this.types = types || new Map()
    this.index = functionIndex(table)
    // ⛔ KEYED ON THE BINDING OBJECT, NEVER ON THE NAME. Once `x := x + 1` is
    // foldable, a name legitimately re-enters itself — under a DIFFERENT binding,
    // the one it held before the reassignment. A name-keyed cycle guard would
    // call every reassignment a cycle; an identity-keyed one still catches the
    // real thing (`a = b` / `b = a` re-enters the same object).
    this.stack = new Set()
    /** Argument bindings, one frame per user-function call in flight. */
    this.frames = []
    this.usedInputs = new Map()
    /** name → the binding it holds after the WHOLE program walk. Read only by
     *  the `[n]` guard, which needs to know whether a read of a reassigned name
     *  is the last word on it. */
    this.finalBindings = opts.finalBindings || new Map()
    /** name → the mutator tokens found by the raw-token scan. */
    this.mutated = opts.mutated || new Map()
    /** name → the binding in scope where its own `[1]` was read: the SEED. */
    this.recurrenceSeeds = new Map()
    /** name → the location of the `[` that read it. ⛔ THE REFUSAL MUST LAND ON
     *  THE SELF-READ, not on the binding the gate happens to fire from — that
     *  token is the thing a member has to change. */
    this.recurrenceSeedAt = new Map()
    /** name → the accumulator already built, so the outside path does not rebuild
     *  it: `shortStopPrev` reads `shortStop[1]`, which builds `shortStop`, whose
     *  update reads `shortStopPrev` again.
     *
     *  ⚠️ MUTATION-SURVIVED 2026-08-12, and the note that used to sit here called
     *  it "THE MEMO that stops the outside path re-entering" — implying a
     *  correctness guard. Disabling it leaves all 843 tests green, because the
     *  rebuild produces the SAME tree; the marker and the per-recurrence cycle
     *  stack are what make re-entry safe. This is a COST cut on a resolution that
     *  is already exponential in the emitted text, nothing more. Recorded rather
     *  than deleted so the next reader does not mistake it for a rail — and so
     *  nobody re-derives its necessity from a comment that overclaimed. */
    this.recurrenceColumns = new Map()
    /** The name whose recurrence is being built RIGHT NOW. `name[1]` is `self`
     *  inside that name's own update and the whole accumulator offset a bar
     *  anywhere else; without this marker the two cannot be told apart. */
    this.buildingRecurrence = null
  }

  /** Resolve THROUGH a binding: swap to the environment the binding was written
   *  in, guard the cycle, and put the environment back.
   *
   *  ⭐ THE ENVIRONMENT SNAPSHOT IS WHAT MAKES REASSIGNMENT SOUND. `x := x + 1`
   *  stores a node whose `x` must mean the PREVIOUS binding, and it does, because
   *  the new binding carries the env as it stood when the right-hand side was
   *  written. That is single-assignment form, reached without renaming anything a
   *  member would see. */
  resolveBinding(bound, tok, name) {
    if (!bound) {
      // ⭐ Same question as the other refusal site: a name the closed table holds
      // is not a name the member failed to define.
      const clockKey = engineClockKeyFor(name)
      if (clockKey) {
        if (own(PINE_CLOCK_MISMATCH, name)) {
          throw new PineRefusal('pine:builtin',
            `\`${name}\` is ${PINE_CLOCK_MISMATCH[name]}`, locate(tok))
        }
        return clockLeaf(clockKey)
      }
      throw new PineRefusal('pine:undefined',
        `${REFUSALS['pine:undefined']} — \`${name}\``, locate(tok))
    }
    if (bound.kind === 'opaque') throw new PineRefusal(bound.guard, bound.message, bound.at)
    if (bound.kind === 'state') {
      // ⭐ THE SEED AND THE UPDATE RESOLVE IN THEIR OWN ENVIRONMENTS, and they
      // are different ones: the seed was written before the first `:=` and the
      // update after it. Sharing one env is how `x := x + 1`'s right-hand `x`
      // would come to mean the accumulator instead of its own past.
      const prevEnv = this.env
      const spec = this.table.functions.accum
      if (!spec) {
        throw new PineRefusal('pine:state',
          `${REFUSALS['pine:state']} — \`${name}\``, bound.at || locate(tok))
      }
      try {
        this.env = bound.seedEnv || prevEnv
        const seed = this.resolve(bound.seed)
        // ⭐ A `var` NOBODY REASSIGNS, WITH A CONSTANT SEED, IS THE CONSTANT — and
        // this is a correctness fix, not a tidiness one. `var k = 5` wrapped in an
        // accumulator is `5` from bar 250 onward and NOT COMPUTABLE before it, so
        // `close > k` would go blank for a trading year over a number that never
        // changes. Unwrapping is an identity: a constant 250 bars ago is the same
        // constant. ⛔ ONLY for a `num` — `var anchor = close` really does mean a
        // bar in the past, and that one keeps its accumulator and its warm-up.
        if (bound.update && bound.update.type === 'selfref' && seed && seed.type === 'num') {
          return seed
        }
        // 🔴 …AND THE SAME SHAPE SEEDED `na` IS A COLUMN THAT CAN ONLY EVER BE
        // BLANK. `accum(0/0, self, n)` never leaves its seed, so every bar is NaN
        // — measured at 400/400 on the anchored-VWAP script in the corpus.
        //
        // ⛔ IT IS SAVEABLE, WHICH IS WHAT MAKES IT WORSE THAN A REFUSAL. It
        // parses, budgets, lints `non-repainting` and clears `canSaveFormula`, so
        // a member gets a scan that returns nothing and reads as a quiet market
        // rather than a broken column. That is the exact failure this translator
        // refuses `cum` and `barssince` to avoid, arrived at from the other side.
        //
        // ⚠️ THIS WAS REACHED ONLY WHEN `ta.cross` LANDED — the output refused
        // earlier in the same expression until then, so the dead accumulator sat
        // behind a louder refusal. Closing one gap is what exposed it.
        if (bound.update && bound.update.type === 'selfref' && isNaNLiteral(seed)) {
          throw new PineRefusal('pine:state',
            `\`${name}\` is a \`var\` seeded \`na\` that nothing in this script updates, `
            + 'so every bar of its column would be blank — the reassignment it needs is '
            + 'one this translator could not fold into a single expression',
            bound.at || locate(tok))
        }
        this.env = bound.updateEnv || prevEnv
        const update = this.resolve(bound.update)
        // 🔴🔴 THE CONVERGENCE GATE, ON THE DOOR THAT DID NOT HAVE ONE. `x = 0.0`
        // + `x := x + volume` has refused since the gate landed; `var x = 0.0` +
        // the SAME reassignment folded straight to `accum(0, self + volume, 250)`
        // — a 250-bar ROLLING SUM presented as OBV, on every bar, drawing a line
        // nobody would question. Two spellings of one construct reached two
        // different answers because only one of them was railed.
        // ⚠️ Found by a test written for a different feature, which is the honest
        // account: the guard reads correct beside the path it is on, and nothing
        // pointed at the sibling path four hundred lines away.
        // ⛔ `var k = 5` and any other un-reassigned `var` are unaffected — their
        // update IS bare `self`, which forgets by definition.
        if (containsSelfSeries(update, this.table)
            && !forgetsItsSeed(update, this.table, PINE_STATE_WARMUP)) {
          throw new PineRefusal('pine:state',
            REFUSALS['pine:state'] + ' — `' + name + '` builds on its own previous '
            + 'bar and this engine cannot tell that it ever forgets where it '
            + 'started, so folding it would draw a rolling window over the last '
            + PINE_STATE_WARMUP + ' bars rather than a running total',
            bound.at || locate(tok))
        }
        const args = []
        args[spec.recurrence.seed] = seed
        args[spec.recurrence.body] = update
        args[spec.recurrence.warmup] = cNum(PINE_STATE_WARMUP)
        return cCall('accum', args)
      } finally { this.env = prevEnv }
    }
    // ⭐⭐ ONE ELEMENT OF A TUPLE-RETURNING FUNCTION. `[a, b] = f(x)` binds each
    // name to a part; resolving one INLINES the call exactly as the `fn` arm
    // below does and then takes its own element. The frame is the call's, so a
    // part reads the caller's arguments and not somebody else's.
    // ⭐⭐ A `switch` REDUCED TO ITS ONE LIVE ARM. The subject must be a string
    // this script FIXES — an `input.string("EMA", …)` or a literal — because the
    // whole basis for reducing it is that the branch does not move bar to bar.
    // Anything else and every arm would have to exist at once, which is a menu
    // rather than a column, and it keeps refusing at `pine:block`.
    if (bound.kind === 'switch') {
      const subject = this.stringValueOf(bound.subject)
      if (subject === null) {
        throw new PineRefusal('pine:block',
          `${REFUSALS['pine:block']} — \`switch\`, and this one's subject is not a value the `
          + 'script fixes, so every arm would have to exist at once',
          bound.at || locate(tok))
      }
      let picked = null
      for (const arm of bound.arms) {
        const label = this.stringValueOf(parseWholeExpression(arm.match))
        if (label !== null && label === subject) { picked = arm.binding; break }
      }
      if (!picked) picked = bound.fallback
      if (!picked) {
        // ⛔ Pine falls through to `na` when nothing matches and there is no
        // default. This engine HAS a not-computable, but choosing it here would
        // invent a column the script does not describe — so it is named instead.
        throw new PineRefusal('pine:block',
          `${REFUSALS['pine:block']} — \`switch\` on \`${subject}\`, and no arm matches it `
          + 'and there is no default', bound.at || locate(tok))
      }
      return this.resolveBinding(picked, tok, name)
    }
    // ⭐ ONE LEG OF `ta.dmi`, with its two periods compared HERE where they are
    // values rather than names.
    //
    // ⛔ PINE SMOOTHS THE ADX OVER ITS SECOND ARGUMENT while the DI legs use the
    // first; this table's `adx` takes ONE period for both. So an unequal pair
    // refuses rather than quietly returning a 14/14 ADX — the identical decision
    // `ADX14.20` makes on the TC2000 side, and the same reason: a member who
    // asked for 14/20 must not be handed a number that is not the indicator they
    // asked for.
    if (bound.kind === 'dmiLeg') {
      const prevEnv = this.env
      this.env = bound.env || prevEnv
      try {
        const a = this.resolve(bound.a)
        const b = this.resolve(bound.b)
        const same = a.type === 'num' && b.type === 'num' && a.value === b.value
        if (!same) {
          throw new PineRefusal('pine:tuple',
            `${REFUSALS['pine:tuple']} — \`ta.dmi\` smooths its ADX over the SECOND period `
            + 'and this table uses one period for both, so the two must agree',
            bound.at || locate(tok))
        }
        return this.resolve({
          type: 'call', name: bound.pineName, args: [{ value: bound.a }], tok,
        })
      } finally { this.env = prevEnv }
    }
    if (bound.kind === 'tuplePart') {
      if (this.frames.length >= MAX_CALL_DEPTH) {
        throw new PineRefusal('pine:cycle', `${REFUSALS['pine:cycle']} — \`${name}\``, locate(tok))
      }
      const part = bound.fn.value.parts[bound.index]
      if (!part) {
        // Unreachable through the destructure, which counts the parts first —
        // but a refusal beats an `undefined` if another path ever gets here.
        throw new PineRefusal('pine:tuple',
          `${REFUSALS['pine:tuple']} — \`${name}\` is element ${bound.index + 1} of a `
          + `${bound.fn.value.parts.length}-part result`, locate(tok))
      }
      this.frames.push(bound.args.map((a) => ({ kind: 'expr', node: a.value, env: bound.env })))
      const prevEnv = this.env
      this.env = part.env || prevEnv
      try { return this.resolve(part.node) } finally { this.frames.pop(); this.env = prevEnv }
    }
    if (bound.kind === 'fn') {
      throw new PineRefusal('pine:function-def',
        `${REFUSALS['pine:function-def']} — \`${name}\` is a function and this reads it as a value`,
        locate(tok))
    }
    if (bound.kind === 'param') {
      // ⛔ AN ARGUMENT IS EVALUATED IN THE CALLER'S SCOPE, so the frame comes OFF
      // while it resolves. Leaving it on is how `f(f(x))` would read the inner
      // call's arguments out of the outer call's frame.
      const frame = this.frames.pop()
      if (!frame) {
        throw new PineRefusal('pine:undefined',
          `${REFUSALS['pine:undefined']} — \`${name}\``, locate(tok))
      }
      try { return this.resolveBinding(frame[bound.index], tok, name) } finally { this.frames.push(frame) }
    }
    if (this.stack.has(bound)) {
      throw new PineRefusal('pine:cycle', `${REFUSALS['pine:cycle']} — \`${name}\``, locate(tok))
    }
    const wasBuilding = this.buildingRecurrence
    const isFinalOfMutable = !!name && this.mutated.has(name)
      && this.finalBindings.get(name) === bound
    // ⭐⭐ PINE'S PLAIN SELF-REFERENCE — `x = na(x[1]) ? seed : f(x[1])` — IS THE
    // SAME RECURRENCE WEARING THE OTHER SPELLING, and this door could not reach
    // it. Only `var x` + `x := …` entered `mutated`, so the commonest stateful
    // idiom in published Pine refused at `pine:undefined`, NAMING THE VARIABLE
    // BEING DEFINED — a refusal that reads like the member forgot to declare
    // something. Every hand-rolled smoother, trailing stop and hold-last-value
    // line is written this way, including the classic Heikin-Ashi open.
    // ⚠️ IT REUSES THE MUTABLE PATH'S MACHINERY RATHER THAN A SECOND COPY — the
    // fresh cycle stack, `buildingRecurrence`, `plainRecurrence`'s self-emission
    // and the convergence gate all apply unchanged. What differs is only WHERE
    // THE SEED COMES FROM: the mutable form has a prior `var` binding to point
    // at, this form states its seed in the `na` arm.
    const isSelfRef = !isFinalOfMutable && !!name && !this.mutated.has(name)
      && bound.kind === 'expr' && readsOwnPrevious(bound.node, name)
    // ⭐⭐ A FRESH CYCLE STACK INSIDE A RECURRENCE BUILD. The same binding legally
    // resolves TWICE here — `shortStopPrev` once outside the recurrence and once
    // within its update — yielding a DIFFERENT tree each time, because
    // `shortStop[1]` is the accumulator outside and `self` inside. The shared
    // stack read that as a cycle. Scoping it keeps genuine self-cycles caught.
    const prevStack = this.stack
    if (isFinalOfMutable || isSelfRef) {
      this.buildingRecurrence = name
      this.stack = new Set()
    }
    this.stack.add(bound)
    const prevEnv = this.env
    if (bound.env) this.env = bound.env
    try {
      const body = this.resolve(bound.node)
      if (isFinalOfMutable && this.recurrenceSeeds.has(name)
          && containsSelfSeries(body, this.table)) {
        // 🔴🔴 THE CONVERGENCE GATE — see `forgetsItsSeed`.
        if (!forgetsItsSeed(body, this.table, PINE_STATE_WARMUP)) {
          // ⛔ The DECLARED sentence leads; the specifics follow. Two rails hold
          // this — the refusal corpus and "refuses for a DECLARED reason" — and
          // both exist because a hand-written message drifts from the guard it
          // claims to be.
          throw new PineRefusal('pine:state',
            `${REFUSALS['pine:state']} — \`${name}\` builds on its own previous bar `
            + 'without ever forgetting where it started, and this engine\'s accumulator '
            + 're-seeds a fixed number of bars back, so it would become a rolling sum '
            + 'rather than a running total',
            this.recurrenceSeedAt.get(name) || bound.at || locate(tok))
        }
        const spec = this.table.functions.accum
        const seedBinding = this.recurrenceSeeds.get(name)
        this.recurrenceSeeds.delete(name)
        this.recurrenceSeedAt.delete(name)
        this.buildingRecurrence = wasBuilding
        const seed = this.resolveBinding(seedBinding, tok, name)
        const args = []
        args[spec.recurrence.seed] = seed
        args[spec.recurrence.body] = body
        args[spec.recurrence.warmup] = cNum(PINE_STATE_WARMUP)
        const built = cCall('accum', args)
        this.recurrenceColumns.set(name, built)
        return built
      }
      if (isSelfRef && containsFreeSelfSeries(body, this.table)) {
        const parts = seedAndUpdateOf(body, this.table)
        if (!parts) {
          // ⛔ ONE SHAPE ONLY, AND SAYING SO IS THE POINT. `na(x[1]) ? SEED :
          // UPDATE` is the documented idiom and it STATES ITS OWN SEED, which is
          // exactly what the accumulator needs. A bare `x = x[1] + 1` has none —
          // Pine starts it at `na` and it stays `na` on every bar — so there is
          // nothing honest to build, and inventing a 0 would answer a question
          // nobody asked with a column that looks like a counter.
          throw new PineRefusal('pine:state',
            REFUSALS['pine:state'] + ' — `' + name + '` reads its own previous bar, '
            + 'and this engine can hold that only when the script states a '
            + 'first-bar value the way `na(' + name + '[1]) ? … : …` does',
            bound.at || locate(tok))
        }
        // 🔴🔴 THE SAME CONVERGENCE GATE AS THE MUTABLE FORM, asked of the UPDATE
        // ARM ALONE — the seed arm is what the accumulator re-seeds WITH, so
        // asking it to forget itself is asking the wrong question. Routing around
        // the gate is the one thing this change must not do: `accum` re-seeds a
        // fixed number of bars back, so an update that does not forget where it
        // started becomes a ROLLING WINDOW rather than a running total.
        if (!forgetsItsSeed(parts.update, this.table, PINE_STATE_WARMUP)) {
          throw new PineRefusal('pine:state',
            REFUSALS['pine:state'] + ' — `' + name + '` builds on its own previous '
            + 'bar and this engine cannot tell that it ever forgets where it '
            + 'started, so folding it would draw a rolling window over the last '
            + PINE_STATE_WARMUP + ' bars rather than a running total',
            bound.at || locate(tok))
        }
        const spec = this.table.functions.accum
        const args = []
        args[spec.recurrence.seed] = parts.seed
        args[spec.recurrence.body] = parts.update
        args[spec.recurrence.warmup] = cNum(PINE_STATE_WARMUP)
        const built = cCall('accum', args)
        this.recurrenceColumns.set(name, built)
        return built
      }
      return body
    } finally {
      this.stack.delete(bound)
      this.stack = prevStack
      this.env = prevEnv
      this.buildingRecurrence = wasBuilding
    }
  }

  /** Walk into a binding the way `resolveBinding` does, but for a QUESTION about
   *  it rather than a translation of it — used by `stringValueOf`. Returns null
   *  wherever `resolveBinding` would refuse, because a question has no caret. */
  throughBinding(bound, fn) {
    if (!bound || bound.kind === 'opaque' || bound.kind === 'fn') return null
    if (bound.kind === 'param') {
      const frame = this.frames.pop()
      if (!frame) return null
      try { return this.throughBinding(frame[bound.index], fn) } finally { this.frames.push(frame) }
    }
    if (this.stack.has(bound)) return null
    this.stack.add(bound)
    const prevEnv = this.env
    if (bound.env) this.env = bound.env
    try { return fn(bound) } finally { this.stack.delete(bound); this.env = prevEnv }
  }

  /**
   * The STRING a node is, following bindings and `input(…)` defaults, or null.
   *
   * ⭐⭐ THIS IS NOT "STRINGS AS VALUES", AND THE DISTINCTION IS THE WHOLE POINT.
   * A string never becomes a node, never reaches `parse.js`, never reaches the
   * interpreter and never reaches a saved definition — `resolve` still refuses
   * one at `pine:text-value`. This answers ONE question, asked in ONE place: are
   * both sides of an `==` a string the translator can already see? Because when
   * they are, the comparison is a CONSTANT, and the branch it does not take is
   * code the pasted script never runs.
   *
   * ⛔ WITHOUT IT, THE `if`-FOLD IS WORSE THAN THE REFUSAL IT REPLACES. Half the
   * everget corpus dispatches on a string input (`if src == "close"` … twenty
   * arms deep), and folding twenty arms into twenty live ternaries would drag
   * `cum`, `accdist` and `nz` — all in arms the default can never reach — onto the
   * path and refuse the script for code it does not execute. TradingView's own
   * screener folds inputs to their defaults for exactly this reason.
   */
  stringValueOf(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 64) return null
    if (node.type === 'string') return node.value
    if (node.type === 'bound') {
      return this.throughBinding(node.binding, (b) => this.stringValueOf(b.node, depth + 1))
    }
    if (node.type === 'name') {
      if (own(this.table.series, node.name)) return null
      return this.throughBinding(this.env.get(node.name),
        (b) => this.stringValueOf(b.node, depth + 1))
    }
    if (node.type === 'call' && (node.name === 'input' || node.name.startsWith('input.'))) {
      const named = node.args.find((a) => a.name === 'defval')
      const positional = node.args.find((a) => !a.name)
      const defval = named ? named.value : (positional ? positional.value : null)
      return defval ? this.stringValueOf(defval, depth + 1) : null
    }
    return null
  }

  /** `Point.new(…)` and `p.x` are both a user-defined type showing through, and
   *  saying `pine:builtin` about either would name the wrong thing. A dotted name
   *  whose first segment is a type the script DECLARED, or a local the script
   *  BOUND, is a field or a constructor — never a Pine namespace. */
  typeRefusalFor(name, tok) {
    const dot = name.indexOf('.')
    if (dot <= 0) return null
    const head = name.slice(0, dot)
    if (!this.types.has(head) && !this.env.has(head)) return null
    return new PineRefusal('pine:type',
      `${REFUSALS['pine:type']} — \`${name}\``,
      this.types.get(head) || locate(tok))
  }

  resolve(node) {
    switch (node.type) {
      case 'number': return cNum(node.value)
      case 'string':
        throw new PineRefusal('pine:text-value', REFUSALS['pine:text-value'], locate(node.tok))
      case 'colour':
        throw new PineRefusal('pine:colour-value', REFUSALS['pine:colour-value'], locate(node.tok))
      case 'collection':
        throw new PineRefusal('pine:collection', REFUSALS['pine:collection'], locate(node.tok))
      case 'bound': return this.resolveBinding(node.binding, node.tok, node.name)
      // ⛔ THE NAME COMES OFF THE MANIFEST, never typed. `recurrence.binds` is
      // what both walkers read it from, and a translator that spelled `self`
      // here would be the second authority over it.
      case 'selfref': {
        const spec = this.table.functions.accum
        if (!spec) {
          throw new PineRefusal('pine:state', REFUSALS['pine:state'], locate(node.tok))
        }
        return cSeries(spec.recurrence.binds)
      }
      case 'unary': {
        const inner = this.resolve(node.arg)
        return cOp(node.op === 'not' ? '!' : 'u-', [inner])
      }
      case 'binary': {
        // ⭐ TWO STRINGS COMPARED IS A CONSTANT — see `stringValueOf`. Asked
        // BEFORE the operands are resolved, because resolving either of them is
        // the `pine:text-value` refusal this is deciding not to need.
        if (node.op === '==' || node.op === '!=') {
          const left = this.stringValueOf(node.left)
          if (left !== null) {
            const right = this.stringValueOf(node.right)
            if (right !== null) {
              return cNum(((left === right) === (node.op === '==')) ? 1 : 0)
            }
          }
        }
        const mapped = PINE_OP_TO_TABLE[node.op]
        if (!mapped || !own(this.table.operators, mapped)) {
          throw new PineRefusal('pine:operator',
            `${REFUSALS['pine:operator']} — \`${node.op}\``, locate(node.tok))
        }
        return foldLogicalIdentity(mapped,
          this.resolve(node.left), this.resolve(node.right), this.table)
      }
      case 'ternary': {
        const test = this.resolve(node.test)
        // ⛔ A BRANCH A CONSTANT TEST NEVER TAKES IS NOT RESOLVED AT ALL. This is
        // the same rule as "a statement no output reaches is a note": refusing a
        // script over an arm its own folded input makes unreachable would be
        // reading a different document than the one the member pasted.
        if (test.type === 'num') return this.resolve(test.value !== 0 ? node.yes : node.no)
        return cOp('?:', [test, this.resolve(node.yes), this.resolve(node.no)])
      }
      case 'offset': {
        // ⭐ A FOLDED OFFSET INDEX. `close[n]` with `n = input.int(10)` arrives
        // as an expression rather than a number; resolving it FIRST means every
        // guard below — and the canonical node at the end — sees the same plain
        // integer a written literal would have given them.
        if (node.n && typeof node.n === 'object' && node.n.expr) {
          const folded = this.resolve(node.n.expr)
          if (folded.type !== 'num' || !Number.isInteger(folded.value)) {
            throw new PineRefusal('pine:offset-literal',
              `${REFUSALS['pine:offset-literal']} — this one does not reduce to a whole `
              + 'number, so the window it opens would depend on a value that can change',
              locate(node.n.tok || node.tok))
          }
          // ⚠️ UNREACHABLE TODAY, KEPT DELIBERATELY, AND SAID SO. The mutation
          // harness proved it: deleting this changes no test, because nothing
          // currently folds to a NEGATIVE `num` — `-1` resolves to a `u-` op and
          // `0 - 2` to a `-` op, so both fail the whole-number check above and
          // refuse at `pine:offset-literal` one line earlier.
          //
          // ⛔ It stays because it goes live the day anything folds constant
          // arithmetic, and what it guards is the forward reference: `close[-1]`
          // is NEXT BAR, the one construction the non-repainting guarantee rests
          // on being inexpressible. A dead check in front of that is cheap. The
          // dishonest thing would be to leave it undocumented and let the next
          // reader believe it is the check doing the work.
          if (folded.value < 0) {
            throw new PineRefusal('pine:offset-negative',
              REFUSALS['pine:offset-negative'], locate(node.n.tok || node.tok))
          }
          // ⛔ A COPY, NEVER A MUTATION OF THE PARSED NODE. Outputs share one
          // parse tree and each gets its own resolver; writing the folded value
          // back would leak one output's resolution into the next.
          node = { ...node, n: folded.value }
        }
        // ⭐ A STATE VARIABLE READING ITS OWN PAST INSIDE ITS OWN UPDATE. This is
        // the single most common `pine:state` refusal in the corpus —
        // `entry_signal := cond ? 1 : entry_signal[1]` — and the engine has taken
        // `self[n]` since the multi-lag recurrence landed. Only the translator
        // was missing, so this maps Pine's 1-based count onto the accumulator's
        // 0-based one and hands the result to the arm that already exists.
        const lag = this.selfOffsetLag(node)
        if (lag !== null) {
          const spec = this.table.functions.accum
          if (!spec) {
            throw new PineRefusal('pine:state', REFUSALS['pine:state'], locate(node.tok))
          }
          const base = cSeries(spec.recurrence.binds)
          return lag === 0 ? base : { type: 'offset', value: lag, args: [base] }
        }
        const plain = this.plainRecurrence(node, node.tok)
        if (plain !== null) return plain
        this.guardOffsetOfMutable(node)
        // ⭐ THE CHILD RESOLVES FIRST, so `ta.sma(close, 20)[2]` and `close[2]`
        // reach the seam the same way and nesting needs no special case.
        const child = this.resolve(node.arg)
        const wrote = node.arg.type === 'name' ? `${node.arg.name}[${node.n}]` : null
        return barOffsetNode(child, node.n, this.table, node.tok, wrote)
      }
      case 'name': return this.resolveName(node)
      case 'call': return this.resolveCall(node)
      default:
        throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(node.tok))
    }
  }

  /**
   * ⛔⛔ `x[1]` ON A REASSIGNED NAME IS A PREVIOUS-BAR READ, AND THAT IS THE ONE
   * PLACE THE FOLD CAN BE WRONG.
   *
   * Pine records one value per bar for every variable: the value it holds when
   * the bar FINISHES. So `x[1]` is the previous bar's LAST assignment, not the
   * previous bar's value of whichever assignment happens to be in scope here.
   * Offsetting the binding in scope is exact only when that binding IS the last
   * word on the name — which is what this compares. Everything else refuses at
   * `pine:state`, naming the bar dependency rather than the token.
   *
   * ⭐ THIS IS THE TEST THE BRIEF ASKED FOR, AND IT IS DELIBERATELY NOT "WAS IT
   * SPELLED `var`". `var count = 0` / `count := count + 1` refuses because the
   * `var` handler marks it — but `x = 0.0` / `x := nz(x[1]) + volume` carries no
   * `var` at all and is just as much an accumulator, and this is what catches it.
   */
  /** `s[k]` INSIDE `s`'s OWN UPDATE — the lag it means, or `null`.
   *
   *  ⭐⭐ PINE COUNTS FROM ONE HERE AND THIS ENGINE COUNTS FROM ZERO, and getting
   *  that wrong would be silent. Inside `s := … s[1] …`, Pine's `s[1]` is the
   *  value `s` held on the PREVIOUS BAR — which is exactly what the accumulator's
   *  own `self` already is. So `s[1]` is `self`, `s[2]` is `self[1]`, and the
   *  answer is `k - 1`. ⛔ The rail asserts `s[1]` produces the IDENTICAL tree to
   *  bare `s`; an off-by-one here reads a bar too far back on every bar.
   *
   *  ⛔ ONLY WHEN THE NAME IN SCOPE IS THE SELF-REFERENCE. Outside its own
   *  update the same spelling means something else entirely, and
   *  `guardOffsetOfMutable` below is what keeps answering that question. */
  selfOffsetLag(node) {
    if (!(node.n >= 1) || !node.arg || node.arg.type !== 'name') return null
    const bound = this.env.get(node.arg.name)
    // ⛔ `kind !== 'expr'` is REDUNDANT with the `selfref` test below and is kept
    // as a cheap early exit, not as a guard — the mutation harness proved it:
    // removing it changed no behaviour, because a `state`/`fn`/`opaque` binding
    // carries no `.node` to be a selfref in the first place. Said here so nobody
    // later mistakes it for the thing keeping this correct.
    if (!bound || bound.kind !== 'expr') return null
    return bound.node && bound.node.type === 'selfref' ? node.n - 1 : null
  }

  /** `name[k]` where `name` is a PLAIN name the script reassigns later. It means
   *  TWO different trees depending on WHERE it is read — `self` inside that
   *  name's own update, the whole accumulator offset k bars anywhere else. Four
   *  earlier attempts failed by emitting one of them everywhere. */
  plainRecurrence(node, tok) {
    if (!(node.n >= 1) || !node.arg || node.arg.type !== 'name') return null
    const name = node.arg.name
    // ⭐ A PLAIN SELF-REFERENCE REACHES HERE TOO. `buildingRecurrence` is set for
    // both spellings, so `x[1]` inside the update emits `self` through this one
    // rule rather than a second copy of it. The `mutated` half stays because
    // OUTSIDE its own update a reassigned name still means the whole accumulator
    // offset k bars — that is the distinction four earlier attempts collapsed.
    if (!this.mutated.has(name) && this.buildingRecurrence !== name) return null
    const spec = this.table.functions.accum
    if (!spec) return null
    if (this.buildingRecurrence === name) {
      // ⛔ SEED-BY-PRIOR-BINDING IS THE MUTABLE FORM'S ANSWER ONLY. A plain
      // self-reference states its seed in the `na` arm, and a same-named outer
      // binding is a DIFFERENT variable it happens to shadow — banking that as
      // the seed would silently feed one column's first bar into another's.
      const bound = this.mutated.has(name) ? this.env.get(name) : null
      if (bound && !this.recurrenceSeeds.has(name)) {
        this.recurrenceSeeds.set(name, bound)
        this.recurrenceSeedAt.set(name, locate(tok))
      }
      const base = cSeries(spec.recurrence.binds)
      return node.n === 1 ? base : { type: 'offset', value: node.n - 1, args: [base] }
    }
    if (this.recurrenceColumns.has(name)) {
      return { type: 'offset', value: node.n, args: [this.recurrenceColumns.get(name)] }
    }
    const final = this.finalBindings.get(name)
    if (!final || final === this.env.get(name)) return null
    const seedHere = this.env.get(name)
    if (seedHere && !this.recurrenceSeeds.has(name)) {
      this.recurrenceSeeds.set(name, seedHere)
      this.recurrenceSeedAt.set(name, locate(tok))
    }
    const column = this.resolveBinding(final, tok, name)
    if (!this.recurrenceColumns.has(name)) return null
    return { type: 'offset', value: node.n, args: [column] }
  }

  guardOffsetOfMutable(node) {
    if (!(node.n >= 1) || node.arg.type !== 'name') return
    const name = node.arg.name
    if (!this.mutated.has(name)) return
    const bound = this.env.get(name)
    if (!bound) return
    if (this.finalBindings.get(name) === bound) return
    throw new PineRefusal('pine:state',
      `${REFUSALS['pine:state']} — \`${name}[${node.n}]\` reads what \`${name}\` held on an `
      + 'earlier bar, and this script reassigns it', locate(node.tok))
  }

  resolveName(node) {
    const name = node.name

    // ⭐⭐ PINE'S `na` IS THIS ENGINE'S NOT-COMPUTABLE, AND IT IS EXPRESSIBLE
    // WITHOUT WIDENING THE TABLE BY ONE NAME. `cond ? x : na` is the single most
    // common shape in published Pine — 15 refused outputs in the Ichimoku script
    // alone — and it means "x where the condition holds, a GAP otherwise", which
    // is exactly what a NaN column already is here.
    //
    // ⛔ SO IT EXPANDS TO `0 / 0`, AND THAT IS A DELIBERATE CHOICE OVER THE TWO
    // ALTERNATIVES. Refusing dropped whole columns and, worse, silently discarded
    // a guard the script's author wrote on purpose. Declaring a `na`/`unknown`
    // entry in the manifest would have put a value that is NEVER KNOWN into the
    // sayable vocabulary — offered in the picker, offered by the plain-language
    // door — to serve a translator. The arithmetic already has the value; only
    // the SPELLING was missing.
    //
    // ⚠️ AND IT IS AN IDENTITY IN BOTH LANES, WHICH IS THE ONLY REASON IT IS
    // ADMISSIBLE. `0 / 0` is IEEE NaN in JS natively, and `_binary_div` in the
    // Python lane returns NaN for it explicitly — that function's own docstring
    // calls this "the sharpest cross-lane divergence in the whole table" and
    // closes it, so this expansion rides a seam that is already pinned rather
    // than opening a new one. ⛔ No constant folding exists at the parse door
    // (`windowLiteral` refuses a computed window for the same reason), so the
    // node survives the round trip through `parseFormula` unchanged.
    //
    // ⚠️ THE COST IS THE READ-BACK, STATED RATHER THAN HIDDEN: this renders as
    // "0 divided by 0", which is true and is not plain English. A member sees it,
    // and the note below tells them what it came from. Making it read better
    // means a manifest entry, and that trade belongs to the manifest's owner.
    if (name === 'na') {
      return cOp('/', [cNum(0), cNum(0)])
    }

    // ⛔⛔ THE PASTED SCRIPT'S OWN BINDING COMES FIRST, AND THE ORDER IS THE
    // WHOLE GUARD. This lookup used to sit SEVENTEEN LINES LOWER, under the table
    // reads below, and the cost was a silent mistranslation on the GREEN roster.
    //
    // The manifest's 111 scalars are SCREENER COLUMNS — our vocabulary, injected
    // into the namespace as a convenience. They are not Pine built-ins, and a
    // member writing Pine has no idea `nr7` or `price` means anything to us. So
    // `nr7 = <a seven-bar narrow-range test>` followed by `plot(nr7)` resolved to
    // the literal column `nr7`: the author's arithmetic DISCARDED and replaced
    // with our screener's answer to a similar-sounding question, with no refusal,
    // under their own script title, saved and scanned that way. `16-nr4-nr7`
    // emitted a correct NR4 column beside a fabricated NR7 one in the same script.
    //
    // ⛔ THIS IS THE THIRD INSTANCE OF ONE DEFECT CLASS IN THIS FILE, and the
    // first two were fixed in CALLERS rather than here, at the resolver they are
    // special cases of: `ownSymbolNameOf` (a script binding `tickerid = 'SPY'`
    // meant SPY) and `ownTimeframeOf` (`period = "60"` meant hourly, and was
    // answered off daily bars). Each fix carried a comment stating this exact
    // rule. Fixing the general case is what stops a fourth.
    //
    // ⭐ IT IS A REORDER, NOT A DELETION: an UNBOUND scalar still resolves to our
    // column two lines down, because reading `plot(nr7)` as the screener's flag is
    // a deliberate feature. Only a name the member BOUND may take it from them.
    const bound = this.env.get(name)
    if (bound) return this.resolveBinding(bound, node.tok, name)

    // A bar field the manifest declares. ⭐ READ OFF THE TABLE, not a list here.
    if (own(this.table.series, name)) return cSeries(name)
    if (own(this.table.scalars || {}, name)) return cSeries(name)

    // Pine's own derived price series, expanded to their reference definitions.
    if (own(DERIVED_SERIES, name)) {
      const tree = derivedSeriesTree(name, this.table)
      if (!tree) {
        throw new PineRefusal('pine:builtin',
          `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
      }
      return tree
    }

    // A dotted or namespaced built-in.
    const dot = name.indexOf('.')
    if (dot > 0) {
      const asType = this.typeRefusalFor(name, node.tok)
      if (asType) throw asType
      const ns = name.slice(0, dot)
      // ⭐ THE EVALUATION MODEL ANSWERS BEFORE THE NAMESPACE GUARD DOES. `barstate`
      // is a guarded namespace, so without this the four constants never get asked.
      // The request-dependent siblings are named FIRST, so a future edit that adds
      // `barstate.islast` to the constant map contradicts itself here rather than
      // silently shipping a number that changes with the bar count.
      if (own(BUILTIN_REQUEST_DEPENDENT, name)) {
        throw new PineRefusal('pine:builtin',
          `${REFUSALS['pine:builtin']} — \`${name}\`: ${BUILTIN_REQUEST_DEPENDENT[name]}`,
          locate(node.tok))
      }
      if (own(BUILTIN_CONSTANT_TREE, name)) return BUILTIN_CONSTANT_TREE[name]()
      if (own(NAMESPACE_GUARD, ns) && !VALUE_NAMESPACES.has(ns)) {
        const guard = NAMESPACE_GUARD[ns]
        throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
      }
      if (VALUE_NAMESPACES.has(ns)) {
        // `ta.vwap`, `ta.obv`, `ta.tr` are VARIABLES in Pine. They reach the table
        // as zero-argument calls, and the table decides whether that is a thing.
        return this.resolveTableCall(name, name.slice(dot + 1), [], node.tok)
      }
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }

    if (own(LEGACY_BARE_NAMESPACE, name)) {
      const guard = NAMESPACE_GUARD[LEGACY_BARE_NAMESPACE[name]]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }

    // A bare name that is neither a bar field nor a binding. It may still be a
    // zero-argument table function (`ta.vwap` and `ta.obv` are VARIABLES in Pine,
    // and a v4 script spells them without the namespace).
    if (this.index.has(normaliseName(name)) || own(PINE_CALL_SHAPES, normaliseName(name))) {
      return this.resolveTableCall(name, name, [], node.tok)
    }

    // Everything else: a Pine built-in with no home here, or a name the script
    // never bound. The two are different facts and get different guards.
    // ⭐ AN EXACT EXPANSION BEATS A REFUSAL, AND IT IS CONSULTED LAST — after every
    // binding the script itself wrote, so a member who defines their own `tr`
    // gets THEIR `tr`, not ours. Shadowing a built-in is legal Pine and the
    // script is the authority on its own names.
    if (own(BUILTIN_SERIES_TREE, name)) return BUILTIN_SERIES_TREE[name]()
    // ⭐ ASK THE MANIFEST BEFORE EITHER HAND-TYPED ANSWER. A name the closed
    // table holds must not be told "the engine grammar does not hold" (false),
    // and must never be told "your script never defined this" (blames the member
    // for a column we compute).
    const clockKey = engineClockKeyFor(name)
    if (clockKey) {
      if (own(PINE_CLOCK_MISMATCH, name)) {
        throw new PineRefusal('pine:builtin',
          `\`${name}\` is ${PINE_CLOCK_MISMATCH[name]}`, locate(node.tok))
      }
      return clockLeaf(clockKey)
    }
    if (PINE_KNOWN_BUILTINS.has(name)) {
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }
    throw new PineRefusal('pine:undefined',
      `${REFUSALS['pine:undefined']} — \`${name}\``, locate(node.tok))
  }

  /** Did the pasted script DEFINE this name as a function of its own?
   *
   *  ⛔⛔ THE ONE PLACE THAT DECIDES, because asking it in two places is how this
   *  defect reached FIVE instances. A door-local carve-out that runs before the
   *  general user-function check has to ask this itself, and each one that forgot
   *  produced the same failure: the member's function reached for one call shape
   *  and the engine's for another, in the same script.
   *
   *  ⚠️ BOTH DEFINITION SHAPES COUNT. `kind === 'fn'` is a definition this door
   *  can inline; `opaque` + `isFunction` is one it cannot and will refuse BY NAME.
   *  Either way the member defined the name, so either way a built-in must stand
   *  aside. Checking only the second let a WORKING `security(a, b, c) => …` keep
   *  losing to its carve-out, and the test stayed red until both were covered.
   *
   *  ⭐ A VALUE BINDING IS DELIBERATELY NOT A SHADOW: `rsi = rsi(src, length)` is
   *  ordinary Pine, and treating that as a definition once made `07-rsi.pine`
   *  refuse its own plot with the wrong guard entirely. */
  shadowedByDefinition(name) {
    const defined = this.env && this.env.get(name)
    return !!defined && (defined.kind === 'fn'
      || (defined.kind === 'opaque' && defined.isFunction))
  }

  resolveCall(node) {
    const name = node.name
    const dot = name.indexOf('.')
    const ns = dot > 0 ? name.slice(0, dot) : null
    const base = dot > 0 ? name.slice(dot + 1) : name

    // ⭐ `na` AND `nz` ARE DECLARED NOW, so what used to be one blanket refusal is
    // two resolutions and one remaining refusal — and the remaining one is the
    // honest half. See `closedTable.json::_functions_na` for why a table built
    // entirely around "NaN means we do not know" declares the two that break it.
    //
    // ⛔ `nz(x)` IS FILLED WITH AN EXPLICIT ZERO RATHER THAN LEFT TO A DEFAULT.
    // Pine's one-argument form means "or 0"; this table has no one-argument form,
    // because an invisible default zero is precisely the half of the defect that
    // makes `nz(market_cap, 0) > 1e9` a confident False on a broken symbol. The
    // literal goes into the TREE, so the read-back says it and the member sees
    // what their script asked for.
    // ⚰️⚰️ AND THIS CARVE-OUT YIELDS TO A USER DEFINITION TOO — found by the
    // derived rail in `pine.bindingOrder.test.js` on its FIRST RUN, as the FIFTH
    // instance of this defect. A member writing `nz(a, b) => a + b` got the
    // ENGINE'S `nz` for every call; their own function was never reached.
    if ((name === 'na' || name === 'nz') && !this.shadowedByDefinition(name)) {
      const arity = node.args.length
      if (node.args.some((a) => a.name)) {
        throw new PineRefusal('pine:named-argument',
          `${REFUSALS['pine:named-argument']} — on \`${name}\``, locate(node.tok))
      }
      if (name === 'na' && arity === 1) {
        return cCall('na', [this.resolve(node.args[0].value)])
      }
      if (name === 'nz' && (arity === 1 || arity === 2)) {
        return cCall('nz', [
          this.resolve(node.args[0].value),
          arity === 2 ? this.resolve(node.args[1].value) : cNum(0),
        ])
      }
      throw new PineRefusal('pine:arity',
        `${REFUSALS['pine:arity']} — \`${name}\` was given ${arity} `
        + `argument${arity === 1 ? '' : 's'}`, locate(node.tok))
    }
    // ⛔ `fixnan` STAYS REFUSED, AND NOT FOR WANT OF A TABLE ENTRY. It carries the
    // last known value FORWARD ACROSS BARS for an unbounded distance, so it is
    // state with no warm-up a member could state — `accum` bounds its window on
    // purpose, and quietly picking a bound here would answer a different question
    // from the one the script asks.
    if (name === 'fixnan') {
      throw new PineRefusal('pine:na', `${REFUSALS['pine:na']} — \`${name}\``, locate(node.tok))
    }
    if (ns === 'input' || name === 'input') return this.resolveInput(node)

    const asType = this.typeRefusalFor(name, node.tok)
    if (asType) throw asType

    // ⭐⭐ THE ONE CARVE-OUT IN `request`, AND IT IS NARROW ON PURPOSE.
    // `request.security(syminfo.tickerid, '<TF>', expr)` is the higher-timeframe
    // read this engine now HAS a node for, so refusing it would be refusing
    // something we can honestly answer. Everything else under `request` — another
    // SYMBOL, a computed timeframe, `security_lower_tf`, `lookahead_on` — still
    // refuses under the namespace guard below, by name.
    //
    // ⛔ IT IS TRIED BEFORE THE GUARD AND FALLS THROUGH TO IT. `securityAsNode`
    // returns null for every shape it cannot honestly take, so a request that is
    // ALMOST this one lands on `pine:request` with the namespace's own sentence
    // rather than on a special-case message that would have to be maintained
    // twice.
    // ⚰️⚰️ AND IT YIELDS TO A USER DEFINITION OF THE SAME NAME. This carve-out
    // ran SIXTEEN LINES BEFORE the user-function check below, so a member who
    // wrote `security(a, b, c) => a + b + c` got THEIR function for
    // `security(close, high, low)` and the BUILT-IN for
    // `security(syminfo.tickerid, 'W', close)`: one name, two meanings in one
    // script, decided by whether the arguments happened to match a shape they
    // never wrote.
    // ⛔ THE SHADOW RULE ITSELF IS UNCHANGED and is the one stated below — only a
    // `f(x) =>` DEFINITION shadows a table name, never a value binding, because
    // `rsi = rsi(src, length)` is ordinary Pine. This only lets that rule apply
    // BEFORE the carve-out instead of after it.
    // ⭐ FOURTH INSTANCE OF THE BINDING-ORDER DEFECT IN THIS FILE, after
    // `ownSymbolNameOf`, `ownTimeframeOf` and `resolveName`: consult what the
    // script SAID before what the table knows.
    if (name === 'request.security' || name === 'security') {
      if (!this.shadowedByDefinition(name)) {
        const asTf = this.securityAsNode(node)
        if (asTf) return asTf
      }
    }
    if (ns && own(NAMESPACE_GUARD, ns) && !VALUE_NAMESPACES.has(ns)) {
      const guard = NAMESPACE_GUARD[ns]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }
    if (ns && !VALUE_NAMESPACES.has(ns)) {
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }
    // ⛔ ONLY A `f(x) =>` DEFINITION SHADOWS A TABLE NAME, AND A VALUE NEVER DOES.
    // `rsi = rsi(src, length)` is ordinary Pine — the variable and the function
    // live in different namespaces there — and consulting the value binding first
    // made `07-rsi.pine` refuse its own plot with the wrong guard entirely.
    const bound = this.env.get(name)
    if (bound && bound.kind === 'opaque' && bound.isFunction) {
      throw new PineRefusal(bound.guard, bound.message, bound.at)
    }
    if (bound && bound.kind === 'fn') return this.inlineUserFunction(bound, node)

    if (own(LEGACY_BARE_NAMESPACE, name)) {
      const guard = NAMESPACE_GUARD[LEGACY_BARE_NAMESPACE[name]]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }
    return this.resolveTableCall(name, base, node.args, node.tok)
  }

  /** `request.security(syminfo.tickerid, '<TF>', expr)` \u2192 a `tf` node, or null.
   *
   *  \u2b50 NULL, NEVER A REFUSAL OF ITS OWN. Returning null lets the caller fall
   *  through to `pine:request`, so every shape this cannot take keeps the ONE
   *  sentence the namespace already publishes. A second message here would be a
   *  second authority on why `request` is out.
   *
   *  \u26d4\u26d4 `lookahead_on` IS THE DANGEROUS ONE AND IT FALLS THROUGH TO REFUSED.
   *  Our `tf` is `lookahead_off` + `[1]`: each base bar reads the LAST CLOSED
   *  higher-timeframe bar. `barmerge.lookahead_on` asks for the bar the base bar
   *  is INSIDE \u2014 i.e. the future, mid-week \u2014 and translating it as if it were
   *  `off` would silently turn a look-ahead script into a look-behind one and
   *  backtest beautifully. A refusal is the only honest answer.
   *
   *  \u26a0\ufe0f THE SYMBOL MUST BE THE CHART\u2019S OWN. `syminfo.tickerid` (or
   *  `syminfo.ticker`) means "this symbol"; a string literal means ANOTHER symbol
   *  and that is `sym` — which IS built, and which this door emits: the string
   *  becomes a `sym` node and the SCAN GATE decides whether that ticker is on the
   *  benchmark roster.
   *  ⚰️ THIS LINE SAID "`sym`, which is not built yet" and outlived the run it
   *  described. A comment naming a mechanism is a claim about a run, and a stale
   *  one is how a shipped capability stays believed-impossible: this door went on
   *  refusing what it had already learned to translate.
   */
  /** A node that names a TIMEFRAME → the string it stands for, or null.
   *
   *  ⭐ FOLDING `input.timeframe` TO ITS DEFAULT IS WHAT TRADINGVIEW ITSELF DOES.
   *  This file's own header records it: their Pine Screener "supports most
   *  `input.*`, falling back to defaults for `input.timeframe`/`input.symbol`/
   *  `input.time`." So `res = input.timeframe(defval='W')` really does mean `'W'`
   *  on the surface these scripts were written for — reading it that way is
   *  fidelity, not a shortcut.
   *
   *  ⚠️ AND THE FOLD IS RECORDED, NOT SILENT. Every fold lands in `usedInputs`,
   *  the same place `resolveInput` puts a folded number, so the read-back can
   *  tell the member WHICH input was frozen and at what. A frozen input nobody is
   *  told about is a script that quietly stopped being the one they pasted.
   *
   *  ⛔ BOUNDED, because a binding can name another binding: `a = b`, `b = 'W'`.
   *  Four hops is well past anything real and makes a cycle impossible.
   */
  /** A ternary whose CONDITION is a constant → the branch that actually runs,
   *  else null. THE ONE PLACE THAT DECIDES, read by both timeframe readers.
   *
   *  ⭐⭐ `res = useCurrentRes ? period : resCustom` IS THE MTF TOGGLE IDIOM and
   *  two community scripts are nothing but it. `pine.security.test.js` recorded
   *  the case as unwinnable in the words "a TERNARY. No literal exists to fold
   *  to." True — and beside the point, because nobody has to fold the ternary
   *  itself. `useCurrentRes = input(true, …)` is a CONSTANT, so exactly one arm
   *  is reachable and the other is dead code in the script as shipped.
   *
   *  ⛔ THE CONDITION IS READ, NEVER ASSUMED. Taking `yes` unconditionally passes
   *  the common case and mistranslates the flipped one — reading a script that
   *  asks for 60-minute bars as the chart's own. A branch we cannot resolve
   *  returns null and the caller refuses, because there is no single timeframe to
   *  name and inventing one is the whole failure this node guards against.
   *
   *  ⚠️ `resolve` can refuse (an input kind we do not hold); that is a
   *  non-answer here, not an error to propagate — the caller's `null` path
   *  already says "no literal", by name, at the member's own line. */
  constantBranchOf(node) {
    if (!node || node.type !== 'ternary') return null
    let test = null
    try {
      test = this.resolve(node.test)
    } catch (err) {
      return null
    }
    // A folded constant is a `num`; anything per-bar resolves to `series`/`op`
    // and is correctly not a branch anybody can name.
    if (!test || test.type !== 'num') return null
    return test.value ? node.yes : node.no
  }

  /** Does this node name THIS CHART'S OWN timeframe? → the spelling, or null.
   *
   *  ⛔⛔ THE BINDING IS CONSULTED FIRST AND THE ORDER IS THE WHOLE GUARD — the
   *  same rule, for the same reason, as `ownSymbolNameOf`. `period` is a bare
   *  identifier in v2/v3 Pine and a script may reassign it; `period = "60"` means
   *  hourly, and reading it as the chart's own timeframe answers off whatever
   *  bars happen to be loaded. */
  ownTimeframeOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.type === 'ternary') {
      const taken = this.constantBranchOf(node)
      return taken ? this.ownTimeframeOf(taken, depth + 1) : null
    }
    if (node.type === 'name') {
      const bound = this.env && this.env.get(node.name)
      if (bound) {
        return bound.kind === 'expr' ? this.ownTimeframeOf(bound.node, depth + 1) : null
      }
      if (OWN_TF_NAMES.has(node.name)) return node.name
    }
    return null
  }

  timeframeLiteralOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.type === 'string') return node.value
    if (node.type === 'ternary') {
      const taken = this.constantBranchOf(node)
      return taken ? this.timeframeLiteralOf(taken, depth + 1) : null
    }
    if (node.type === 'name') {
      const bound = this.env && this.env.get(node.name)
      if (bound && bound.kind === 'expr') return this.timeframeLiteralOf(bound.node, depth + 1)
      return null
    }
    // ⭐ PLAIN `input` IS THE v3/v4 SPELLING and it is what the MTF scripts use:
    // `input(title=…, type=resolution, defval='D')`. Only a `defval` that is
    // itself a timeframe STRING survives the recursion, so widening the call
    // names here cannot turn `input(10)` into a timeframe.
    if (node.type === 'call' && (node.name === 'input.timeframe'
        || node.name === 'input.string' || node.name === 'input')) {
      const args = node.args || []
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]
        if (a && (a.name === 'defval' || (!a.name && i === 0))) {
          const folded = this.timeframeLiteralOf(a.value, depth + 1)
          if (folded !== null && node.tok) {
            this.usedInputs.set(`${node.tok.line}:${node.tok.column}`, {
              call: node.name,
              title: null,
              folded: `'${folded}'`,
              line: node.tok.line,
              column: node.tok.column,
            })
          }
          return folded
        }
      }
    }
    return null
  }

  /** A node that names THIS CHART'S SYMBOL → its spelling, or null.
   *
   *  ⭐ `tickerid = syminfo.tickerid` IS THE COMMON IDIOM and three community
   *  scripts use it. Refusing an alias while accepting the bare name would be
   *  refusing the same script written the way people actually write it.
   *  ⛔ A STRING literal is deliberately NOT followed: that is another SYMBOL,
   *  and this function answers only "is it the chart's OWN?";
   *  `otherSymbolNameOf` picks it up and it becomes a `sym` node.
   *  ⚰️ THIS SAID "and `sym` is not built". It is — and the shadowing case in
   *  `pine.security.test.js` asserts `tickerid = 'SPY'` translates AS SPY, so the
   *  comment contradicted the rail sitting directly beneath it. */
  ownSymbolNameOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.type === 'name') {
      // ⛔⛔ THE BINDING IS CONSULTED FIRST, AND THE ORDER IS THE WHOLE GUARD.
      // `syminfo.tickerid` is NAMESPACED and cannot be shadowed, but the v2/v3
      // spellings are bare identifiers that a script may reassign — and
      // `tickerid = 'SPY'` means SPY, not this chart. Checking the built-in list
      // first read that script as “this symbol” and translated it: a silent
      // mistranslation of exactly the kind this door exists to refuse. It was
      // caught by the shadowing CONTROL in `pine.security.test.js`, not by
      // review — and the comment that used to sit here asserted this very
      // ordering while the code did the opposite
      // (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
      const bound = this.env && this.env.get(node.name)
      if (bound) {
        return bound.kind === 'expr' ? this.ownSymbolNameOf(bound.node, depth + 1) : null
      }
      if (OWN_SYMBOL_NAMES.has(node.name)) return node.name
    }
    return null
  }

  /** A ticker this engine can name, or null.
   *
   *  ⛔ THE SHAPE IS THE SENTENCE GRAMMAR'S, not a guess. `sentence.js::renderSym`
   *  will only say a plain uppercase ticker of up to ten characters, so a symbol
   *  this accepted but that could not be SAID would translate into a tree whose
   *  read-back refuses — a definition a member could save and never see explained.
   *  ⚠️ WHICH IS WHY AN EXCHANGE-PREFIXED SYMBOL FALLS THROUGH. `BINANCE:BTCEUR`
   *  (community script 04) names an instrument on another venue; this engine reads
   *  US equities and ETFs, so refusing at THIS door — the one the member typed at —
   *  is the honest answer rather than emitting a node nothing can serve.
   */
  otherSymbolNameOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.type === 'string') {
      const ticker = String(node.value).trim().toUpperCase()
      // ⭐ READ, NEVER RE-TYPED — `parse.js` owns what a ticker may look like.
      return TICKER_SHAPE.test(ticker) ? ticker : null
    }
    if (node.type === 'name') {
      const bound = this.env && this.env.get(node.name)
      if (bound && bound.kind === 'expr') return this.otherSymbolNameOf(bound.node, depth + 1)
      return null
    }
    // ⭐ `input.symbol('SPY')` FOLDS TO ITS DEFAULT, the same way `input.timeframe`
    // does and for the same recorded reason: TradingView's own Pine Screener
    // "falls back to defaults for `input.symbol`". Every fold lands in
    // `usedInputs`, so a frozen input is never silent.
    if (node.type === 'call' && (node.name === 'input.symbol' || node.name === 'input.string')) {
      const args = node.args || []
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]
        if (a && (a.name === 'defval' || (!a.name && i === 0))) {
          const folded = this.otherSymbolNameOf(a.value, depth + 1)
          if (folded !== null && node.tok) {
            this.usedInputs.set(`${node.tok.line}:${node.tok.column}`, {
              call: node.name,
              title: null,
              folded: `'${folded}'`,
              line: node.tok.line,
              column: node.tok.column,
            })
          }
          return folded
        }
      }
    }
    return null
  }

  /** `request.security(<symbol>, <timeframe>, expr)` → the node it means, or null.
   *
   *  ⭐⭐ FOUR SHAPES, COMPOSED FROM TWO INDEPENDENT QUESTIONS — *whose bars?* and
   *  *which period?* — rather than four hand-written cases:
   *
   *    own symbol  + own timeframe  →  the child itself (the call is an identity)
   *    own symbol  + 'W' / 'M'      →  tf(child, code)
   *    OTHER       + own timeframe  →  sym(TICKER, child)
   *    OTHER       + 'W' / 'M'      →  sym(TICKER, tf(child, code))
   *
   *  ⛔⛔ AND THE LAST ROW IS WHY THIS IS COMPOSED RATHER THAN LISTED: `sym` must be
   *  the OUTER node. `tf(sym(…))` hands `sym` resampled bars while the benchmark
   *  series is not resampled, which `interpret` refuses by name because the answer
   *  would be almost-right rather than absent. Building the pair from two answers
   *  means this translator CANNOT emit the ordering the engine rejects — the shape
   *  rule is enforced by construction here, not re-stated.
   *
   *  ⭐ NULL, NEVER A REFUSAL OF ITS OWN. Returning null lets the caller fall through
   *  to `pine:request`, so every shape this cannot take keeps the ONE sentence the
   *  namespace already publishes.
   *
   *  ⛔⛔ `lookahead_on` STILL FALLS THROUGH TO REFUSED. Our `tf` is `lookahead_off`
   *  plus `[1]`; `barmerge.lookahead_on` asks for the bar the base bar is INSIDE.
   *  Translating it as if it were `off` would silently turn a look-ahead script into
   *  a look-behind one and backtest beautifully.
   */
  securityAsNode(node) {
    const args = node.args || []

    // ⚠️ EVERY ARGUMENT IS A `{name, value}` WRAPPER, because Pine has named
    // arguments — `name` is the label (`lookahead=`) or null for a positional
    // one, and `value` is the parsed node. Reading the wrapper as if it WERE the
    // node is how the first draft returned null for every shape, including the
    // ones it exists to take.
    // ⛔⛔ THIS USED TO BE `args.filter((a) => a && !a.name)`, WHICH DROPPED EVERY
    // NAMED ARGUMENT ON THE FLOOR. A fully-named request therefore had fewer than
    // three arguments left, returned null, and landed on `pine:request` — "another
    // symbol or another timeframe is outside what one screened column reads" —
    // which is FALSE about a call this door takes happily when the identical
    // arguments are written in order. Measured: `request.security(syminfo.ticker,
    // timeframe.period, close)` folds to "close"; the same call fully named was
    // refused. A member reading that sentence goes looking for a limit that does
    // not exist. See `REQUEST_SECURITY_ARGS` for the parameter order and its source.
    const placed = positionaliseSecurityArgs(args)
    if (!placed) return null
    const positional = placed.slice(0, 3)
    if (positional.some((p) => p === undefined)) return null

    // 1. WHOSE BARS: this chart's own, or a ticker we can name. Anything else —
    //    a computed symbol, another venue — falls through.
    const own = this.ownSymbolNameOf(positional[0])
    const other = own === null ? this.otherSymbolNameOf(positional[0]) : null
    if (own === null && other === null) return null

    // 2. WHICH PERIOD: the chart's own (`timeframe.period`) or a code `tf` can
    //    resample. A computed timeframe is exactly what the node shape forbids.
    const tfNode = positional[1]
    const sameTimeframe = this.ownTimeframeOf(tfNode) !== null
    let code = null
    if (!sameTimeframe) {
      const raw = this.timeframeLiteralOf(tfNode)
      code = raw === null ? null : PINE_TF_CODE[String(raw).trim().toUpperCase()]
      if (!code) return null
    }

    // 3. `lookahead`, wherever it appears.
    //
    // ⭐⭐ `lookahead_on` NOW TRANSLATES — TO `tf_live`, WHICH IS A DIFFERENT NODE
    // AND CARRIES A DIFFERENT BADGE. It used to refuse, and refusing was right
    // while the only higher-timeframe node we had was the CLOSED one: taking a
    // look-ahead script as if it were `lookahead_off` would have turned it into a
    // look-behind one that backtests beautifully and is wrong. That is the silent
    // mistranslation this door exists against, and nothing about it has softened.
    //
    // ⛔ WHAT CHANGED IS THAT WE CAN NOW SAY WHAT THE SCRIPT ACTUALLY ASKED FOR.
    // `tf_live` reads the period the bar is INSIDE, exactly as `lookahead_on`
    // does, and the linter derives `preview-repaints` from it — so the member gets
    // their script AND the honest label, instead of a refusal for a thing we could
    // model. ⚠️ An UNRECOGNISED lookahead spelling still falls through to refused:
    // this admits the two declared values, never "anything that isn't off".
    let live = false
    for (const a of args) {
      if (!a) continue
      const v = a.value
      const spelled = v && v.type === 'name' ? v.name : null
      const isLookahead = a.name === 'lookahead'
        || (typeof spelled === 'string' && spelled.includes('lookahead'))
      if (!isLookahead) continue
      if (spelled === 'barmerge.lookahead_on') live = true
      else if (spelled !== 'barmerge.lookahead_off') return null
    }

    // ⛔ AND A LOOK-AHEAD READ OF THE CHART'S OWN TIMEFRAME IS NOTHING TO MODEL:
    // there is no period to be part-way through, so `lookahead_on` at
    // `timeframe.period` is the identity the same way `lookahead_off` is.
    if (live && !code) live = false

    // 4. compose, innermost first.
    let out = this.resolve(positional[2])
    if (code) out = { type: live ? 'tf_live' : 'tf', value: code, args: [out] }
    if (other) out = { type: 'sym', value: other, args: [out] }
    return out
  }

  /**
   * ⭐⭐ A USER FUNCTION IS INLINED AT ITS CALL SITE, AND IT IS THE SAME
   * SUBSTITUTION A BINDING ALREADY GETS.
   *
   * `f(x) => expr` introduces no name this engine has to keep: the body was
   * folded to ONE expression when the definition was read, its parameters are
   * bindings like any other, and a call binds them to the argument nodes and
   * resolves. Nothing about the stored artifact changes — the formula that comes
   * out is the formula a member would have got by typing the body out by hand.
   *
   * ⛔ THE ARGUMENTS ARE BOUND, NOT RESOLVED. Binding them keeps the lazy rule
   * that made real scripts translate at all: an argument the body's live branch
   * never reads is never resolved, so `f_stateStr(s4)` cannot refuse a script
   * over an `s4` that only the dashboard touches.
   */
  inlineUserFunction(bound, node) {
    const name = node.name
    for (const arg of node.args) {
      if (arg.name) {
        throw new PineRefusal('pine:named-argument',
          `${REFUSALS['pine:named-argument']} — \`${arg.name}\` on \`${name}\`, which this `
          + `script defines as ${name}(${bound.params.join(', ')})`, locate(arg.tok || node.tok))
      }
    }
    if (node.args.length !== bound.params.length) {
      throw new PineRefusal('pine:arity',
        `${REFUSALS['pine:arity']} — \`${name}\` was given ${node.args.length} `
        + `argument${node.args.length === 1 ? '' : 's'} and this script defines it with `
        + `${bound.params.length}`, locate(node.tok))
    }
    if (this.frames.length >= MAX_CALL_DEPTH) {
      throw new PineRefusal('pine:cycle', `${REFUSALS['pine:cycle']} — \`${name}\``, locate(node.tok))
    }
    const callerEnv = this.env
    this.frames.push(node.args.map((a) => ({ kind: 'expr', node: a.value, env: callerEnv })))
    const prevEnv = this.env
    this.env = bound.value.env || prevEnv
    // ⛔ THROUGH `resolveBinding`, NOT `resolve(bound.value.node)`. A function's
    // value is a BINDING and only the plain `expr` kind carries a `.node` — so
    // reaching for one directly resolved `undefined` the moment a body ended in
    // anything else. Measured: a body ending in a `switch` produced a TypeError
    // that surfaced as `pine:statement`, which reads as "the translator cannot
    // parse this line" about a line it parsed perfectly well.
    //
    // ⚠️ THE ENV IS SET HERE AND SET AGAIN INSIDE, deliberately: `resolveBinding`
    // swaps to the binding's own env, which for an `expr` is the same object this
    // line just chose. Leaving both is what keeps every OTHER binding kind
    // reaching its own scope rather than the caller's.
    //
    // ⛔ AND THE `expr` KIND KEEPS THE DIRECT PATH, WHICH IS NOT AN OPTIMISATION.
    // `resolveBinding` guards against cycles with `this.stack`, and a function
    // called INSIDE ITSELF — `f(f(x))`, legal Pine and covered by
    // `pine.variables.test.js` — re-enters the same value binding. Routing the
    // common case through there reported `pine:cycle` for a call that simply
    // nests. Measured: it went red on the first attempt at this fix.
    try {
      return bound.value.kind === 'expr'
        ? this.resolve(bound.value.node)
        : this.resolveBinding(bound.value, node.tok, name)
    } finally { this.frames.pop(); this.env = prevEnv }
  }

  /** ⭐ THE DERIVED MAP. `pineName` is what the member wrote; `base` is it with a
   *  value namespace stripped; the MANIFEST decides whether the name exists, how
   *  many arguments it takes and what kind each one is. The only thing this
   *  module supplies is a ROLE ORDER, and only where one has been measured. */
  resolveTableCall(pineName, base, args, tok) {
    const shape = PINE_CALL_SHAPES[normaliseName(base)] || null
    const candidate = shape ? shape.table : base
    const key = this.index.get(normaliseName(candidate))
    const bare = normaliseName(base)
    // ⭐ AN EXACT EXPANSION BEATS A REFUSAL, and it is consulted only when the
    // table itself has no such name — so a future `roc` in `closedTable` wins.
    if (!key && own(BUILTIN_CALL_TREE, bare)) {
      // ⛔ NAMES REFUSE BEFORE ANYTHING IS RESOLVED — see `refuseUnmeasuredNamedArgs`.
      // `iff(then = close, condition = close > open, otherwise = open)` translated
      // to `close ? close > open : open` before this line existed.
      refuseUnmeasuredNamedArgs(pineName, args, tok, null)
      // ⛔ `.value` IS THE ARGUMENT NODE. An arg arrives as a wrapper (`{name,
      // value}`) so a named argument can be refused by name; handing the wrapper
      // to `resolve` throws, and the throw surfaces as a STATEMENT-level
      // `pine:statement` refusal — which reads as "the translator cannot parse
      // this line" rather than "the expansion is broken", and sent me looking at
      // the script template instead of at this expression.
      const built = args.map((a) => this.resolve(a.value !== undefined ? a.value : a))
      if (bare === 'roc' && (built.length !== 2 || built[1].type !== 'num')) {
        throw new PineRefusal('pine:window',
          `\`${pineName}\` needs a written whole-number length`, locate(tok))
      }
      if (bare === 'avg' && built.length < 2) {
        throw new PineRefusal('pine:arity',
          `\`${pineName}\` averages two or more values`, locate(tok))
      }
      if (bare === 'cross' && built.length !== 2) {
        // ⛔ ARITY IS CHECKED BEFORE THE EXPANSION RUNS, like its two neighbours.
        // `cross(x)` would otherwise build `crossOver(x, undefined)` and die in
        // `assertCanonical` with a message about node shape — a true sentence
        // about the wrong subject.
        throw new PineRefusal('pine:arity',
          `\`${pineName}\` crosses one series with another, and needs both`, locate(tok))
      }
      if (bare === 'linreg') {
        // ⛔ THE DOMAIN, CHECKED BEFORE THE EXPANSION AND NAMED. A regression needs
        // a LITERAL length of at least two: the closed form divides by `n−1`, and a
        // window of one bar has no line through it. Left to the builder this would
        // have returned `null` and travelled on as a tree-shaped nothing, dying
        // later in `assertCanonical` with a true sentence about the wrong subject.
        const nArg = built[1]
        const offArg = built[2]
        const n = nArg && nArg.type === 'num' ? Number(nArg.value) : NaN
        const off = offArg === undefined ? 0
          : (offArg && offArg.type === 'num' ? Number(offArg.value) : NaN)
        if (built.length < 2 || !Number.isInteger(n) || n < 2) {
          throw new PineRefusal('pine:arity',
            `\`${pineName}\` fits a line through a window of bars, so it needs a `
            + 'whole-number length of at least 2, written as a plain number',
            locate(tok))
        }
        if (!Number.isFinite(off)) {
          throw new PineRefusal('pine:arity',
            `\`${pineName}\`'s offset is how many bars back on the fitted line to `
            + 'read, so it must be a plain number too', locate(tok))
        }
      }
      return BUILTIN_CALL_TREE[bare](built)
    }
    // 🔴 NAMED AS INEXPRESSIBLE, WITH THE REASON — never resolved to a neighbour.
    //
    // ⛔⛔ AND THIS ONE IS **NOT** GATED ON `!key`, UNLIKE THE EXPANSIONS ABOVE.
    // The difference is what each list is FOR. `BUILTIN_CALL_TREE` holds exact
    // IDENTITIES, so a native entry of the same name is strictly better and
    // should win. `PINE_INEXPRESSIBLE` holds names whose PINE MEANING this engine
    // cannot say — and a table entry that happens to share the spelling does not
    // change that; it makes the near-miss REACHABLE, which is the whole failure
    // this list exists to prevent.
    //
    // ⚰️ MEASURED, NOT ARGUED. `barssince` landed in `closedTable.json` on
    // 2026-08-26 as the BOUNDED `barssince(condition, n)`, and with the `!key`
    // gate in place `ta.barssince(close > open)` stopped reporting the unbounded
    // reason and started reporting *"this table takes 2 — barssince(series,
    // int)"*. That reads as **"just add a number"**, and a member who adds one
    // gets a silently capped count under the name Pine gave an uncapped one.
    // `pine.derived.test.js` caught it; the gate is what stops it recurring for
    // the next same-named entry.
    //
    // ⛔ THE DISCRIMINATOR IS THE NAMESPACE THE MEMBER WROTE, NOT THE TABLE'S KEY
    // SET — and that correction came from a measured regression in the FIRST fix
    // for the above. Dropping `!key` entirely refused the BARE spelling too, so
    // `plot(barssince(close > open, 10))` was rejected by a message whose last
    // sentence is *"Write `barssince(condition, n)`"*. A refusal that recommends
    // the very thing the same door then rejects is worse than the near-miss it
    // was written to prevent.
    //
    //   `ta.barssince(…)`  -> namespaced          -> PINE'S meaning  -> REFUSE
    //   `barssince(…)`     -> bare, table HAS it  -> OUR vocabulary  -> resolve
    //   `cum(…)`           -> bare, table has NOT -> nothing else it -> REFUSE
    //                                                can mean, so keep the REASON
    //
    // ⛔ THE `|| !key` ARM IS NOT BELT-AND-BRACES: without it a bare `cum(volume)`
    // falls through to the generic *"this table declares abs, accum, adx, …"*
    // list, which is a true sentence that throws away the one thing the member
    // needed — that `cum` is a running total and `sum(source, n)` is the honest
    // alternative.
    //
    // ⚠️ WHAT THIS DOES NOT COVER, STATED RATHER THAN IMPLIED: a Pine v4 script
    // may spell a `ta.` builtin bare, and that spelling is then genuinely
    // ambiguous. `LEGACY_BARE_NAMESPACE` is this file's existing mechanism for
    // that decision and it is the pine lane's to widen; nothing here guesses.
    // ⭐ AN EXACT IDENTITY BEATS A REFUSAL, and this one is keyed on the SPELLING
    // the member wrote rather than on the table's name — see `PINE_NAMESPACED_TREE`.
    if (own(PINE_NAMESPACED_TREE, pineName)) {
      // ⛔ NAMES REFUSE BEFORE ANYTHING IS RESOLVED — see `refuseUnmeasuredNamedArgs`.
      // `ta.pivothigh(source = high, rightbars = 3, leftbars = 7)` translated to
      // `pivothigh(high, 3, 7)[7]` before this line existed.
      refuseUnmeasuredNamedArgs(pineName, args, tok, null)
      // ⚠️ RESOLVED HERE, because `built` above lives inside the expansion branch
      // and this gate sits outside it. Same call, same order — spelled out rather
      // than reached for, so the two cannot quietly become different lists.
      const resolved = args.map((a) => this.resolve(a.value !== undefined ? a.value : a))
      const shifted = PINE_NAMESPACED_TREE[pineName](resolved)
      if (shifted) return shifted
      throw new PineRefusal('pine:arity',
        `\`${pineName}\` returns its value \`rightbars\` after the pivot, so this `
        + 'engine has to know that number when it builds the formula — write it '
        + 'as a plain whole number', locate(tok))
    }
    if ((pineName !== base || !key) && own(PINE_INEXPRESSIBLE, bare)) {
      throw new PineRefusal('pine:function',
        `\`${pineName}\` is ${PINE_INEXPRESSIBLE[bare]}`, locate(tok))
    }
    if (!key) {
      throw new PineRefusal('pine:function',
        `${REFUSALS['pine:function']} — \`${pineName}\`. This table declares `
        + `${Object.keys(this.table.functions).sort().join(', ')}`, locate(tok))
    }
    const spec = this.table.functions[key]
    const declaredArgs = Array.isArray(spec.args) ? spec.args : []
    const seriesSlots = declaredArgs.filter((a) => a === 'series').length

    // ⭐⭐ NAMED ARGUMENTS BECOME POSITIONS HERE, AND NOWHERE ELSE. This replaced
    // a blanket loop that refused every named argument before a single one had
    // been looked at — safe, and too wide: it also refused the one mapping the
    // corpus and TradingView's docs both spell out. Everything below this line is
    // unchanged and cannot tell the result from a hand-written positional call,
    // which is what makes "a named argument can never reach a mapping a
    // positional call could not" a structural property rather than a promise.
    args = positionaliseNamed(pineName, bare, key, spec, declaredArgs, shape, args, tok)

    // ── the fill plan ──────────────────────────────────────────────────────
    let plan
    if (shape) {
      // ⛔ THE SHAPE IS CHECKED AGAINST THE MANIFEST, NOT TRUSTED. A declaration
      // here that no longer fits what the table declares is a STALE shape, and a
      // stale shape is exactly the misread this whole table exists to stop — so
      // it refuses rather than filling the first N positions and dropping the
      // rest.
      if (shape.build.length !== declaredArgs.length) {
        throw new PineRefusal('pine:role-order',
          `${REFUSALS['pine:role-order']} — \`${pineName}\` has a measured order for `
          + `${shape.build.length} positions and this table's \`${key}\` now takes `
          + `${declaredArgs.length} — ${signatureOf(key, spec)}`, locate(tok))
      }
      if (args.length !== shape.pineArity) {
        throw new PineRefusal('pine:arity',
          `${REFUSALS['pine:arity']} — \`${pineName}\` was given ${args.length} `
          + `argument${args.length === 1 ? '' : 's'} and Pine's own signature takes `
          + `${shape.pineArity}`, locate(tok))
      }
      plan = shape.build
    } else {
      if (seriesSlots > 1) {
        // ⭐⭐ FAIL CLOSED ON AN UNMEASURED ROLE ORDER. A function the indicator
        // agent adds tomorrow with two price arguments lands HERE, refused by
        // name, rather than being matched up by position and quietly returning
        // somebody else's number.
        throw new PineRefusal('pine:role-order',
          `${REFUSALS['pine:role-order']} — \`${key}\` takes ${seriesSlots} price series `
          + `(${signatureOf(key, spec)}) and no measured order maps \`${pineName}\` onto them`,
          locate(tok))
      }
      if (args.length !== declaredArgs.length) {
        throw new PineRefusal('pine:arity',
          `${REFUSALS['pine:arity']} — \`${pineName}\` was given ${args.length} `
          + `argument${args.length === 1 ? '' : 's'}; this table takes `
          + `${declaredArgs.length} — ${signatureOf(key, spec)}`, locate(tok))
      }
      plan = declaredArgs.map((_, i) => ({ pine: i }))
    }

    const out = []
    for (let i = 0; i < plan.length; i += 1) {
      const slot = plan[i]
      let resolved
      if (own(slot, 'series')) {
        if (!own(this.table.series, slot.series)) {
          throw new PineRefusal('pine:role-order',
            `${REFUSALS['pine:role-order']} — \`${pineName}\` needs an implicit `
            + `\`${slot.series}\` and this table declares none`, locate(tok))
        }
        resolved = cSeries(slot.series)
      } else {
        resolved = this.resolve(args[slot.pine].value)
      }
      if (declaredArgs[i] === 'int') {
        // ⭐ FOLDED FIRST, THEN CHECKED BY THE RULE THAT WAS ALWAYS HERE. `len / 2`
        // with `len = input(20)` arrives as an expression rather than a number;
        // reducing it means the guard below — and the canonical node at the end —
        // sees the same plain integer a written literal would have given them.
        // `foldWindow` can only substitute an exact non-negative whole number, so
        // everything this line does NOT accept meets the identical check, with the
        // identical sentence and token, that it met before the fold existed.
        resolved = foldWindow(resolved)
        // ⛔ A WINDOW MUST BE A LITERAL, AND THAT IS THE REPAINT LINTER'S RULE
        // RATHER THAN THIS MODULE'S TASTE. `lint.js::resolveDeclaration` returns
        // UNKNOWN for an `argK` that is not a `num` node, so a computed length
        // fails closed to `repaints` and the save door refuses it. Refusing here
        // names the length; refusing there would name the badge.
        if (resolved.type !== 'num' || !Number.isInteger(resolved.value)) {
          const src = own(slot, 'series') ? tok : (args[slot.pine].tok || tok)
          throw new PineRefusal('pine:window',
            `${REFUSALS['pine:window']} — argument ${i + 1} of \`${pineName}\``
            + fractionalWindowAdvice(resolved),
            locate(src))
        }
      }
      out.push(resolved)
    }
    return cCall(key, out)
  }

  /** `input.int(14, "RSI Length")` → `14`.
   *
   *  ⭐ FOLDED TO THE DEFAULT, AND THE REASON IS THE REPAINT BADGE. A length that
   *  is a per-instance knob makes `lint.js` answer UNKNOWN for the whole tree, so
   *  the definition could never be saved at all. TradingView's own screener does
   *  the same thing to the three inputs it cannot set. The fold is recorded and
   *  shown, never silent. */
  resolveInput(node) {
    const name = node.name
    const kind = name === 'input' ? 'input' : name.slice('input.'.length)
    const NUMERIC = new Set(['input', 'int', 'float', 'bool', 'source', 'price'])
    let defval = null
    let title = null
    for (let i = 0; i < node.args.length; i += 1) {
      const arg = node.args[i]
      if (arg.name === 'defval') defval = arg.value
      else if (arg.name === 'title') title = arg.value
      else if (!arg.name && defval === null && i === 0) defval = arg.value
      else if (!arg.name && title === null && i === 1) title = arg.value
    }
    if (!NUMERIC.has(kind)) {
      throw new PineRefusal('pine:input-kind',
        `${REFUSALS['pine:input-kind']} — \`${name}\``, locate(node.tok))
    }
    if (defval === null) {
      throw new PineRefusal('pine:input-kind',
        `${REFUSALS['pine:input-kind']} — \`${name}\` states no default`, locate(node.tok))
    }
    const resolved = this.resolve(defval)
    this.usedInputs.set(`${node.tok.line}:${node.tok.column}`, {
      call: name,
      title: title && title.type === 'string' ? title.value : null,
      folded: printFormula(resolved),
      line: node.tok.line,
      column: node.tok.column,
    })
    return resolved
  }
}

function signatureOf(key, spec) {
  const args = Array.isArray(spec.args) ? spec.args : []
  return `${key}(${args.join(', ')})`
}

/** The text a member wrote for one argument, for a sentence that quotes it. */
const argText = (a) => (a && a.tok && a.tok.value !== undefined ? String(a.tok.value) : '…')

/** A Pine argument list containing named arguments → the POSITIONAL list it
 *  means. Returns `args` untouched when nothing is named.
 *
 *  ⭐⭐ THE POINT IS THAT IT RETURNS POSITIONS, NOT A MAPPING. Everything
 *  downstream in `resolveTableCall` — the stale-shape check, both arity checks,
 *  `plan = shape.build`, the `int` window rule — then runs UNCHANGED on a call it
 *  cannot tell from one a member typed in order. So a named argument can never
 *  reach a mapping a positional call could not reach, and if a shape is ever
 *  removed the named form refuses at `pine:role-order` exactly like the positional
 *  one. That is a structural guarantee rather than a rule anybody has to remember.
 *
 *  ⛔ IT FAILS CLOSED, AND THAT PROPERTY IS THE WHOLE FEATURE. Without a
 *  `PINE_ARG_NAMES` entry there is no mapping, so there is a refusal — never a
 *  match by convention. `ta.stoch` lands here.
 *
 *  ⚠️ ARITY IS DELIBERATELY NOT ANSWERED HERE. A hole ("`ta.sma(length = 20)`")
 *  or a surplus falls through to the EXISTING arity check, so "how many arguments
 *  does this take" keeps ONE authority. That is safe by construction: every
 *  argument lands in at most one slot (a repeat is refused as a duplicate, an
 *  unknown name is refused outright), so an incomplete fill implies
 *  `args.length < arity` and a surplus implies `args.length > arity` — either way
 *  the arity check fires before anything dereferences a wrapper. */
function positionaliseNamed(pineName, bare, key, spec, declaredArgs, shape, args, tok) {
  // (a) THE ZERO-CHANGE CONTROL PATH. A call with no named argument is handed
  //     back byte-identical, so the overwhelming majority of scripts route
  //     through this function and are not touched by it.
  if (!args.some((a) => a && a.name)) return args

  const firstNamed = args.find((a) => a && a.name)

  // (b) NO MEASURED NAMES → REFUSE, NAMING THE UNBLOCKER.
  const entry = own(PINE_ARG_NAMES, bare) ? PINE_ARG_NAMES[bare] : null
  if (!entry) {
    throw new PineRefusal('pine:named-argument',
      `${REFUSALS['pine:named-argument']} — \`${pineName}\` has no measured parameter `
      + `names at this door, so \`${firstNamed.name} =\` cannot be matched onto a `
      + `position. Write its arguments in order — \`${signatureOf(key, spec)}\``,
      locate(firstNamed.tok || tok))
  }
  const names = entry.names

  // (c) ARITY AGREEMENT IS CHECKED, NOT TRUSTED — the same reasoning the
  //     stale-shape check carries. A names list that no longer matches the number
  //     of positions this door maps onto would fill the first N and drop the
  //     rest, which is a mistranslation wearing a declaration.
  const arity = shape ? shape.pineArity : declaredArgs.length
  if (names.length !== arity) {
    throw new PineRefusal('pine:role-order',
      `${REFUSALS['pine:role-order']} — \`${pineName}\` has ${names.length} declared `
      + `parameter name${names.length === 1 ? '' : 's'} and this door maps it onto `
      + `${arity} position${arity === 1 ? '' : 's'} — ${signatureOf(key, spec)}`,
      locate(tok))
  }

  const slots = new Array(names.length).fill(null)
  let positionals = 0
  let seenNamed = false
  for (const a of args) {
    if (!a) continue
    if (!a.name) {
      // (d) A POSITIONAL PREFIX IS FINE; A POSITIONAL AFTER A NAME IS NOT, and
      //     that is Pine's own rule rather than this door's taste.
      if (seenNamed) {
        throw new PineRefusal('pine:named-argument',
          `${REFUSALS['pine:named-argument']} — \`${argText(a)}\` is a positional `
          + `argument after a named one on \`${pineName}\`. Pine allows dropping the `
          + 'names off the FIRST arguments "as long as you don\'t skip any", so once '
          + 'a name is used every later argument needs one too',
          locate(a.tok || tok))
      }
      if (positionals < slots.length) slots[positionals] = a
      positionals += 1
      continue
    }
    seenNamed = true
    // (e) A NAME THIS FUNCTION DOES NOT HAVE, and a name given twice.
    const at = names.indexOf(a.name)
    if (at < 0) {
      throw new PineRefusal('pine:named-argument',
        `${REFUSALS['pine:named-argument']} — \`${pineName}\` takes `
        + `${names.map((n) => `\`${n}\``).join(', ')}; it has no \`${a.name}\``,
        locate(a.tok || tok))
    }
    if (slots[at]) {
      throw new PineRefusal('pine:named-argument',
        `${REFUSALS['pine:named-argument']} — \`${a.name}\` is given twice on `
        + `\`${pineName}\`, and a Pine call cannot include duplicate parameters`,
        locate(a.tok || tok))
    }
    slots[at] = a
  }

  // (f) A HOLE OR A SURPLUS IS ARITY'S BUSINESS — see the header. Handing back
  //     the original list means the existing check reports the count the member
  //     actually wrote rather than a count this function invented.
  if (positionals > slots.length) return args
  const filled = slots.filter((s) => s !== null)
  if (filled.length !== slots.length) return args
  return filled
}

/** 🔴 THE EXPANSION BRANCHES MATCH NOTHING BY NAME, SO THEY REFUSE NAMES.
 *
 * ⛔⛔ FOUND BY A CONTROL, AND IT WAS A LIVE SILENT MISTRANSLATION. Both
 * expansion branches read their arguments as `a.value !== undefined ? a.value : a`
 * — which takes the VALUE off a named wrapper and then uses its WRITTEN POSITION.
 * Measured on the build before this guard:
 *
 *   ta.pivothigh(source = high, rightbars = 3, leftbars = 7)
 *       →  pivothigh(high, 3, 7)[7]      ← left and right SWAPPED, confirmed 7
 *                                          bars late instead of 3
 *   iff(then = close, condition = close > open, otherwise = open)
 *       →  close ? close > open : open   ← the CONDITION and the THEN-arm
 *                                          swapped; the test is a price, so it is
 *                                          always true and the column answers 0/1
 *   ta.highestbars(length = 5, source = close)
 *       →  -highestbars(5, close)        ← a series in the int slot, because this
 *                                          branch never reaches the window guard
 *
 * Each one translated, printed a plausible read-back, passed the round-trip and
 * would have scanned. That is the `ta.stoch` failure again — a mapping by
 * convention — reached through a different door.
 *
 * ⭐ THE FIX IS A REFUSAL, NOT A TABLE, because there is nothing to put in a
 * table: no TradingView-hosted signature and no corpus call site evidences the
 * parameter names of `roc`, `avg`, `iff`, `cross`, `linreg`, `pivothigh`,
 * `pivotlow`, `highestbars` or `lowestbars`. When one of them IS evidenced it
 * belongs in `PINE_ARG_NAMES` with its citation, and this guard stops applying to
 * it — the same two-facts rule the table door uses.
 *
 * ⚠️ IT COSTS A CALL THAT USED TO WORK: `roc(source = close, length = 5)` in
 * Pine's own order translated correctly, by luck rather than by measurement. A
 * refusal that names the fix ("write its arguments in order") is the price of not
 * relying on that luck — and the same script one argument out of order is what
 * this is protecting. */
function refuseUnmeasuredNamedArgs(pineName, args, tok, signature) {
  const named = args.find((a) => a && a.name)
  if (!named) return
  throw new PineRefusal('pine:named-argument',
    `${REFUSALS['pine:named-argument']} — \`${pineName}\` is rewritten into this `
    + `engine's own vocabulary here, and nothing measures what Pine calls its `
    + `parameters, so \`${named.name} =\` cannot be matched onto a position. Write `
    + `its arguments in order${signature ? ` — \`${signature}\`` : ''}`,
    locate(named.tok || tok))
}

/** `request.security(symbol = …, timeframe = …)` → the same arguments in Pine's
 *  declared order, or `null` when this door cannot place one of them.
 *
 *  ⭐ NULL, NEVER A REFUSAL OF ITS OWN — `securityAsNode`'s existing contract, so
 *  every shape it cannot take keeps the ONE sentence the `request` namespace
 *  publishes rather than growing a second one to maintain.
 *
 *  ⛔ AN UNKNOWN NAME DECLINES THE WHOLE CALL, and that is a deliberate
 *  TIGHTENING. Before this existed an unrecognised named argument was silently
 *  DISCARDED as long as three positional ones were present — reading a request
 *  while ignoring a parameter we cannot name is precisely the silent
 *  mistranslation this door exists against. */
function positionaliseSecurityArgs(args) {
  const slots = new Array(REQUEST_SECURITY_ARGS.length).fill(undefined)
  let positionals = 0
  let seenNamed = false
  for (const a of args) {
    if (!a) continue
    if (!a.name) {
      if (seenNamed) return null
      if (positionals >= slots.length) return null
      slots[positionals] = a.value
      positionals += 1
      continue
    }
    seenNamed = true
    const canonical = own(REQUEST_SECURITY_ALIASES, a.name)
      ? REQUEST_SECURITY_ALIASES[a.name] : a.name
    const at = REQUEST_SECURITY_ARGS.indexOf(canonical)
    if (at < 0) return null
    if (slots[at] !== undefined) return null
    slots[at] = a.value
  }
  return slots
}

/** Pine built-in VARIABLES that name something with no column here. Used only to
 *  tell "a Pine name we know and cannot hold" apart from "a name your script
 *  never defined" — two different sentences for two different mistakes. */
/** The closed table's `clock` key for a Pine name, or `null`.
 *
 *  ⭐⭐ DERIVED FROM `TABLE.clock`, NEVER TYPED. This exists because the set
 *  below is hand-typed and the manifest moved under it: `tableVersion` 2 added a
 *  `clock` section, and this door kept answering as though those columns did not
 *  exist. Measured 2026-08-27, before this helper:
 *
 *    plot(time)                      -> pine:builtin   "the engine grammar does not hold"
 *    plot(year) / plot(hour)         -> pine:builtin   (same)
 *    plot(bar_index)                 -> pine:builtin   (same)
 *    plot(timeframe.isintraday ...)  -> pine:builtin   (same)
 *    plot(dayofweek)                 -> pine:undefined "your script never defined this"
 *    plot(ta.ema(close, 20))         -> OK             (control: the door works)
 *
 *  ⛔ The engine HOLDS every one of those columns. The first five said we cannot;
 *  `dayofweek` said the MEMBER made a mistake. This module's own comment says the
 *  set exists "to tell 'a Pine name we know and cannot hold' apart from 'a name
 *  your script never defined' -- two different sentences for two different
 *  mistakes" -- and it was giving the wrong one of its own two sentences.
 *
 *  ⚠️ THIS DOES NOT TRANSLATE ANYTHING. Binding a Pine clock name to the closed
 *  table's clock leaf is W3b's, deliberately. What changes here is only WHICH
 *  SENTENCE a member reads, and whether it names what would unblock it.
 */
const PINE_TO_CLOCK_SPELLING = Object.freeze({ bar_index: 'barindex' })

/** Pine clock names whose meaning is NOT ours, and the sentence that says why.
 *
 *  ⛔⛔ THIS IS THE HALF THAT MAKES THE BINDING BELOW SAFE. `engineClockKeyFor`
 *  answers "does the table hold a column with this NAME", which is a question about
 *  spelling. Binding on that alone would have been a silent mistranslation on the
 *  very first entry:
 *
 *    Pine `time`  = MILLISECONDS since 1970
 *    our  `time`  = SECONDS      since 1970   (`closedTable.json::clock.time`)
 *
 *  A script comparing `time > 1600000000000` would have compared a second-count
 *  against a millisecond literal and quietly answered `false` on every bar,
 *  forever, under a name we had just told the member we support. A factor of a
 *  thousand does not announce itself in a chart.
 *
 *  ⭐ SO A NAME IS BOUND ONLY WHERE THE MEANINGS MATCH, and where they do not the
 *  refusal names the DIFFERENCE rather than repeating "this door has not learned
 *  the leaf" — which was true yesterday and would be a lie today
 *  (`lesson_rail_the_sentence_not_just_the_guard`).
 *
 *  ⚠️ ONE ENTRY, AND THAT IS THE WHOLE LIST ON PURPOSE. The first draft also
 *  carried `timenow`, `time_close`, `time_tradingday` and `last_bar_time` — none
 *  of which our clock declares, so `engineClockKeyFor` returns null for them and
 *  this map could never be consulted. Four sentences that read as protection and
 *  could not fire. They already get the correct generic refusal ("names something
 *  the engine grammar does not hold"), which is true: we do not hold them at all.
 *  `time` is the only Pine clock name we hold under the same spelling and a
 *  different meaning, so it is the only one that needs saying. */
const PINE_CLOCK_MISMATCH = Object.freeze({
  time: 'in Pine a bar timestamp in MILLISECONDS since 1970, where this engine’s '
    + '`time` is SECONDS — a thousand-fold difference that would compare true '
    + 'against no literal a member wrote, on every bar, without ever looking wrong',
})

function engineClockKeyFor(name) {
  const clock = (TABLE && TABLE.clock) || {}
  const key = own(PINE_TO_CLOCK_SPELLING, name) ? PINE_TO_CLOCK_SPELLING[name] : name
  return typeof key === 'string' && !key.startsWith('_') && own(clock, key) ? key : null
}

/** ⭐ A CLOCK NAME IS A `series` LEAF, exactly as a bar field is —
 *  `parseFormula('dayofweek > 3')` produces `{type:'series', name:'dayofweek'}`,
 *  and `interpret` seeds the clock columns into the same scope as `close`. So
 *  binding one is not a new node type or a new code path; it is the resolution
 *  this door already performs for `close`, over a section it had not been told
 *  to read. The refusal it replaces said so itself: "TO UNBLOCK: teach this door
 *  to resolve a clock name the way it already resolves a series name". */
const clockLeaf = (key) => ({ type: 'series', name: key })

const clockNotWired = (name, key) =>
  `\`${name}\`: this engine HOLDS that column -- the closed table declares ` +
  `\`${key}\` in its clock section -- but this Pine door has not learned the ` +
  `clock leaf, so it cannot bind the name to it. TO UNBLOCK: teach this door to ` +
  `resolve a clock name the way it already resolves a series name; nothing new ` +
  `has to be measured or documented first.`

const PINE_KNOWN_BUILTINS = Object.freeze(new Set([
  'bar_index', 'time', 'time_close', 'time_tradingday', 'timenow',
  'year', 'month', 'weekofyear', 'dayofmonth', 'hour', 'minute', 'second',
  'na', 'last_bar_index', 'last_bar_time', 'first_bar_index',
  'open_time', 'volume_delta',
  // ⚠️ `interval` AND `period` ARE PINE v2/v3's NAMES FOR THE CHART RESOLUTION,
  // and they are here for the sentence, not the capability. Both were previously
  // MASKED: script 14 refused at `isintraday` first, so nothing downstream was
  // ever reached. Binding the clock names surfaced them — and the door then told
  // a member *"this Pine name was never given a value in the pasted script"*
  // about a builtin their platform defines, which is this file's own stated
  // defect ("two different sentences for two different mistakes") pointed the
  // wrong way. This engine genuinely cannot hold a resolution STRING, so
  // `pine:builtin` is the honest guard; `pine:undefined` was the wrong one.
  'interval', 'period',
]))

// --------------------------------------------------------------------------- //
// the program walk
// --------------------------------------------------------------------------- //

const chartOnlyNote = (word) => `\`${word}\` paints on a chart; TradingView's own screener `
  + 'reads plot() and alertcondition() and nothing else, so this line is ignored here too'

function noteOf(code, message, tok) {
  return { code, message, ...(locate(tok) || { line: null, column: null, index: null, token: null }) }
}

/** Every `IDENT :=` (and `+=`, …) anywhere in the token stream, including inside
 *  a block this module never reads. `name → every mutator token for it`.
 *
 *  ⭐⭐ THIS IS THE ONE THING THAT MAKES LAZY RESOLUTION SAFE, AND IT SURVIVED
 *  THE FOLD. Inlining a name's first binding while a `:=` further down changes it
 *  is the silent misread this whole module exists to make impossible, and a `:=`
 *  inside a `for` is exactly where it would hide. The scan is over TOKENS rather
 *  than over statements, so a construct the parser never understood cannot hide a
 *  reassignment from it.
 *
 *  ⛔ IT USED TO MARK EVERY MUTATED NAME OPAQUE AND STOP THERE. Now the walk
 *  FOLDS the reassignments it can read and records which mutator tokens it
 *  consumed — and `unconsumedMutations` puts the opacity back for every token it
 *  did not. The net is therefore still derived from the raw token stream and
 *  still fails closed; what changed is that a `:=` the walker genuinely
 *  understood no longer costs the member their script. */
function reassignedNames(tokens) {
  const out = new Map()
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if (tok.kind === 'punct' && MUTATORS.has(tok.value) && tokens[i - 1].kind === 'ident') {
      const name = tokens[i - 1].value
      if (!out.has(name)) out.set(name, [])
      out.get(name).push(tok)
    }
  }
  return out
}

/** The name a declaration binds — the identifier immediately before the `=`,
 *  unless that identifier is one of Pine's type words (`float x = 0.0`, where the
 *  walk-back has already passed `x`). */
function boundName(toks, eqIndex) {
  const tok = toks[eqIndex - 1]
  if (!tok || tok.kind !== 'ident' || TYPE_WORDS.has(tok.value)) return null
  return tok
}

// --------------------------------------------------------------------------- //
// ⭐⭐ THE FOLD — one bar's worth of statements, collapsed to one expression
// --------------------------------------------------------------------------- //
//
// ⭐ A SCREENER SCRIPT IS ONE EXPRESSION WITH NAMES ATTACHED, and the three
// shapes below are how a real one spells it:
//
//   len   = input.int(14)          a pure alias        → substitute
//   isHot = ta.rsi(close, len) > 70                    → substitute
//   dir = 0 / if up / dir := 1 / else / dir := -1      → a ternary
//   f(x) => ta.sma(x, 20)          a pure function     → substitute at the call
//
// None of those is STATE and none of them needs an engine change. What IS state
// is a value that survives the bar: `var count = 0` … `count := count + 1`, or
// any name whose new value reads `name[1]`. Those refuse at `pine:state`, by
// name, and the coverage map says what supporting them would take.
//
// ⛔ THE DISTINCTION IS "DOES IT DEPEND ON A PREVIOUS BAR", NOT "WHICH TOKEN WAS
// TYPED", and getting that backwards fails in both directions: judging by `:=`
// refuses working scripts, and judging by `var` alone lets `x = 0.0` /
// `x := nz(x[1]) + volume` through as if it were pure. Both tests are here —
// `var` is marked at its declaration, and `Resolver.guardOffsetOfMutable` catches
// the previous-bar read whether or not anybody wrote `var`.

/** A binding wrapper so a Pine sub-tree can carry the environment it was written
 *  in. `{type:'bound'}` is the only Pine node this module manufactures. */
const boundNode = (binding, name, tok) => ({ type: 'bound', binding, name, tok })

/** ⭐⭐ PINE'S `var` IS THE ENGINE'S `accum`, AND THIS IS THE WHOLE WIRE.
 *
 *  `var x = 0` / `x := x + 1` is bar-to-bar state, and the engine grew a
 *  bounded recurrence for exactly it. A `state` binding holds the SEED and the
 *  UPDATE separately, and reads of the name resolve differently depending on
 *  where they are:
 *
 *    - inside the update  → the running value's own past, `self`
 *    - anywhere else      → `accum(seed, update, warmup)`, the whole column
 *
 *  ⭐ AND THE COMPOSITION IS THE ENVIRONMENT MACHINERY THAT WAS ALREADY THERE.
 *  A second `x := g(x)` binds `x` inside its own right-hand side to the FIRST
 *  update, exactly the way `exprBinding` already freezes the previous binding —
 *  so `f` then `g` becomes `g(f(self))` with no new substitution pass. The base
 *  of that chain is `selfNode()` rather than the seed, and that one substitution
 *  is the entire difference between "a name that changes" and "a value that
 *  crosses a bar". */
const selfNode = (tok) => ({ type: 'selfref', tok })

/** `x := rhs` (or `x += e`) where `x` is already a recurrence.
 *
 *  ⭐ THE INNER BINDING IS THE WHOLE TRICK. Inside its own right-hand side, `x`
 *  means the value SO FAR THIS BAR — which is the previous update, whose own
 *  base is `selfref`. Binding it to that and letting the ordinary resolver walk
 *  the chain is what turns `x := f(x)` then `x := g(x)` into `g(f(self))`
 *  without a substitution pass of its own.
 *
 *  ⛔ AND `+=` DESUGARS THROUGH THE INNER BINDING, NOT THE OUTER ONE. Pointing
 *  its left operand at the state binding would make `x += 1` mean
 *  `accum(...) + 1` — a whole column plus one, evaluated inside its own update.
 *  That is a cycle, and the one it would produce reads plausibly. */
const reassignState = (prior, env, toks, mut, nameTok) => {
  const rhs = parseWholeExpression(toks.slice(mut + 1))
  const op = toks[mut].value
  const innerEnv = new Map(env)
  const inner = { kind: 'expr', node: prior.update, env: prior.updateEnv, at: prior.at }
  innerEnv.set(nameTok.value, inner)
  const update = op === ':='
    ? rhs
    : {
      type: 'binary',
      op: op[0],
      left: boundNode(inner, nameTok.value, nameTok),
      right: rhs,
      tok: toks[mut],
    }
  return stateBinding(prior.seed, prior.seedEnv, update, innerEnv, prior.at)
}

const stateBinding = (seed, seedEnv, update, updateEnv, at) => ({
  kind: 'state', seed, seedEnv, update, updateEnv, at,
})

/** How many bars of history a translated `var` accumulates over.
 *
 *  ⚠️⚠️ THIS IS AN ASSUMPTION, AND IT IS STATED RATHER THAN HIDDEN BECAUSE IT
 *  CANNOT BE ELIMINATED. Pine's `var` accumulates from the first bar the chart
 *  ever loaded; `accum` is bounded ON PURPOSE, because a value that depends on
 *  where a fetch happened to start is a value that changes when a member pans
 *  (see `closedTable.json::_functions_recurrence`). One of the two has to give,
 *  and it is not going to be the one that keeps the number honest.
 *
 *  ⭐ 250 IS ONE TRADING YEAR, and for what real scripts actually accumulate —
 *  a trailing stop, a streak, a high since a reset, a state machine — the two
 *  agree EXACTLY once the warm-up has passed, because those recurrences forget
 *  where they started. ⛔ FOR A TRUE BAR COUNTER THEY NEVER AGREE, and no finite
 *  number would make them: `var n = 0` / `n := n + 1` reads 250 here and reads
 *  the bar index in Pine. That is a real difference, it is in the member-visible
 *  note, and pretending otherwise would be the lie.
 *
 *  ⚠️ IT IS ALSO WHY A LONG SCRIPT CAN STILL MEET `budget:lookback`: 250 plus
 *  whatever the update itself reaches. That refusal is accurate — the script
 *  wants more history than this engine will hold — and it names itself. */
const PINE_STATE_WARMUP = 250

const exprBinding = (node, env, at) => ({ kind: 'expr', node, env, at })

/** The `if` / `else if` / `else` statements at `i`, re-joined into one chain.
 *  ⚠️ They arrive as SEPARATE statements at the same indent because that is how
 *  Pine is written; joining them here keeps `blockStatements` free of any
 *  knowledge of what the words mean. */
function ifBranches(stmts, i) {
  const branches = []
  const head = stmts[i].header
  const at = findTop(head, (t) => t.kind === 'ident' && t.value === 'if')
  if (at < 0) return null
  branches.push({ condToks: head.slice(at + 1), sub: stmts[i].sub, tok: head[at] })
  let j = i + 1
  while (j < stmts.length) {
    const h = stmts[j].header
    if (!h.length || h[0].kind !== 'ident' || h[0].value !== 'else') break
    const inner = findTop(h, (t) => t.kind === 'ident' && t.value === 'if')
    if (inner > 0) {
      branches.push({ condToks: h.slice(inner + 1), sub: stmts[j].sub, tok: h[inner] })
      j += 1
    } else {
      branches.push({ condToks: null, sub: stmts[j].sub, tok: h[0] })
      j += 1
      break
    }
  }
  return { branches, next: j }
}

/** Fold one `if` chain into (a) a new binding for every OUTER name any branch
 *  reassigns, and (b) the chain's own value, for `x = if …`.
 *
 *  ⛔ A NAME A BRANCH DECLARES FRESH DOES NOT ESCAPE IT. Only names that already
 *  existed before the `if` are rebound — `float entry = close` inside a branch is
 *  a local, and letting it leak would invent a binding Pine does not have. */
function foldIfChain(stmts, i, ctx, env) {
  const chain = ifBranches(stmts, i)
  if (!chain) throw new PineRefusal('pine:block', REFUSALS['pine:block'], locate(stmts[i].header[0]))
  const before = new Map(env)
  const arms = []
  for (const br of chain.branches) {
    const cond = br.condToks ? parseWholeExpression(br.condToks) : null
    const branchEnv = new Map(before)
    const value = foldStatements(br.sub, ctx, branchEnv)
    arms.push({ cond, env: branchEnv, value, tok: br.tok })
  }
  const hasElse = chain.branches[chain.branches.length - 1].condToks === null

  const touched = new Set()
  for (const arm of arms) {
    for (const key of arm.env.keys()) {
      if (before.has(key) && arm.env.get(key) !== before.get(key)) touched.add(key)
    }
  }

  for (const name of touched) {
    const wasState = before.get(name)
    const armsAgree = wasState && wasState.kind === 'state' && arms.every((a) => {
      const b = a.env.get(name)
      return b && b.kind === 'state' && b.seed === wasState.seed
    })

    // ⭐⭐ A RECURRENCE FOLDS INSIDE ITS UPDATE, NOT AROUND ITS ACCUMULATOR, AND
    // GETTING THIS BACKWARDS PRODUCES A PLAUSIBLE WRONG ANSWER RATHER THAN A
    // REFUSAL. `var c = 0` / `if close > open` / `c := c + 1` must become
    // `accum(0, close > open ? self + 1 : self, W)` — one running count. Built
    // the ordinary way it becomes `close > open ? accum(0, self + 1, W) :
    // accum(0, self, W)`, which is TWO different accumulators selected per bar:
    // on a down day it shows the seed carried forward and on an up day a count
    // that assumed EVERY bar was up. Both draw a line. Neither is the script.
    //
    // ⛔ THE GUARD IS THAT EVERY ARM IS THE SAME RECURRENCE — same binding kind,
    // same seed OBJECT. A branch that rebound the name to something else is not
    // a reassignment of this accumulator and must not be folded into its update.
    if (armsAgree) {
      const asUpdate = (b, tok) => boundNode(
        { kind: 'expr', node: b.update, env: b.updateEnv, at: b.at }, name, tok)
      let update = hasElse
        ? asUpdate(arms[arms.length - 1].env.get(name), arms[arms.length - 1].tok)
        : asUpdate(wasState, chain.branches[0].tok)
      for (let k = arms.length - (hasElse ? 2 : 1); k >= 0; k -= 1) {
        update = {
          type: 'ternary',
          test: arms[k].cond,
          yes: asUpdate(arms[k].env.get(name), arms[k].tok),
          no: update,
          tok: arms[k].tok,
        }
      }
      env.set(name, stateBinding(
        wasState.seed, wasState.seedEnv, update, new Map(before), wasState.at))
      continue
    }

    const armBinding = (arm) => boundNode(arm.env.get(name), name, arm.tok)
    let node = hasElse
      ? armBinding(arms[arms.length - 1])
      : boundNode(before.get(name), name, chain.branches[0].tok)
    for (let k = arms.length - (hasElse ? 2 : 1); k >= 0; k -= 1) {
      node = { type: 'ternary', test: arms[k].cond, yes: armBinding(arms[k]), no: node, tok: arms[k].tok }
    }
    env.set(name, exprBinding(node, before, locate(chain.branches[0].tok)))
  }

  // The chain's own value — only ever read by `x = if …`.
  let value = null
  const arm0 = arms[0]
  if (hasElse ? arms.every((a) => a.value) : false) {
    value = boundNode(arms[arms.length - 1].value, null, arm0.tok)
    for (let k = arms.length - 2; k >= 0; k -= 1) {
      value = { type: 'ternary', test: arms[k].cond, yes: boundNode(arms[k].value, null, arms[k].tok), no: value, tok: arms[k].tok }
    }
    value = exprBinding(value, before, locate(arm0.tok))
  }
  return { value, next: chain.next }
}

/** Consume every mutator token in a token span, so the closing pass knows the
 *  walk accounted for it. */
function consumeMutators(ctx, toks) {
  for (let i = 1; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind === 'punct' && MUTATORS.has(tok.value) && toks[i - 1].kind === 'ident') {
      ctx.consumed.add(tok.index)
    }
  }
}

/** Every name a token span reassigns. */
function mutatorTargets(toks) {
  const out = new Set()
  for (let i = 1; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind === 'punct' && MUTATORS.has(tok.value) && toks[i - 1].kind === 'ident') {
      out.add(toks[i - 1].value)
    }
  }
  return out
}

/** The parameter names of `f(a, b) =>`, or null if the header is not that shape. */
function functionParams(toks, arrow) {
  if (toks.length < 3 || toks[0].kind !== 'ident' || !isPunct(toks[1], '(')) return null
  const close = toks.findIndex((t) => isPunct(t, ')'))
  if (close < 0 || close > arrow) return null
  const params = []
  for (let i = 2; i < close; i += 1) {
    const t = toks[i]
    if (isPunct(t, ',')) continue
    if (t.kind !== 'ident') return null
    if (TYPE_WORDS.has(t.value) && toks[i + 1] && toks[i + 1].kind === 'ident') continue
    params.push(t.value)
  }
  return params
}

/**
 * A statement list (a function body, or a block body) → the binding its LAST
 * bare expression evaluates to, threading `env` as it goes.
 *
 * ⛔ IT THROWS. Unlike the program walk it has no notion of "a statement nothing
 * reaches" — every statement in a body the outputs reached is on the path by
 * construction, so the first thing it cannot fold refuses the body, and the
 * caller decides whether that refuses the script or only a name.
 */
function foldStatements(stmts, ctx, env) {
  let value = null
  let i = 0
  while (i < stmts.length) {
    const st = stmts[i]
    const toks = st.header
    const first = toks[0]
    if (!first) { i += 1; continue }

    if (first.kind === 'ident' && STATE_KEYWORDS.has(first.value)) {
      // ⭐ `var x = seed` BINDS A RECURRENCE, IT NO LONGER REFUSES. The seed is
      // whatever follows the `=`; the update starts as the value's own past, so
      // a `var` that is never reassigned reads back as a value that simply
      // carries — which is what Pine means by it.
      //
      // ⛔ `varip` STILL REFUSES, AND THE DIFFERENCE IS NOT COSMETIC. It persists
      // across INTRABAR TICKS, so its value depends on how many times a forming
      // bar updated — the one thing a closed-bar engine can never reproduce and
      // the exact shape `ALERT_EVAL_MODE="closed"` exists to remove.
      const eqAt = findTop(toks, (t) => isPunct(t, '='))
      const varName = eqAt > 0 ? boundName(toks, eqAt) : null
      if (first.value !== 'var' || !varName || eqAt < 0) {
        throw new PineRefusal('pine:state',
          `${REFUSALS['pine:state']} — \`${first.value}\``, locate(first))
      }
      const seedNode = parseWholeExpression(toks.slice(eqAt + 1))
      env.set(varName.value, stateBinding(
        seedNode, new Map(env), selfNode(varName), new Map(env), locate(varName)))
      i += 1
      continue
    }
    if (first.kind === 'ident' && TYPE_KEYWORDS.has(first.value)) {
      throw new PineRefusal('pine:type', REFUSALS['pine:type'], locate(first))
    }
    // ⭐⭐ A `switch` ON A FIXED SUBJECT IS ONE ARM. Published indicators lean on
    // this hard: `f_smooth(x, len, mode)` with `mode` an `input.string("EMA", …)`
    // is a menu a member picks from once, not a branch that moves bar to bar.
    // Every arm but the chosen one is dead the moment the input folds.
    //
    // ⛔ THE ARM IS PICKED AT RESOLVE TIME, NOT HERE. Choosing now would need the
    // subject's VALUE, and a name is not resolvable while the walk is still
    // binding names — the same reason a tuple's parts are held rather than
    // chosen. So the whole `switch` becomes ONE binding carrying its subject and
    // its arms, and `resolveBinding` reduces it once the subject can be read.
    if (first.kind === 'ident' && first.value === 'switch' && toks.length > 1) {
      const arms = []
      let fallback = null
      let usable = true
      for (const arm of (st.sub || [])) {
        const at = findTop(arm.header, (t) => isPunct(t, '=>'))
        if (at < 0) { usable = false; break }
        const rhs = arm.header.slice(at + 1)
        const binding = rhs.length
          ? exprBinding(parseWholeExpression(rhs), new Map(env), locate(arm.header[0]))
          : (arm.sub && arm.sub.length ? foldStatements(arm.sub, ctx, new Map(env)) : null)
        if (!binding) { usable = false; break }
        // A bare `=>` with nothing before it is Pine's default arm.
        if (at === 0) fallback = binding
        else arms.push({ match: arm.header.slice(0, at), binding })
      }
      if (usable && (arms.length || fallback)) {
        value = {
          kind: 'switch',
          subject: parseWholeExpression(toks.slice(1)),
          env: new Map(env),
          arms,
          fallback,
          at: locate(first),
        }
        i += 1
        continue
      }
    }
    if (first.kind === 'ident' && (first.value === 'for' || first.value === 'while' || first.value === 'switch')) {
      throw new PineRefusal('pine:block',
        `${REFUSALS['pine:block']} — \`${first.value}\``, locate(first))
    }
    if (first.kind === 'ident' && first.value === 'if' && findTop(toks, (t) => isPunct(t, '=')) < 0) {
      const folded = foldIfChain(stmts, i, ctx, env)
      consumeMutators(ctx, st.body)
      for (let k = i + 1; k < folded.next; k += 1) consumeMutators(ctx, stmts[k].body)
      value = folded.value || value
      i = folded.next
      continue
    }
    if (findTop(toks, (t) => isPunct(t, '=>')) >= 0) {
      throw new PineRefusal('pine:function-def', REFUSALS['pine:function-def'], locate(first))
    }

    const mut = findTop(toks, (t) => t.kind === 'punct' && MUTATORS.has(t.value))
    if (mut > 0) {
      const nameTok = toks[mut - 1]
      const op = toks[mut].value
      const prior = env.get(nameTok.value)
      if (!prior || prior.kind === 'opaque') {
        throw new PineRefusal(prior ? prior.guard : 'pine:reassign',
          prior ? prior.message : `${REFUSALS['pine:reassign']} — \`${nameTok.value}\``,
          prior ? prior.at : locate(toks[mut]))
      }
      if (prior.kind === 'state') {
        env.set(nameTok.value, reassignState(prior, env, toks, mut, nameTok))
        ctx.consumed.add(toks[mut].index)
        i += 1
        continue
      }
      const rhs = parseWholeExpression(toks.slice(mut + 1))
      // `x += e` is `x := x + e`, and the `x` on the right is the binding that
      // was in scope a moment ago — which `boundNode` freezes.
      const node = op === ':='
        ? rhs
        : {
          type: 'binary',
          op: op[0],
          left: boundNode(prior, nameTok.value, nameTok),
          right: rhs,
          tok: toks[mut],
        }
      env.set(nameTok.value, exprBinding(node, new Map(env), locate(nameTok)))
      ctx.consumed.add(toks[mut].index)
      i += 1
      continue
    }

    const eq = findTop(toks, (t) => isPunct(t, '='))
    if (eq > 0 && boundName(toks, eq)) {
      const nameTok = boundName(toks, eq)
      const rhs = toks.slice(eq + 1)
      if (rhs.length === 0) {
        throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(first))
      }
      if (rhs[0].kind === 'ident' && rhs[0].value === 'if') {
        const folded = foldIfChain(stmts, i, ctx, env)
        consumeMutators(ctx, st.body)
        for (let k = i + 1; k < folded.next; k += 1) consumeMutators(ctx, stmts[k].body)
        if (!folded.value) {
          throw new PineRefusal('pine:block',
            `${REFUSALS['pine:block']} — \`${nameTok.value} = if …\` has a branch with no value`,
            locate(rhs[0]))
        }
        env.set(nameTok.value, folded.value)
        i = folded.next
        continue
      }
      env.set(nameTok.value, exprBinding(parseWholeExpression(rhs), new Map(env), locate(nameTok)))
      i += 1
      continue
    }

    // ⭐⭐ A BARE `[a, b, c]` AT THE END OF A BODY IS A TUPLE RETURN — the last
    // structural gap between a pasted script and this engine. User-defined
    // functions already inline (multi-statement bodies and locals included), so
    // all a tuple needs is somewhere to put its parts; each element folds in the
    // function's own scope exactly like any other expression.
    //
    // ⛔ MEASURED BEFORE IT WAS BUILT. Across the corpus a destructure's
    // right-hand side is 42x `request.security`, ~19x user-defined and ONCE a
    // builtin — so this is deliberately the user-defined path and nothing else.
    if (isPunct(first, '[') && findTop(toks, (t) => isPunct(t, '=')) < 0) {
      const close = matchBracket(toks, 0)
      if (close > 0) {
        const inner = toks.slice(1, close)
        const parts = splitTopLevel(inner, ',')
          .filter((part) => part.length)
          .map((part) => exprBinding(parseWholeExpression(part), new Map(env), locate(first)))
        // ⛔ TWO OR MORE. `[x]` is a one-element list, not a tuple, and treating
        // it as one would give a destructure a shape Pine never wrote.
        if (parts.length > 1) {
          value = { kind: 'tuple', parts, at: locate(first) }
          i += 1
          continue
        }
      }
    }

    // A bare expression. In a function body the LAST one is the value; anywhere
    // else it is a side effect (`label.new(…)`) that nothing reads.
    value = exprBinding(parseWholeExpression(toks), new Map(env), locate(first))
    i += 1
  }
  return value
}

/**
 * Pine source → the outputs a screener could filter on, each with the formula
 * text this engine would run, or a refusal that names its own token.
 *
 * NEVER THROWS. A refusal is a value, for the reason `parseFormula` never throws:
 * the surface is a text box somebody just pasted into, and a throw reaches React
 * as a blank screen.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {object} [opts.table] the manifest to translate against. Defaults to the
 *        shipped `closedTable.json`; a test may hand a different one, which is how
 *        "the mapping is derived" is measured rather than asserted.
 * @returns {{
 *   ok: boolean,
 *   version: number|null,
 *   declaration: string|null,
 *   title: string|null,
 *   outputs: Array<object>,
 *   selected: number,
 *   notes: Array<object>,
 *   refusal: object|null,
 *   refusals: Array<object>,
 * }}
 */
export function translatePine(source, opts = {}) {
  const table = opts.table || TABLE
  const blank = {
    ok: false, version: null, declaration: null, title: null,
    outputs: [], selected: -1, notes: [], refusal: null, refusals: [],
  }

  if (typeof source !== 'string' || source.trim() === '') {
    return { ...blank, refusal: refusalValue('pine:empty', REFUSALS['pine:empty'], null), refusals: [refusalValue('pine:empty', REFUSALS['pine:empty'], null)] }
  }

  let lexed
  try {
    lexed = lexPine(source)
  } catch (err) {
    const r = fromError(err)
    return { ...blank, refusal: r, refusals: [r] }
  }

  const { tokens, indents, version, lines } = lexed
  if (tokens.length === 0) {
    const r = refusalValue('pine:empty', REFUSALS['pine:empty'], null)
    return { ...blank, version, refusal: r, refusals: [r] }
  }

  const env = new Map()
  const declaredTypes = new Map()
  const notes = []
  const outputs = []
  let declaration = null
  let title = null
  const hardRefusals = []

  // ⭐ EVERY REASSIGNMENT FIRST, over raw tokens, before a single statement is
  // read. See `reassignedNames` — the walk folds what it can and this map is what
  // the closing pass measures it against.
  const reassigned = reassignedNames(tokens)
  const ctx = { consumed: new Set() }
  /** name → the refusal the fold hit, so the closing pass can report the REAL
   *  reason instead of the generic one. */
  const unfoldable = new Map()

  /** ⛔ `at` IS A LOCATOR, NEVER A TOKEN THIS FUNCTION PICKED. When a binding
   *  fails to parse, the refusal that comes back ALREADY points at the offending
   *  token — passing the statement's first token instead would move every caret
   *  to the start of the line, which is how a refusal stops being actionable.
   *  This was measured on the corpus: six scripts reported `close[1]` at the
   *  wrong column before the locator was threaded through. */
  const markOpaque = (name, guard, at, extra, isFunction = false) => {
    if (!name) return
    if (env.has(name) && env.get(name).kind === 'opaque') return
    env.set(name, {
      kind: 'opaque',
      guard,
      isFunction,
      message: `${REFUSALS[guard]}${extra ? ` — ${extra}` : ''}`,
      at: at || null,
    })
  }

  /** Force opacity even over an existing opaque — used only by the closing pass,
   *  which is allowed to overrule anything the walk decided. */
  const forceOpaque = (name, guard, at, extra) => {
    env.set(name, {
      kind: 'opaque',
      guard,
      isFunction: false,
      message: `${REFUSALS[guard]}${extra ? ` — ${extra}` : ''}`,
      at: at || null,
    })
  }

  // ⚠️ STATEMENT GROUPING CAN REFUSE, and its refusal must arrive as a
  // refusal VALUE like every other. `blockStatements` throws on a top-level comma
  // it cannot split, and an escaping PineRefusal would reach a member as a 500
  // instead of a sentence — the exact shape the community corpus gate asserts
  // against ("refuses BY A DECLARED GUARD, never by throwing"). Same handling the
  // lexer's throw already gets, twenty lines above.
  let stmts
  try {
    stmts = blockStatements(tokens, indents, 0)
  } catch (err) {
    const r = fromError(err)
    return { ...blank, version, refusal: r, refusals: [r] }
  }
  let si = 0
  while (si < stmts.length) {
    const stmt = stmts[si]
    si += 1
    const toks = stmt.header
    const first = toks[0]

    // `[a, b] = f()` — a tuple destructure.
    if (isPunct(first, '[')) {
      const close = toks.findIndex((t) => isPunct(t, ']'))
      const names = toks.slice(1, close < 0 ? toks.length : close)
        .filter((t) => t.kind === 'ident' && !TYPE_WORDS.has(t.value))

      // ⭐⭐ `ta.dmi(diLen, adxLen)` — THE ONE BUILTIN TUPLE IN THE CORPUS, and it
      // is an exact mapping rather than a judgement: Pine answers
      // `[+DI, -DI, ADX]` and this table declares all three by name.
      //
      // ⛔ THE TWO PERIODS MUST MATCH. Pine smooths the ADX over its SECOND
      // argument while the DI legs use the first; this table's `adx` takes one
      // period for both. `ta.dmi(14, 20)` therefore refuses rather than quietly
      // returning a 14/14 ADX — the identical decision `ADX14.20` already makes
      // on the TC2000 side, and the same reason: a member who asked for 14/20
      // must not be shown a number that is not the indicator they asked for.
      const dmi = close >= 0 && eqAtDmi(toks, close) >= 0
        ? dmiParts(toks, close, names, env, first)
        : null
      if (dmi) {
        names.forEach((n, k) => env.set(n.value, dmi[k]))
        continue
      }

      // ⭐ A TUPLE-RETURNING USER FUNCTION HANDS OUT ITS PARTS BY POSITION.
      // `[a, b] = f(x)` makes `a` element 0 of that call and `b` element 1; the
      // call itself is inlined per part by `resolveBinding`'s `tuplePart` arm.
      //
      // ⛔⛔ THE `kind === 'tuple'` CHECK IS THE WHOLE SAFETY OF THIS FEATURE.
      // Without it `request.security` — 42 of the 63 destructures in this corpus
      // — would hand its FIRST element to a name expecting its third: a
      // translation that parses, lints, saves, scans and is silently WRONG.
      // Anything this engine cannot take apart must keep refusing by name.
      const eq = close >= 0 ? close + 1 + findTop(toks.slice(close + 1), (t) => isPunct(t, '=')) : -1
      if (close >= 0 && eq > close && names.length > 0) {
        const rhs = toks.slice(eq + 1)
        let call = null
        try { call = parseWholeExpression(rhs) } catch { call = null }
        const callee = call && call.type === 'call' ? env.get(call.name) : null
        const value = callee && callee.kind === 'fn' ? callee.value : null
        if (value && value.kind === 'tuple' && value.parts.length >= names.length) {
          const callerEnv = new Map(env)
          names.forEach((n, k) => env.set(n.value, {
            kind: 'tuplePart', fn: callee, args: call.args, index: k,
            env: callerEnv, at: locate(n),
          }))
          continue
        }
      }

      for (const n of names) markOpaque(n.value, 'pine:tuple', locate(first), `\`${n.value}\``)
      notes.push(noteOf('pine:tuple', REFUSALS['pine:tuple'], first))
      continue
    }

    if (first.kind !== 'ident') {
      notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
      continue
    }

    const word = first.value

    // ── declarations ──────────────────────────────────────────────────────
    if ((word === 'indicator' || word === 'study') && isPunct(toks[1], '(')) {
      declaration = word
      const firstString = toks.find((t) => t.kind === 'string')
      title = firstString ? firstString.value : null
      notes.push(noteOf('pine:declaration',
        'the indicator() declaration decides how a chart draws, and a screen reads none of it',
        first))
      continue
    }
    if (word === 'strategy' && isPunct(toks[1], '(') && toks.some((t) => t.kind === 'string')) {
      hardRefusals.push(refusalValue('pine:declaration-strategy',
        REFUSALS['pine:declaration-strategy'], locate(first)))
      continue
    }
    if (word === 'library' && isPunct(toks[1], '(')) {
      hardRefusals.push(refusalValue('pine:declaration-library',
        REFUSALS['pine:declaration-library'], locate(first)))
      continue
    }
    if (word === 'import' || word === 'export') {
      hardRefusals.push(refusalValue('pine:module', REFUSALS['pine:module'], locate(first)))
      continue
    }

    // ── things that bind a name this engine cannot fold ────────────────────
    if (STATE_KEYWORDS.has(word)) {
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      // ⭐ THE SAME BINDING THE BODY WALKER MAKES — see `stateBinding`. ⛔ And the
      // same `varip` exclusion, for the same reason: it persists across INTRABAR
      // TICKS, which a closed-bar engine cannot reproduce at all.
      if (word === 'var' && nameTok && eq > 0) {
        try {
          env.set(nameTok.value, stateBinding(
            parseWholeExpression(toks.slice(eq + 1)),
            new Map(env), selfNode(nameTok), new Map(env), locate(nameTok)))
          continue
        } catch (err) {
          const r = fromError(err)
          markOpaque(nameTok.value, r.guard,
            { line: r.line, column: r.column, index: r.index, token: r.token },
            `\`${nameTok.value}\``)
          notes.push({ ...r, code: r.guard })
          continue
        }
      }
      markOpaque(nameTok && nameTok.value, 'pine:state', locate(first),
        nameTok ? `\`${nameTok.value}\`` : null)
      notes.push(noteOf('pine:state', REFUSALS['pine:state'], first))
      continue
    }
    if (TYPE_KEYWORDS.has(word)) {
      // ⭐ REMEMBER THE NAME. `type Point` makes `Point.new(…)` and `p.x` mean
      // something this module can refuse ACCURATELY instead of calling them an
      // unknown Pine namespace.
      const named = toks[1]
      if (named && named.kind === 'ident') declaredTypes.set(named.value, locate(named))
      notes.push(noteOf('pine:type', REFUSALS['pine:type'], first))
      continue
    }
    // ⭐⭐ A TOP-LEVEL `if` IS FOLDED, NOT SKIPPED. `dir = 0` / `if up` /
    // `dir := 1` / `else` / `dir := -1` is a ternary written across five lines,
    // and it is how most real scripts spell a conditional value. What comes out
    // is one binding per name the chain touches; `foldIfChain` refuses anything
    // it cannot read, and the names it was about to rebind stay opaque.
    if (word === 'if') {
      const chain = ifBranches(stmts, si - 1)
      const last = chain ? chain.next : si
      try {
        const folded = foldIfChain(stmts, si - 1, ctx, env)
        for (let k = si - 1; k < folded.next; k += 1) consumeMutators(ctx, stmts[k].body)
        si = folded.next
      } catch (err) {
        const r = fromError(err)
        notes.push({ ...r, code: r.guard })
        // ⛔ THE REASON IS REMEMBERED PER NAME. Without this the closing pass
        // would relabel a genuine `pine:state` accumulator as "reassigned later",
        // which is true and tells a member nothing about the bar-to-bar value
        // that is actually the problem.
        for (let k = si - 1; k < last; k += 1) {
          for (const name of mutatorTargets(stmts[k].body)) {
            if (!unfoldable.has(name)) unfoldable.set(name, r)
          }
        }
        si = last
      }
      continue
    }
    if (BLOCK_KEYWORDS.has(word)) {
      notes.push(noteOf('pine:block', REFUSALS['pine:block'], first))
      continue
    }

    // ── outputs ────────────────────────────────────────────────────────────
    if (own(OUTPUT_CALLS, word) && isPunct(toks[1], '(')) {
      outputs.push({ kind: word, toks, tok: first })
      continue
    }

    // ⭐ ONE STATEMENT, FOUR COLUMNS. The expansion happens HERE rather than in
    // the resolve loop so that each role gets its own `Resolver` — one arm
    // refusing (`plotcandle(o, h, l, someArray.get(0))`) must cost that column
    // and not the other three, which is exactly how a multi-`plot` script already
    // behaves.
    if (own(MULTI_OUTPUT_CALLS, word) && isPunct(toks[1], '(')) {
      MULTI_OUTPUT_CALLS[word].forEach((role, roleIndex) => {
        outputs.push({ kind: word, role, roleIndex, toks, tok: first })
      })
      continue
    }

    // ── a binding, a function definition, or a paint call ─────────────────
    const arrow = findTop(toks, (t) => isPunct(t, '=>'))
    const eq = findTop(toks, (t) => isPunct(t, '='))
    if (arrow >= 0) {
      // ⭐⭐ A PURE FUNCTION IS A BINDING WITH ARGUMENTS, AND IT IS FOLDED ONCE
      // HERE RATHER THAN AT EVERY CALL. The body — a single expression, or a run
      // of local bindings and folded `if`s ending in one — becomes ONE Pine node
      // whose free names are the parameters. `Resolver.inlineUserFunction` then
      // binds the arguments and resolves it, which is the same substitution an
      // ordinary `x = …` already gets.
      //
      // ⛔ THE BODY'S MUTATORS ARE CONSUMED EITHER WAY. They belong to the
      // function's locals — Pine cannot assign to a global from inside a function
      // — so leaving them unconsumed would make the closing pass refuse a
      // PROGRAM name that merely shares a spelling with one of them. That is
      // exactly what `src` does in the everget family.
      const nameTok = toks[0].kind === 'ident' ? toks[0] : null
      const params = functionParams(toks, arrow)
      consumeMutators(ctx, stmt.body)
      try {
        if (!nameTok || !params) {
          throw new PineRefusal('pine:function-def', REFUSALS['pine:function-def'], locate(toks[arrow]))
        }
        const fnEnv = new Map(env)
        params.forEach((p, k) => fnEnv.set(p, { kind: 'param', index: k, name: p }))
        // ⭐ THE FUNCTION IS IN ITS OWN SCOPE, AND THAT IS SO RECURSION SAYS SO.
        // Pine forbids a function calling itself; without this the body's `f(…)`
        // would look like a table function nobody declared and report
        // `pine:function` — "there is no `f`" — about a name the member is
        // looking straight at. Bound, it reaches `MAX_CALL_DEPTH` and refuses at
        // `pine:cycle`, which is the true sentence. The object is filled in after
        // the fold, and the `new Map` copies the REFERENCE, so the body sees it.
        const self = { kind: 'fn', params, value: null, at: locate(toks[arrow]) }
        fnEnv.set(nameTok.value, self)
        const value = arrow === toks.length - 1
          ? foldStatements(stmt.sub, ctx, fnEnv)
          : exprBinding(parseWholeExpression(toks.slice(arrow + 1)), fnEnv, locate(toks[arrow]))
        if (!value) {
          throw new PineRefusal('pine:function-def',
            `${REFUSALS['pine:function-def']} — \`${nameTok.value}\` ends in no value this `
            + 'engine can read', locate(toks[arrow]))
        }
        self.value = value
        env.set(nameTok.value, self)
      } catch (err) {
        const r = fromError(err)
        markOpaque(nameTok && nameTok.value, r.guard,
          { line: r.line, column: r.column, index: r.index, token: r.token },
          `${r.message.replace(/^[^—]*—\s*/, '')}${nameTok ? ` (reached through \`${nameTok.value}\`)` : ''}`,
          true)
        notes.push({ ...r, code: r.guard })
      }
      continue
    }
    // ── a top-level reassignment ──────────────────────────────────────────
    const mutAt = findTop(toks, (t) => t.kind === 'punct' && MUTATORS.has(t.value))
    if (mutAt > 0 && toks[mutAt - 1].kind === 'ident') {
      const nameTok = toks[mutAt - 1]
      const prior = env.get(nameTok.value)
      try {
        if (prior && prior.kind === 'state') {
          env.set(nameTok.value, reassignState(prior, env, toks, mutAt, nameTok))
          ctx.consumed.add(toks[mutAt].index)
          continue
        }
        if (!prior || prior.kind !== 'expr') {
          throw new PineRefusal(prior && prior.guard ? prior.guard : 'pine:reassign',
            prior && prior.message ? prior.message
              : `${REFUSALS['pine:reassign']} — \`${nameTok.value}\``,
            prior && prior.at ? prior.at : locate(toks[mutAt]))
        }
        const rhs = parseWholeExpression(toks.slice(mutAt + 1))
        const op = toks[mutAt].value
        env.set(nameTok.value, exprBinding(op === ':=' ? rhs : {
          type: 'binary', op: op[0], left: boundNode(prior, nameTok.value, nameTok), right: rhs, tok: toks[mutAt],
        }, new Map(env), locate(nameTok)))
        ctx.consumed.add(toks[mutAt].index)
      } catch (err) {
        const r = fromError(err)
        // ⛔ CONSUMED ON PURPOSE. The refusal is recorded against the name with
        // ITS OWN reason; leaving the token for the closing pass would overwrite
        // that reason with the generic one.
        ctx.consumed.add(toks[mutAt].index)
        if (!unfoldable.has(nameTok.value)) unfoldable.set(nameTok.value, r)
        notes.push({ ...r, code: r.guard })
      }
      continue
    }
    if (eq > 0) {
      const nameTok = boundName(toks, eq)
      const rhs = toks.slice(eq + 1)
      if (!nameTok || rhs.length === 0) {
        notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
        continue
      }
      // ⭐⭐ `obvPlot = plot(obv, …)` IS STILL A PLOT. Pine's `plot()` RETURNS a
      // handle so `fill()` can join two of them, and a published indicator binds
      // it as a matter of course — `09-on-balance-volume.pine` in the corpus
      // binds both of its plots and offered NO column at all until this branch
      // existed. The binding is a chart handle and nothing here can read it; the
      // COLUMN is what the screener wants, and it is right there.
      if (rhs[0].kind === 'ident' && own(OUTPUT_CALLS, rhs[0].value)
          && isPunct(rhs[1], '(')) {
        outputs.push({ kind: rhs[0].value, toks: rhs, tok: rhs[0] })
        markOpaque(nameTok.value, 'pine:drawing', locate(rhs[0]),
          `\`${nameTok.value}\` holds a plot handle, which is a chart object rather than a number`)
        continue
      }
      // `h0 = hline(80, …)` binds a CHART HANDLE, not a number — `fill(h0, h1)`
      // is what it is for. Reading it as an ordinary value binding would refuse
      // it later at `pine:function` ("hline maps to nothing this table declares"),
      // which is true and completely beside the point.
      if (rhs[0].kind === 'ident' && CHART_ONLY_CALLS.has(rhs[0].value) && isPunct(rhs[1], '(')) {
        markOpaque(nameTok.value, 'pine:drawing', locate(rhs[0]),
          `\`${nameTok.value}\` holds a \`${rhs[0].value}\` handle, which is a chart object rather than a number`)
        notes.push(noteOf('pine:chart-only', chartOnlyNote(rhs[0].value), rhs[0]))
        continue
      }
      if (env.has(nameTok.value) && env.get(nameTok.value).kind === 'opaque') continue
      // ⭐ `x = if cond` / … / `else` — an if EXPRESSION. Pine's `if` yields the
      // last value of the branch it takes, which is a ternary spelled across
      // lines, and folding it needs the same machinery a reassignment does.
      if (rhs[0].kind === 'ident' && rhs[0].value === 'if') {
        const chain = ifBranches(stmts, si - 1)
        const last = chain ? chain.next : si
        try {
          const folded = foldIfChain(stmts, si - 1, ctx, env)
          for (let k = si - 1; k < folded.next; k += 1) consumeMutators(ctx, stmts[k].body)
          if (!folded.value) {
            throw new PineRefusal('pine:block',
              `${REFUSALS['pine:block']} — \`${nameTok.value} = if …\` has a branch with no value`,
              locate(rhs[0]))
          }
          env.set(nameTok.value, folded.value)
          si = folded.next
        } catch (err) {
          const r = fromError(err)
          markOpaque(nameTok.value, r.guard,
            { line: r.line, column: r.column, index: r.index, token: r.token },
            `\`${nameTok.value}\``)
          notes.push({ ...r, code: r.guard })
          si = last
        }
        continue
      }
      if (rhs[0].kind === 'ident' && BLOCK_KEYWORDS.has(rhs[0].value)) {
        markOpaque(nameTok.value, 'pine:block', locate(rhs[0]), `\`${nameTok.value}\``)
        notes.push(noteOf('pine:block', REFUSALS['pine:block'], rhs[0]))
        continue
      }
      try {
        env.set(nameTok.value, exprBinding(parseWholeExpression(rhs), new Map(env), locate(nameTok)))
      } catch (err) {
        const r = fromError(err)
        // ⛔ THE REFUSAL IS STORED WHOLE — its guard, ITS OWN MESSAGE and ITS OWN
        // LOCATOR. Rebuilding the sentence from the guard would drop the detail
        // the door appended (`— \`close\``), and re-pointing it at the start of
        // the line would move the caret off the token. See `markOpaque`.
        if (!env.has(nameTok.value) || env.get(nameTok.value).kind !== 'opaque') {
          env.set(nameTok.value, {
            kind: 'opaque',
            guard: r.guard,
            isFunction: false,
            message: `${r.message} (reached through \`${nameTok.value}\`)`,
            at: { line: r.line, column: r.column, index: r.index, token: r.token },
          })
        }
        // ⛔ NOT A REFUSAL YET. A binding nothing reaches is a note; if an output
        // reaches it, `resolveName` raises this same guard at this same token.
        notes.push({ ...r, code: r.guard })
      }
      continue
    }

    // A statement that is a bare call.
    if (isPunct(toks[1], '(')) {
      const dot = word.indexOf('.')
      const ns = dot > 0 ? word.slice(0, dot) : null
      if (CHART_ONLY_CALLS.has(word)) {
        notes.push(noteOf('pine:chart-only', chartOnlyNote(word), first))
        continue
      }
      if (ns === 'strategy') {
        hardRefusals.push(refusalValue('pine:strategy-call',
          `${REFUSALS['pine:strategy-call']} — \`${word}\``, locate(first)))
        continue
      }
      notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
      continue
    }

    notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
  }

  // ── ⭐⭐ THE CLOSING PASS: every mutation the walk did NOT account for ─────
  //
  // ⛔ THIS IS THE SAFETY NET AND IT IS DERIVED, NOT RETYPED. `reassigned` came
  // from the RAW TOKEN STREAM before a single statement was parsed, so it sees a
  // `:=` inside a `for`, a `switch`, a user-defined-type method, or any shape
  // this walker never learned. If the walk folded a mutation it recorded the
  // token; anything left over means the name changes somewhere the fold could not
  // read, and the binding the walk DID produce would be a lie about that name.
  // So it is overruled here, by force — after the walk, before any resolution.
  //
  // ⚠️ IT MUST OVERWRITE. Every other marker in this function refuses to clobber
  // an existing binding, which is right for them and wrong for this: the whole
  // job is to replace a binding the walk was too optimistic about.
  for (const [name, toks] of reassigned) {
    const missed = toks.find((t) => !ctx.consumed.has(t.index))
    const why = unfoldable.get(name)
    if (missed) {
      forceOpaque(name, 'pine:reassign', locate(missed), `\`${name}\``)
    } else if (why && env.get(name) && env.get(name).kind !== 'opaque') {
      forceOpaque(name, why.guard,
        { line: why.line, column: why.column, index: why.index, token: why.token }, `\`${name}\``)
    }
  }
  for (const [name, why] of unfoldable) {
    const bound = env.get(name)
    if (!bound || bound.kind === 'opaque') continue
    forceOpaque(name, why.guard,
      { line: why.line, column: why.column, index: why.index, token: why.token }, `\`${name}\``)
  }

  /** ⭐ THE LAST WORD ON EVERY NAME, captured once the walk is over. It answers
   *  exactly one question — `Resolver.guardOffsetOfMutable`'s — and it must be
   *  taken here rather than derived during resolution, because "is this binding
   *  the final one" is a fact about the PROGRAM and not about the read. */
  const finalBindings = new Map(env)

  // ── resolve each output, independently ───────────────────────────────────
  const resolved = []
  for (const out of outputs) {
    const resolver = new Resolver(env, table, declaredTypes, { finalBindings, mutated: reassigned })
    let row
    try {
      const cur = new Cursor(out.toks.slice(2))
      const args = parseArguments(cur)
      const rest = cur.peek()
      if (rest) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(rest))
      const seriesArg = pickOutputArgument(args, out.kind, out.tok, out.role, out.roleIndex)
      // ⭐⭐ A POSITIVE PINE OFFSET IS A BAR OFFSET IN THE TREE. `plot(x, offset=N)`
      // draws bar i's value at bar i+N, so what stands at bar j is bar j-N's —
      // `x[N]`. Putting it in the TREE makes the chart and the scan agree by
      // construction rather than by somebody remembering to shift one of them.
      // ⚠️ A NEGATIVE ONE STAYS OUT OF THE TREE and is recorded as presentation:
      // the value on display there would be a FUTURE bar's, which has no node,
      // while the author's computed value at each bar is exactly what the
      // undisplaced tree says.
      const shift = foldDisplacement(resolver, seriesArg)
      const base = resolver.resolve(seriesArg.value)
      const ast = shift > 0 ? { type: 'offset', value: shift, args: [base] } : base
      const formula = printFormula(ast)
      verifyRoundTrip(formula, ast)
      row = {
        kind: out.kind,
        title: outputTitle(args, out.kind, out.role) || null,
        line: out.tok.line,
        column: out.tok.column,
        formula,
        ast,
        inputsFolded: [...resolver.usedInputs.values()],
        // ⛔⛔ A COLUMN THAT READS NO BAR IS SCAFFOLDING TOO, and it arrives the
        // moment `plotshape` becomes an output. `03-rsi-directional-momentum-
        // scanner` guards four of its signals behind `input.bool` toggles that
        // default OFF, so `i_scn_show_short and choice_cont_ret ? x : false`
        // folds to the literal `0`. Offered as a column that is a saveable scan
        // titled "Cont 3rd Short" which matches NOTHING, on every symbol, forever
        // — and it looks identical to a screen that simply had a quiet day.
        //
        // ⭐ `readsBars` ALREADY EXISTED for precisely this reason; it was only
        // being used to decide which output to offer FIRST. The same fact answers
        // the bigger question: a tree with no series and no call is the same
        // number for every symbol, so it is not a screen at all. It rides the
        // `hidden` channel because `display.none` is the author's own statement of
        // the same thing, and one flag means one definition of "usable column".
        // ⚠️ NEGATIVE ONLY — a positive displacement is IN the tree above, so
        // recording it here too would be the same fact in two places and a
        // renderer would shift a column that has already been shifted.
        displace: shift < 0 ? shift : 0,
        hidden: outputHidden(args) || !readsBars(ast),
        refusal: null,
      }
    } catch (err) {
      row = {
        kind: out.kind,
        // ⭐ A REFUSED ROW STILL SAYS WHICH ROLE IT WAS. Four candle columns from
        // one statement all carry the same line and token, so a nameless refusal
        // among them tells a member their candle failed without saying WHICH
        // series to look at — and the other three sit there translated, which
        // makes the silence read like a whole-script problem.
        title: out.role || null,
        line: out.tok.line,
        column: out.tok.column,
        formula: null,
        ast: null,
        inputsFolded: [],
        refusal: fromError(err),
      }
    }
    resolved.push(row)
  }

  // ⛔ A HIDDEN OUTPUT IS NOT A COLUMN THE MEMBER GOT. Counting it made `ok`
  // mean "something in here parsed" instead of "you have a scan", and the
  // Butterworth script is the proof: four refusals, one hidden `hlc3`, verdict
  // `translates: true`.
  const usable = resolved.filter((r) => r.refusal === null && !r.hidden)
  const refusals = [
    ...hardRefusals,
    ...resolved.filter((r) => r.refusal).map((r) => r.refusal),
  ].sort(byPosition)

  if (resolved.length === 0) {
    const r = refusalValue('pine:no-output', REFUSALS['pine:no-output'], null)
    return {
      ok: false, version, declaration, title, outputs: [], selected: -1,
      notes: withExcerpts(notes, lines),
      refusal: hardRefusals[0] || r,
      refusals: withExcerpts(hardRefusals.length ? refusals : [r, ...refusals], lines),
    }
  }

  // ⛔ A HARD REFUSAL REFUSES THE WHOLE SCRIPT EVEN WHEN A PLOT TRANSLATED.
  // A `strategy()` script's plot is real Pine and would translate fine — but the
  // artifact is a backtest, its meaning lives in orders this engine never runs,
  // and offering one of its plots as "your scan" is reading a different document
  // than the one the member pasted. Same for a `library()` and for an `import`,
  // whose behaviour depends on code that never arrived.
  const blocked = hardRefusals.length > 0
  return {
    ok: usable.length > 0 && !blocked,
    version,
    declaration,
    title,
    outputs: resolved.map((r) => (r.refusal ? { ...r, refusal: withExcerpt(r.refusal, lines) } : r)),
    selected: blocked ? -1 : chooseOutput(resolved, table),
    notes: withExcerpts(notes, lines),
    refusal: (usable.length > 0 && !blocked) ? null : withExcerpt(refusals[0] || null, lines),
    refusals: withExcerpts(refusals, lines),
  }
}

/** Which of a script's outputs is offered first.
 *
 *  ⭐ DERIVED, AND STATED. An `alertcondition` IS a condition by construction, so
 *  it wins. Failing that, a plot whose tree the manifest says `yields: bool` is a
 *  0/1 column and a scan is `<tree> != 0` — so it is the one that screens.
 *  Otherwise the first plot that translated at all. ⛔ A member can always choose
 *  another; this decides what is on screen first, never what is possible. */
function chooseOutput(rows, table) {
  const ok = (r) => r.refusal === null && !r.hidden
  // ⛔ A CONSTANT IS NEVER THE FIRST OFFER, AND THAT IS MEASURED TOO. A published
  // indicator plots a hidden zero baseline so `fill()` has something to fill
  // against (`06-adx-advanced.pine` line 175: `pZero = plot(0.0,
  // display=display.none)`), and `0` satisfies "yields bool" — the manifest's
  // `_yields` says so correctly, because 0 IS one of the two values a 0/1 column
  // holds. Offering that as the member's scan would be a screen that matches
  // nothing, presented as the obvious choice.
  const live = (r) => readsBars(r.ast)
  const pick = (pred) => rows.findIndex((r) => ok(r) && pred(r))
  return [
    (r) => r.kind === 'alertcondition' && live(r),
    (r) => live(r) && treeYieldsBool(r.ast, table),
    (r) => live(r),
    () => true,
  ].reduce((found, pred) => (found >= 0 ? found : pick(pred)), -1)
}

/** Does this tree read the tape at all? A `series` leaf or a `call` — anything
 *  else is arithmetic on literals and is the same number for every symbol. */
function readsBars(node) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'series' || n.type === 'call') return true
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return false
}

/** Compiled sentence rules for ONE table object, memoised.
 *
 *  ⚠️ `yieldsOf` takes COMPILED RULES, not a manifest, and `compileRules` probes
 *  every declared entry — so calling it per node would put a full table compile
 *  inside `foldLogicalIdentity`'s fold loop. A `WeakMap` keyed on the table
 *  OBJECT costs one compile per distinct table and none at all for the shipped
 *  one, which is already compiled as `SENTENCE_RULES` at that module's load. */
const _RULES_FOR_TABLE = new WeakMap()

function rulesFor(table) {
  if (!table || typeof table !== 'object') return SENTENCE_RULES
  if (table === TABLE) return SENTENCE_RULES
  let rules = _RULES_FOR_TABLE.get(table)
  if (!rules) {
    rules = compileRules(table)
    _RULES_FOR_TABLE.set(table, rules)
  }
  return rules
}

/** Does this tree produce values in {0, 1, NaN}?
 *
 *  ⭐⭐ IT IS `sentence.js::yieldsOf`, NOT A SECOND READING OF THE MANIFEST, AND
 *  THAT IS THE WHOLE POINT OF THIS FUNCTION'S SHAPE. It used to re-walk the
 *  table itself — five branches that happened to agree with `yieldsOf` and with
 *  `scan_definition.is_boolean_tree` — and its own docstring ASSERTED that
 *  agreement. Closed table v2 broke it in one commit: the `series` arm read only
 *  `table.scalars`, so the moment the `clock` section declared five entries
 *  `bool`, `yieldsOf` said bool and this said false for every one of them. ⛔ A
 *  COMMENT CLAIMING AGREEMENT, BESIDE CODE THAT DISAGREES, IS THE ARTIFACT A
 *  LATER ENGINEER AUDITS AGAINST — so the agreement is now structural rather
 *  than asserted, and the only honest fix was to DELETE this reader, not to
 *  correct its comment.
 *
 *  ⚠️ WHY THE OLD COPY LOOKED NECESSARY: the note said "local rather than
 *  imported so that a caller-supplied table is honoured". `yieldsOf` honours one
 *  too — it just takes it COMPILED (`rulesFor` above). There was no cycle to
 *  avoid either: both modules import `parse.js` and neither imports the other.
 *
 *  ⛔ AND NOTHING HERE FIXES THE THIRD READER BY REACHING INTO IT.
 *  `is_boolean_tree` is the PYTHON lane's, held to this one by
 *  `test_the_two_YIELDS_resolvers_agree_and_the_answer_is_ONE`. Two lanes is the
 *  design; three readers in ONE lane was the defect. */
export function treeYieldsBool(node, table = TABLE) {
  return yieldsOf(node, rulesFor(table)) === 'bool'
}

/** A plot's `offset`, folded through the resolver to a whole number.
 *
 *  ⭐ THROUGH THE RESOLVER, so `offset = -prd` with `prd = input.int(10)` folds to
 *  −10 exactly as `close[n]` with `n = input.int(10)` already does one arm over.
 *  Reading only a written literal would have refused the commonest spelling of
 *  this in the wild — both remaining corpus scripts write it that way.
 *
 *  ⚠️ AND THE RESOLVER RETURNS `u-` OVER A NUMBER, NOT A NEGATIVE NUMBER. That
 *  is this engine's own canonical shape (`cNum` refuses to mint a negative
 *  literal), so it is unwrapped here rather than assumed away.
 *
 *  ⛔ A DISPLACEMENT THAT DOES NOT REDUCE TO A CONSTANT REFUSES. One that depends
 *  on a COLUMN is a per-bar shift — neither a node nor a presentation constant —
 *  and there is nothing honest to do with it. */
function foldDisplacement(resolver, seriesArg) {
  const node = seriesArg.offsetNode
  if (!node) return 0
  let folded
  try {
    folded = resolver.resolve(node)
  } catch {
    throw new PineRefusal('pine:plot-offset', REFUSALS['pine:plot-offset'],
      locate(seriesArg.offsetTok))
  }
  let value = NaN
  if (folded && folded.type === 'num') value = Number(folded.value)
  else if (folded && folded.type === 'op' && folded.name === 'u-'
           && (folded.args || []).length === 1 && folded.args[0].type === 'num') {
    value = -Number(folded.args[0].value)
  }
  if (!Number.isInteger(value)) {
    throw new PineRefusal('pine:plot-offset', REFUSALS['pine:plot-offset'],
      locate(seriesArg.offsetTok))
  }
  return value
}

/** The argument a screener reads. `plot(series, title, …)` and
 *  `alertcondition(condition, title, message)` — the first positional, or the
 *  named one Pine's own signature calls it. */
function pickOutputArgument(args, kind, tok, role = null, roleIndex = 0) {
  // ⚰️ THIS REFUSED EVERY DISPLACED PLOT, AND IT WAS CONFLATING TWO CLAIMS.
  // Its sentence — "a displaced plot writes its value at a different bar from the
  // one that produced it" — is true about the DRAWING and false about the COLUMN.
  // A scan reads the TREE at the last confirmed bar; where the author chose to
  // paint that number changes nothing about what the number is.
  //
  // ⭐⭐ AND THE POSITIVE CASE IS AN EXACT IDENTITY THIS TABLE ALREADY HOLDS.
  // `plot(x, offset = N)` shifts the plot RIGHT: bar i's value is drawn at bar
  // i + N, so the value ON DISPLAY at bar j is bar j-N's — which is `x[N]`, our
  // `offset` node. Chart and scan then agree by construction.
  //
  // ⚠️ THE NEGATIVE CASE IS THE ONE THAT NEEDS A RULING, AND HERE IT IS. Shifting
  // LEFT draws bar i's value at bar i-N, so the value on display at bar j is bar
  // j+N's — a FUTURE bar, and there is deliberately no node for that. But the
  // author's COMPUTED value at each bar is untouched, so the honest translation is
  // the undisplaced tree, carrying `displace` so the surface can say where the
  // author drew it. Both community scripts that do this use it as a DISPLAY trick,
  // not as a calculation: `11-52-week-high-low` pairs `offset=-9999` with
  // `trackprice=true` to hide the plot's own line and leave only the horizontal
  // track, and `27-support-resistance-channels` uses `offset=-prd` to place a
  // pivot label back on the pivot bar. Refusing a 52-week-high SCREEN over a
  // line-hiding trick is the whole cost of the old reading.
  const offset = args.find((a) => a.name === 'offset')
  // ⭐ PINE'S OWN PARAMETER NAME, per call. `alertcondition` takes `condition`;
  // `plot`, `plotshape` and `plotchar` all take `series`. Reading the wrong one
  // sends a named-argument script down the positional path and picks up whatever
  // came first, which for `plotshape(cond, title = "x")` is still right by luck
  // — and by luck is not a translation.
  // ⭐ A ROLE PICKS ITS OWN SERIES — BY PINE'S PARAMETER NAME FIRST, then by
  // position. A candle call has four of them, so "the first positional" is the
  // right answer for exactly one of the four and wrong for the rest.
  const named = role || OUTPUT_CALLS[kind]
  const byName = args.find((a) => a.name === named)
  const positionals = args.filter((a) => !a.name)
  const positional = role ? positionals[roleIndex] : positionals[0]
  const picked = byName || positional
  if (!picked) {
    throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
  }
  // ⭐ THE RAW OFFSET NODE RIDES OUT WITH THE ARGUMENT. It is not folded here:
  // `offset = -prd` where `prd = input.int(10)` is a CONSTANT displacement, and
  // only the resolver can fold an input to its default. The caller has one.
  return { ...picked, offsetNode: offset ? offset.value : null,
           offsetTok: offset ? (offset.tok || tok) : tok }
}

/** Did the SCRIPT'S AUTHOR mark this output as not-for-display?
 *
 *  ⭐⭐ `plot(x, display = display.none)` IS SCAFFOLDING, NOT AN OFFER. Published
 *  indicators plot a hidden series purely so `fill()` has a second edge to fill
 *  against, and the Butterworth Spectral Trend script does exactly that with
 *  `plot(price_source, display = display.none)` — where `price_source` is `hlc3`.
 *
 *  ⛔ IT READS BARS, SO EVERY "IS THIS A LIVE COLUMN?" TEST SAYS YES — which is
 *  what made it dangerous. Every real output of that script refused, this line
 *  did not, and the member was offered a saveable `(high + low + close) / 3`
 *  under the title of a spectral trend filter. `chooseOutput` already declines to
 *  offer a hidden CONSTANT baseline for this exact reason; `display.none` is the
 *  author's own, more general statement of it, so it is the one to read.
 */
function outputHidden(args) {
  const d = args.find((a) => a.name === 'display')
  // `display.none` lexes as ONE ident — the dot is part of the name, not an
  // operator — so this is a name comparison, not a member walk. Any other value
  // (`display.all`, `display.pane`) is a real display and stays offerable.
  return !!(d && d.value && d.value.type === 'name' && d.value.name === 'display.none')
}

function outputTitle(args, kind, role = null) {
  const byName = args.find((a) => a.name === 'title')
  const positional = args.filter((a) => !a.name)
  const second = positional[1]
  let base = null
  if (byName && byName.value.type === 'string') base = byName.value.value
  // ⛔ THE SECOND POSITIONAL IS THE TITLE FOR `plot(series, "t")` AND IS THE HIGH
  // FOR `plotcandle(o, h, l, c)`. Reading it for a candle would title every
  // column after a price series.
  else if (!role && second && second.value.type === 'string') base = second.value.value
  if (!role) return base
  // ⭐ THE ROLE IS PART OF THE NAME, ALWAYS. Four columns from one statement are
  // otherwise four identical offers, and a member picking "Smoothed Ha Candles"
  // from a list of four would be choosing at random.
  return base ? `${base} ${role}` : role
}

/** ⭐⭐ THE PROOF THAT NOTHING HALF-TRANSLATED. The printed text is read back by
 *  the SHIPPED parser and hashed; a disagreement emits nothing at all. */
function verifyRoundTrip(formula, ast) {
  const reparsed = parseFormula(formula)
  if (!reparsed.ok) {
    throw new PineRefusal('pine:roundtrip',
      `${REFUSALS['pine:roundtrip']} (${reparsed.error})`, null)
  }
  let a
  let b
  try {
    a = astHash(reparsed.ast)
    b = astHash(ast)
  } catch (err) {
    throw new PineRefusal('pine:roundtrip',
      `${REFUSALS['pine:roundtrip']} (${err && err.message ? err.message : err})`, null)
  }
  if (a !== b) {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
}

// --------------------------------------------------------------------------- //
// refusal values
// --------------------------------------------------------------------------- //

function refusalValue(guard, message, at) {
  return {
    guard,
    message,
    line: at ? at.line : null,
    column: at ? at.column : null,
    index: at ? at.index : null,
    token: at ? at.token : null,
    excerpt: null,
  }
}

function fromError(err) {
  if (err instanceof PineRefusal) return refusalValue(err.guard, err.message, err.at)
  return refusalValue('pine:statement',
    `${REFUSALS['pine:statement']} (${err && err.message ? err.message : err})`, null)
}

/** The source line and a caret under the offending token. A refusal that names a
 *  line number and shows nothing is a refusal a member has to go looking for. */
function withExcerpt(refusal, lines) {
  if (!refusal || refusal.line == null) return refusal
  const text = lines[refusal.line - 1]
  if (typeof text !== 'string') return refusal
  const caret = `${' '.repeat(Math.max(0, (refusal.column || 1) - 1))}^`
  return { ...refusal, excerpt: `${text}\n${caret}` }
}

function withExcerpts(list, lines) {
  return list.map((r) => withExcerpt(r, lines))
}

function byPosition(a, b) {
  const al = a.line == null ? Infinity : a.line
  const bl = b.line == null ? Infinity : b.line
  if (al !== bl) return al - bl
  return (a.column || 0) - (b.column || 0)
}
