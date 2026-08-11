// ─── THE TC2000 PCF READER — A SECOND SURFACE LANGUAGE, ONE CANONICAL TREE ──
//
// A member who has spent five years in TC2000 types `(C > AVGC50) AND (C1 <
// AVGC50.1)`. This file is how that reaches the same engine `sma(close, 50)`
// reaches: it produces the SAME canonical tree `parse.js` produces, so the
// chart, the scan and the alert all get the object they already share, and the
// budget, the repaint linter and the read-back all decide about it unchanged.
//
// ⭐ THIS IS A SECOND SURFACE SYNTAX, NOT A SECOND GRAMMAR. `closedTable.json`
// stays the only list of what a formula may call — this module never adds a
// name to it and never carries a copy of one. Every engine function it emits is
// LOOKED UP in `TABLE.functions` at translation time, and a token whose engine
// function the table does not declare refuses BY NAME rather than resolving to
// something this file believes. That is the difference that matters: a
// hand-list agreeing with today's manifest is invisible until the manifest
// moves, and E-4 measured what that costs (825 of 826 tests green, one AST
// source rail red). The rail here is `pcf.test.js`'s injected-table cases,
// which move the answer by moving the TABLE and nothing else.
//
// ⭐⭐ THE BAR OFFSET IS SUPPORTED, THROUGH ONE SEAM, AND THE SEAM IS DISCOVERED
// FROM THE ENGINE'S OWN CANONICAL VOCABULARY. PCF's `.z` suffix (`C1`, `C.1`,
// `AVGC50.1`, `MAXC252.1`) is its single most-used feature — an offset-free PCF
// is not PCF — so `offsetBinding()` asks `parse.js::NODE_TYPES` whether the
// engine has a bounded backward offset, and `applyOffset()` is the ONLY place in
// this file that knows how one is spelled in the canonical tree.
//
// ⛔ THERE IS NO SECOND OFFSET REPRESENTATION HERE AND THERE MUST NEVER BE ONE.
// This reader does not desugar an offset into an arithmetic identity, does not
// invent a node type and does not approximate. It emits exactly the node
// `parse.js` defines — `{type:'offset', value:<int ≥ 0>, args:[child]}` — and
// `assertCanonical` at the door is what proves it did not build a variant. If
// the engine ever loses the node, every TC2000 offset refuses naming THE MISSING
// ENGINE CAPABILITY rather than pretending TC2000's offset is unsupportable.
//
// ⚠️ A NEGATIVE OR NON-LITERAL OFFSET REFUSES AT PARSE, ALWAYS, BOUND OR NOT.
// That is the property the entire repaint linter rests on: `maxLookback` stays a
// tree sum and a FORWARD reference stays inexpressible. PCF has no syntax for a
// negative offset, and `C(-1)` — the one spelling that could smuggle one in — is
// refused here rather than left to the engine.
//
// ⚠️ PYTHON NEVER SEES PCF. Like jsep, this parses ONCE, in the browser, at
// author time; what is persisted is the canonical tree. `api/services/
// ast_interpret.py` walks that tree and has no idea which surface produced it,
// which is exactly why this file adds no numeric surface and no cross-lane
// parity obligation of its own. The proof is `pcf.test.js`'s astHash rail: a
// PCF formula and its native spelling produce the SAME hash.
//
// SOURCES for the language itself (read 2026-08-09, help.tc2000.com):
//   * Personal Criteria Formula Syntax Table — `/m/69445/l/745531`
//   * Boolean Relational Operators and Functions — `/m/69445/l/755513`
//   * Indicator Formula Template Table — `/m/69445/l/745033`
//   * Condition Formula Template Table — `/m/69445/l/756693`

import { TABLE, NODE_TYPES, assertCanonical, parseFormula } from './parse.js'

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** A refusal from THIS reader, carrying the guard, the source index and the
 *  text that caused it.
 *
 *  ⛔ ITS OWN CLASS, like `parse.js`'s and `interpret.js`'s and for the same
 *  reason: a single shared class lets one guard's deletion be covered by
 *  another guard's test. */
export class PcfRefusal extends Error {
  constructor(guard, message, index, token) {
    super(message)
    this.name = 'PcfRefusal'
    this.guard = guard
    this.index = index
    this.token = token
  }
}

/** guard → the sentence it refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND DISJOINT FROM `parse.js`'s NINE, `interpret.js`'s
 *  SIX, `budget.js`'s THREE AND `sentence.js`'s TEN — asserted in `pcf.test.js`
 *  over the union of all five, in both directions. Two gates sharing a phrase
 *  let a `toThrow(/…/)` pass with the safety deleted, and that has happened in
 *  this repo more than once.
 *
 *  ⚠️ EVERY MESSAGE IS COMPLETED WITH A DETAIL THAT NAMES THE TOKEN. The
 *  sentence below is the stem; `refuse()` appends the specific, because "this
 *  is not a TC2000 name this reader knows" without the name is a refusal a
 *  member cannot act on. */
export const PCF_REFUSALS = Object.freeze({
  'pcf:empty':
    'a TC2000 formula needs an expression to read',
  'pcf:character':
    'this character has no meaning in TC2000 syntax',
  'pcf:syntax':
    'the TC2000 reader expected something else here',
  'pcf:depth':
    'this TC2000 formula nests deeper than the reader will follow',
  'pcf:offset':
    'a bar offset needs an offset form this table does not declare yet',
  'pcf:operator':
    'TC2000 declares this operator and this table does not',
  'pcf:name':
    'this is not a TC2000 name this reader knows',
  'pcf:function':
    'this TC2000 token needs an engine function the table does not declare',
  'pcf:signature':
    'this TC2000 token does not fit the signature the table declares',
  'pcf:arity':
    'this TC2000 function was handed a different count of arguments',
  'pcf:window':
    'a TC2000 period must be a whole number written into the formula',
  'pcf:parameter':
    'this TC2000 parameter value is one the table cannot express',
})

function refuse(guard, detail, index, token) {
  throw new PcfRefusal(guard, `${PCF_REFUSALS[guard]} — ${detail}`, index, token)
}

// --------------------------------------------------------------------------- //
// what PCF spells, and what it MEANS in engine terms
// --------------------------------------------------------------------------- //
//
// ⭐ THESE TABLES DECLARE SURFACE SYNTAX ONLY. `fn` is a NAME, resolved in
// `TABLE.functions` every time it is used; `series`/`params` say how PCF's
// parameters map onto that function's arguments. Nothing here is believed:
// `resolveFn` refuses when the name is absent and `checkSignature` refuses when
// the shape the table declares is not the shape this mapping fills. So the day
// the manifest declares a function, its PCF spelling starts working with no
// edit here — and the day it renames one, the spelling refuses by name instead
// of silently reading something else.

/** The FUSED tokens: `AVGC50`, `XAVGC12`, `MAXH10`, `MINL10`, `STDDEV20`,
 *  `WRSI14`, `ATR14`, `MACD12.26`, `STOC14.1`.
 *
 *  `field: true`  — a price letter follows the family name and supplies the
 *                   series argument (`AVG` + `C` + `50`).
 *  `series: [...]`— the series arguments are FIXED by what the indicator means.
 *                   Only families whose argument ORDER the manifest states in
 *                   its own words are declared here: `_functions_indicators`
 *                   writes `atr(high, low, close, 14)` and `stoch(source, high,
 *                   low, length)`, and `macd`'s read-back writes
 *                   `the {1}/{2} MACD line of {0}`. ⛔ A family whose order is
 *                   NOT pinned by the manifest is deliberately absent — an
 *                   argument order guessed right today is a silent misread the
 *                   day it is guessed wrong, and `pcf:name` is the honest answer
 *                   until somebody pins it.
 *  `params`       — PCF's numeric parameters IN FILL ORDER. The first comes from
 *                   the digits fused into the base token and the rest from the
 *                   dotted suffixes, left to right, defaulting when omitted.
 *                   `offset` is always last and is always refused unless zero.
 *  `fixed`        — a parameter this table cannot express, with the ONE value it
 *                   can. `STOC14.3` is a %K smoothed over three bars and the
 *                   table declares an unsmoothed `stoch`, so `3` refuses rather
 *                   than being dropped. */
export const PCF_FUSED = Object.freeze({
  AVG:    { spelling: 'AVG<field><period>[.<offset>]',    fn: 'sma',     field: true, params: ['period', 'offset'] },
  XAVG:   { spelling: 'XAVG<field><period>[.<offset>]',   fn: 'ema',     field: true, params: ['period', 'offset'] },
  MAX:    { spelling: 'MAX<field><period>[.<offset>]',    fn: 'highest', field: true, params: ['period', 'offset'] },
  MIN:    { spelling: 'MIN<field><period>[.<offset>]',    fn: 'lowest',  field: true, params: ['period', 'offset'] },
  STDDEV: { spelling: 'STDDEV<period>[.<offset>]',        fn: 'stdev',   series: ['close'], params: ['period', 'offset'] },
  WRSI:   { spelling: 'WRSI<period>[.<offset>]',          fn: 'rsi',     series: ['close'], params: ['period', 'offset'] },
  ATR:    { spelling: 'ATR<period>[.<offset>]',           fn: 'atr',     series: ['high', 'low', 'close'], params: ['period', 'offset'] },
  MACD:   { spelling: 'MACD<fast>.<slow>[.<offset>]',     fn: 'macd',    series: ['close'], params: ['fast', 'slow', 'offset'] },
  STOC:   { spelling: 'STOC<period>.<smoothing>[.<offset>]', fn: 'stoch', series: ['close', 'high', 'low'], params: ['period', 'smoothing', 'offset'], fixed: { smoothing: 1 } },

  // Measured 2026-08-09 against Worden's own syntax table: these three were the
  // ONLY oscillators in the whole PCF vocabulary that this engine already
  // computes and this reader could not say. Same shape as `ATR` above -- the
  // three price series are supplied because TC2000 leaves them implicit against
  // the chart's symbol, which IS what the spelling means.
  //
  // ⛔ AND THE LIST IS THREE, NOT THIRTEEN. Of the sixteen oscillators PCF
  // declares, thirteen refused; it is tempting to read that as thirteen missing
  // rows. Twelve of them are NOT: `ADX`, `AROONUP`, `AROONDOWN`, `BOP`, `OBV`,
  // `FAVG` and `HAVG` are formulas this table does not declare at all, and
  // `RSI`, `WSTOC`, `MS` and `TSV` are DIFFERENT FORMULAS wearing familiar names
  // -- see `PCF_DIFFERENT_FORMULA`. Adding a row for any of those would be the
  // `MIN`/`lowest` trap this file's header exists to warn about.
  CCI:     { spelling: 'CCI<period>[.<offset>]',     fn: 'cci',     series: ['high', 'low', 'close'], params: ['period', 'offset'] },
  // ⭐⭐ `ADX14.14` — AND THE DOTTED NUMBER IS **SMOOTHING**, NOT AN OFFSET.
  //
  // ⛔ THIS IS THE `MIN`/`lowest` TRAP WEARING A NEW FACE, and it is why ADX gets
  // its own shape instead of the generic `<period>[.<offset>]` every other family
  // uses. Under that shape `ADX14.14` reads as "the 14-bar ADX, fourteen bars
  // ago" — a number, on the right scale, plausible on a chart, and wrong on every
  // bar. Worden spells it `ADX<diLength>.<adxSmoothing>`.
  //
  // ⛔ AND THE TWO MUST BE EQUAL, because this table's `adx` takes ONE period and
  // uses it for both smoothings (it binds the shipped `computeADX`, which does).
  // `matchParam` checks the second against the first and REFUSES when they
  // differ, rather than quietly dropping a smoothing a member wrote. Dropping it
  // is exactly what `_functions_excluded` warns about for `STOC`.
  ADX:     { spelling: 'ADX<period>.<smoothing>',    fn: 'adx',     series: ['high', 'low', 'close'], params: ['period', 'smoothing'], matchParam: ['smoothing', 'period'] },
  DIPLUS:  { spelling: 'DIPLUS<period>[.<offset>]',  fn: 'plusDI',  series: ['high', 'low', 'close'], params: ['period', 'offset'] },
  DIMINUS: { spelling: 'DIMINUS<period>[.<offset>]', fn: 'minusDI', series: ['high', 'low', 'close'], params: ['period', 'offset'] },
  // ⭐ AN EXPANSION, NOT A TABLE CALL. Balance of Power is
  // `sma((close - open) / (high - low), n)` -- Worden's own definition, written in
  // this table's existing vocabulary, so it costs the closed table no new name.
  // ⛔ `expand` EXISTS SO THIS CANNOT BE FAKED AS A MAPPING: there is no `bop`
  // function to point at, and inventing one to hold four lines of arithmetic
  // would put a second authority on a formula the table can already say.
  BOP:     { spelling: 'BOP<period>[.<offset>]', expand: true, series: [], params: ['period', 'offset'] },
})

/** 🔴 NAMES THIS TABLE HAS SOMETHING SIMILAR TO, AND MUST NOT MAP.
 *
 *  ⛔ EACH OF THESE WOULD PARSE, LINT, SAVE AND SCAN IF POINTED AT ITS
 *  LOOK-ALIKE, AND WOULD BE WRONG — the exact failure the `MIN`/`lowest` note at
 *  the top of `PCF_CALLS` describes, which the refusal surface cannot catch
 *  because nothing refuses. So they refuse HERE, by name, with the reason.
 *
 *  ⚠️ `RSI` IS THE SHARPEST ONE. Worden's table says outright that its `RSI` is
 *  **not Wilder's**, and that `WRSI` is — and `WRSI` is the one this reader
 *  already maps to our `rsi`. So a member typing `RSI14` must be told they want
 *  `WRSI14`, not silently handed Wilder's under Cutler's name.
 *
 *  ⚠️ `MS` AND `TSV` ARE PERMANENT. They are Worden-proprietary and their
 *  formulas are not published anywhere; a best effort would put a number under a
 *  name members trust. That is a refusal to keep, not a backlog item. */
export const PCF_DIFFERENT_FORMULA = Object.freeze({
  RSI:   "TC2000's RSI is not Wilder's. This table has Wilder's, which TC2000 spells WRSI",
  WSTOC: 'the Worden stochastic is a different formula from the simple STOC this table has',
  MS:    'MoneyStream is Worden-proprietary and its formula is not published',
  TSV:   'Time Segmented Volume is Worden-proprietary and its formula is not published',
})

/** The leading alphabetic run of a fused token — `RSI14.2` → `RSI`, `MS20` → `MS`.
 *
 *  ⛔ THE MAP IS CONSULTED AT THE REFUSAL, NOT AT THE MATCH, so a name that later
 *  becomes genuinely supported stops reaching this and the entry becomes dead
 *  rather than wrong. A look-alike check placed BEFORE the lookup would shadow a
 *  real mapping the day one was added. */
function differentFormula(text) {
  const m = /^([A-Za-z]+)/.exec(String(text || ''))
  const head = m ? m[1].toUpperCase() : ''
  return own(PCF_DIFFERENT_FORMULA, head) ? PCF_DIFFERENT_FORMULA[head] : null
}

/** The CALL forms. `AVG(w, x)` is TC2000's own alternative spelling of
 *  `AVGwx`, and `GREATEST`/`LEAST`/`ABS`/`XUP`/`XDOWN` have no fused form.
 *
 *  ⚠️ `MIN`/`MAX` ARE THE TRAP THIS WHOLE FILE EXISTS TO GET RIGHT. In PCF,
 *  `MIN(w, x)` is the LOWEST VALUE OVER x BARS — a rolling reduction — and
 *  `LEAST(v, w)` is the smaller of two values. Our table spells those `lowest`
 *  and `min`. Reading PCF's `MIN` as our `min` would produce a formula that
 *  parses, lints, saves, scans and is WRONG, which is the failure mode the
 *  refusal surface cannot catch. It is written out here because a comment is
 *  what a reviewer reads before they "simplify" the mapping. */
export const PCF_CALLS = Object.freeze({
  AVG:      { fn: 'sma',        shape: ['expr', 'window'] },
  XAVG:     { fn: 'ema',        shape: ['expr', 'window'] },
  MAX:      { fn: 'highest',    shape: ['expr', 'window'] },
  MIN:      { fn: 'lowest',     shape: ['expr', 'window'] },
  GREATEST: { fn: 'max',        shape: ['expr', 'expr'] },
  LEAST:    { fn: 'min',        shape: ['expr', 'expr'] },
  ABS:      { fn: 'abs',        shape: ['expr'] },
  XUP:      { fn: 'crossOver',  shape: ['expr', 'expr'], barsAgo: true },
  XDOWN:    { fn: 'crossUnder', shape: ['expr', 'expr'], barsAgo: true },

  // ── pure math ──────────────────────────────────────────────────────────────
  // ⭐ EACH OF THESE IS A SPELLING, NOT A FORMULA. `SQR` is a square root and not
  // a square — Worden's own table says so, and reading it the other way is the
  // single most likely mistranslation in this whole file, because the name says
  // the opposite of what it does. `CLG` is the COMMON (base-10) log, `LOG` is the
  // natural one — again Worden's convention, and again the reverse of what a
  // reader coming from most languages would assume.
  // ⭐ `SUM(w, x)` — named by this file's own coverage report as blocking SIX
  // published indicator templates, and blocked only because the table had no
  // rolling sum. It has one now, so this is the mapping and nothing more.
  SUM:      { fn: 'sum',        shape: ['expr', 'window'] },
  SQR:      { fn: 'sqrt',       shape: ['expr'] },
  LOG:      { fn: 'ln',         shape: ['expr'] },
  CLG:      { fn: 'log10',      shape: ['expr'] },
  EXP:      { fn: 'exp',        shape: ['expr'] },
  SGN:      { fn: 'sign',       shape: ['expr'] },
  SIN:      { fn: 'sin',        shape: ['expr'] },
  COS:      { fn: 'cos',        shape: ['expr'] },
  TAN:      { fn: 'tan',        shape: ['expr'] },
  ARCTAN:   { fn: 'atan',       shape: ['expr'] },
  SINH:     { fn: 'sinh',       shape: ['expr'] },
})

/** ⭐⭐ TC2000's THREE STATEFUL FUNCTIONS, AND THEY ARE THE RECURRENCE.
 *
 *  `CountTrue`, `SinceTrue` and `TrueInRow` all read a boolean ACROSS BARS, which
 *  this engine could not express at all until `accum` landed. Each builds
 *  `accum(seed, update, x)` where `x` — TC2000's own bar count — becomes the
 *  recurrence's warm-up, so the window the member wrote IS the window the engine
 *  bounds. Nothing is chosen here.
 *
 *  ⭐ AND THE SEMANTICS FALL OUT OF THAT COINCIDENCE RATHER THAN BEING PATCHED IN.
 *  Because the accumulator re-seeds exactly `x` bars back:
 *
 *    - `CountTrue(b, x)`  seeds 0 and adds 1 per true bar → occurrences in x bars.
 *    - `TrueInRow(b, x)`  seeds 0 and RESETS to 0 on a false bar → a consecutive
 *      streak, which TC2000 documents as ranging 0 to x. It cannot exceed x
 *      because the window is x.
 *    - `SinceTrue(b, x)`  seeds **-1** and holds -1 until the first true bar, then
 *      counts up from 0.
 *
 *  🔴 THE `-1` IS THE WHOLE DIFFICULTY OF THE THIRD ONE. TC2000 returns -1 when the
 *  condition NEVER occurred in the window, and -1 is not "zero bars ago" — it is
 *  "never". A mapping that seeded 0 would make *never happened* read as *happened
 *  just now*: inverted, and silent, on every symbol where the setup is absent —
 *  which is most of them. The update carries the sentinel forward explicitly
 *  (`self < 0 ? -1 : self + 1`) rather than letting arithmetic wash it away.
 *
 *  ⚠️ AND THE CAP IS THE WINDOW, NOT A CLAMP. TC2000 documents `SinceTrue`'s
 *  maximum as `x - 1`; re-seeding at `i - x` and counting from the first true bar
 *  cannot produce more than that, so there is no `min()` here and nothing to keep
 *  in step with the declared bound.
 *
 *  ⛔ THE BOOLEAN ARGUMENT IS A PURE SUBTREE, WHICH IS WHY THIS WORKS AT ALL. The
 *  recurrence step loop admits `self` only under operators and pointwise calls;
 *  `b` reads no running value, so it is evaluated once as a column and indexed per
 *  step. A `b` that itself contained an accumulator would refuse in the engine, by
 *  name, rather than here. */
const PCF_STATEFUL = Object.freeze({
  COUNTTRUE: {
    seed: 0,
    // self + (b ? 1 : 0)
    update: (b, self, one, zero) => ({ op: '+', left: self, right: { tern: [b, one, zero] } }),
  },
  TRUEINROW: {
    seed: 0,
    // b ? self + 1 : 0
    update: (b, self, one, zero) => ({ tern: [b, { op: '+', left: self, right: one }, zero] }),
  },
  SINCETRUE: {
    seed: -1,
    // b ? 0 : (self < 0 ? -1 : self + 1)
    update: (b, self, one, zero, negOne) => ({
      tern: [b, zero, { tern: [{ op: '<', left: self, right: zero }, negOne,
        { op: '+', left: self, right: one }] }],
    }),
  },
})

/** PCF's infix operators → the canonical operator name, with PCF's binding
 *  power. `=` is EQUALITY in PCF (there is no assignment) and `<>` is
 *  inequality; both are spellings this table already has.
 *
 *  ⛔ EVERY `op` BELOW IS CHECKED AGAINST `TABLE.operators` BEFORE IT IS
 *  EMITTED. The table is what declares `&&` exists with arity 2 — this file
 *  declares only that TC2000 spells it `AND`. */
const INFIX = Object.freeze({
  OR:   { op: '||', bp: 1 },
  AND:  { op: '&&', bp: 2 },
  '=':  { op: '==', bp: 6 },
  '<>': { op: '!=', bp: 6 },
  '>':  { op: '>',  bp: 7 },
  '<':  { op: '<',  bp: 7 },
  '>=': { op: '>=', bp: 7 },
  '<=': { op: '<=', bp: 7 },
  '+':  { op: '+',  bp: 9 },
  '-':  { op: '-',  bp: 9 },
  '*':  { op: '*',  bp: 10 },
  '/':  { op: '/',  bp: 10 },
})

/** PCF operators this table cannot express, refused BY NAME with what they
 *  mean. ⛔ A LIST OF WHAT IS REFUSED IS NOT A BLOCKLIST HERE — these are
 *  spellings TC2000 genuinely has, and a member who types one gets told which
 *  one rather than a generic syntax error at the same character. */
// ⚰️ `UNSUPPORTED_OPERATORS` IS GONE, DELIBERATELY — BUT `pcf:operator` IS NOT.
// The table existed for `^`, `\` and `MOD`, and all three read now, so it held
// nothing and its call site could not fire for any input: `lesson_gate_that_cannot_
// fail` in the plainest form. The GUARD survives and is still reachable, from
// `operator()` below, which refuses an operator this reader emits that the closed
// table does not declare — a different and still-real failure. Deleting the dead
// table while keeping the live guard is the distinction worth being careful about.

/** ⭐ THE THREE ARITHMETIC OPERATORS TC2000 HAS AS SYNTAX AND THIS TABLE HAS AS
 *  FUNCTIONS. `^`, `MOD` and `\` are infix in Worden's grammar; here they are
 *  ordinary calls, so the translator rewrites `C ^ 2` to `pow(close, 2)` rather
 *  than adding three operators to a closed vocabulary that does not need them.
 *
 *  ⛔ THE BINDING POWERS ARE NOT INVENTED. `^` binds tighter than `*` and is
 *  RIGHT-associative (`2^3^2` is 512, not 64); `MOD` and `\` sit with `*` and `/`
 *  and associate left. Getting either wrong changes what a member's scan means
 *  without changing whether it parses — the failure this file exists to prevent.
 */
const OPERATOR_CALLS = Object.freeze({
  '^':  { fn: 'pow',  bp: 12, rightAssoc: true },
  MOD:  { fn: 'mod',  bp: 10 },
  '\\': { fn: 'idiv', bp: 10 },
})

/** ⭐ THE FOUR LOGICAL OPERATORS TC2000 HAS AND THIS TABLE DOES NOT — DERIVED, NOT
 *  DECLARED. Each is written with the three the manifest already declares, so nothing
 *  entered the closed vocabulary to support them: `XOR`, `NAND`, `NOR` and `XNOR` are
 *  spellings, and a spelling belongs in a translator.
 *
 *  🔴 AND THE OBVIOUS FORM OF `XOR` IS WRONG IN THE ONE WAY THAT MATTERS. On 0/1
 *  columns `a XOR b` looks like `a != b`, which is ONE operator instead of five — but
 *  `!=` runs through `cmp`, which answers **0 when either side is NaN**, while `&&` and
 *  `||` run through `logical`, which answers **NaN**. So `a != b` would quietly turn
 *  *"we do not know"* into *"false"* on every bar where an operand is not computable —
 *  a confident answer built out of a hole, which is the failure this whole engine is
 *  arranged to prevent. The longer form propagates NaN correctly, and correctness buys
 *  the extra nodes.
 *
 *  ⚠️ THE OPERANDS APPEAR TWICE IN THREE OF THE FOUR, and that is affordable only
 *  because `seriesRefs` counts DISTINCT reads — mentioning `close` twice is still one
 *  column. Under the old occurrence-counting budget these would have translated and
 *  then been refused at the save door. */
/** Fused TC2000 tokens that are an EXACT expansion in this table's own
 *  vocabulary. The sibling of `PCF_FUSED`'s mapped entries.
 *
 *  ⛔ ADMISSIBLE ONLY AS AN IDENTITY, the same rule the Pine reader's
 *  `BUILTIN_CALL_TREE` follows. Anything needing a judgement about what Worden
 *  meant belongs in `PCF_DIFFERENT_FORMULA`, refusing by name. */
const PCF_EXPANSIONS = Object.freeze({
  // BOP<n> = the n-bar average of (close - open) / (high - low).
  BOP: (n) => callNode('sma', [
    opNode('/', [
      opNode('-', [seriesNode('close'), seriesNode('open')]),
      opNode('-', [seriesNode('high'), seriesNode('low')]),
    ]),
    num(n),
  ]),
})

const DERIVED_LOGIC = Object.freeze({
  // a AND NOT b, or b AND NOT a — written as "either, but not both"
  XOR:  (l, r) => opNode('&&', [opNode('||', [l, r]),
    opNode('!', [opNode('&&', [l, r])])]),
  NAND: (l, r) => opNode('!', [opNode('&&', [l, r])]),
  NOR:  (l, r) => opNode('!', [opNode('||', [l, r])]),
  XNOR: (l, r) => opNode('!', [opNode('&&', [opNode('||', [l, r]),
    opNode('!', [opNode('&&', [l, r])])])]),
})

/** Their binding power — the same as `AND`, because TC2000 groups them with it. */
const DERIVED_LOGIC_BP = 2

/** The one prefix operator PCF spells as a word. */
const PREFIX_NOT = 'NOT'

/** ⚠️ RECURSION IS BOUNDED, BECAUSE A GUARD THAT CRASHES IS NOT A REFUSAL.
 *  `parse.js` made its forbidden-node scan iterative for exactly this reason;
 *  a descent parser cannot be, so it counts instead. 64 is far past anything a
 *  member parenthesises and far short of a stack this reader can overflow. */
const MAX_DEPTH = 64

// --------------------------------------------------------------------------- //
// the price letters, DERIVED
// --------------------------------------------------------------------------- //

/** `C → close`, `O → open`, `H → high`, `L → low`, `V → volume` — READ OFF
 *  `TABLE.series`, never typed.
 *
 *  ⭐ A LETTER RESOLVES ONLY IF EXACTLY ONE DECLARED SERIES BEGINS WITH IT. The
 *  five PCF letters are the first letters of the five declared series and they
 *  are unique, so today the map is total. If the table ever declares a sixth
 *  series beginning with an already-taken letter, that letter stops resolving
 *  and every token using it refuses by name — which is the fail-closed
 *  direction. A hand-typed `{C: 'close', …}` would keep answering `close` for a
 *  table that had renamed it. */
export function priceLetters(table = TABLE) {
  const byLetter = new Map()
  const taken = new Set()
  for (const name of Object.keys(table.series || {})) {
    if (!name) continue
    const letter = name[0].toUpperCase()
    if (byLetter.has(letter)) { taken.add(letter); continue }
    byLetter.set(letter, name)
  }
  for (const letter of taken) byLetter.delete(letter)
  return byLetter
}

// --------------------------------------------------------------------------- //
// the tokenizer
// --------------------------------------------------------------------------- //

const IDENT_START = /[A-Za-z_]/
const IDENT_BODY = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

/** The two-character operators, longest-first so `>=` never lexes as `>`. */
const TWO_CHAR = Object.freeze(['>=', '<=', '<>'])
const ONE_CHAR = Object.freeze(['>', '<', '=', '+', '-', '*', '/', '^', '\\', '(', ')', ','])

/** Source → tokens. Each token carries the index it starts at, because a
 *  refusal that cannot say WHERE is a refusal a member cannot act on. */
function tokenize(source) {
  const out = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue }

    // A number. `.5` is a number; a `.` after an identifier is an offset
    // separator and is consumed by the identifier below.
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(source[i + 1] || ''))) {
      let j = i
      while (j < source.length && DIGIT.test(source[j])) j += 1
      if (source[j] === '.') {
        j += 1
        while (j < source.length && DIGIT.test(source[j])) j += 1
      }
      out.push({ kind: 'num', text: source.slice(i, j), index: i })
      i = j
      continue
    }

    // An identifier, INCLUDING its dotted numeric suffixes: `AVGC50.1` and
    // `C.10` are ONE token each. ⚠️ That is the whole reason this reader has its
    // own lexer — jsep would read `AVGC50.1` as a member access on a name.
    if (IDENT_START.test(ch)) {
      let j = i + 1
      while (j < source.length && IDENT_BODY.test(source[j])) j += 1
      while (source[j] === '.' && DIGIT.test(source[j + 1] || '')) {
        j += 1
        while (j < source.length && DIGIT.test(source[j])) j += 1
      }
      out.push({ kind: 'name', text: source.slice(i, j), index: i })
      i = j
      continue
    }

    const two = source.slice(i, i + 2)
    if (TWO_CHAR.includes(two)) { out.push({ kind: 'op', text: two, index: i }); i += 2; continue }
    if (ONE_CHAR.includes(ch)) { out.push({ kind: 'op', text: ch, index: i }); i += 1; continue }

    refuse('pcf:character', `\`${ch}\` at character ${i}`, i, ch)
  }
  out.push({ kind: 'eof', text: '', index: source.length })
  return out
}

// --------------------------------------------------------------------------- //
// the table lookups — the rail
// --------------------------------------------------------------------------- //

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)

/** The declared spec for an engine function, or a refusal that names BOTH the
 *  PCF token and the engine name the table is missing. */
function resolveFn(table, fn, spelling, index, token) {
  if (!own(table.functions, fn)) {
    refuse('pcf:function',
      `\`${token}\` reads as \`${fn}\`, which this table does not declare (it declares ${
        Object.keys(table.functions).join(', ')})`,
      index, token)
  }
  return table.functions[fn]
}

/** The shape this mapping is about to fill must be the shape the table
 *  declares. ⭐ THIS IS WHAT MAKES THE MAPPING SURVIVE THE MANIFEST MOVING: a
 *  signature change turns a would-be silent misread into a named refusal. */
function checkSignature(spec, wanted, fn, spelling, index, token) {
  const declared = spec.args || []
  const same = declared.length === wanted.length && wanted.every((k, n) => k === declared[n])
  if (!same) {
    refuse('pcf:signature',
      `\`${token}\` fills \`${fn}\`(${wanted.join(', ')}) and the table declares \`${fn}\`(${declared.join(', ')})`,
      index, token)
  }
}

/** Every operator this reader emits is checked against the table first. */
function operator(table, name, arity, index, token) {
  const spec = table.operators && table.operators[name]
  if (!spec || spec.arity !== arity) {
    refuse('pcf:operator',
      `\`${token}\` reads as the ${arity === 1 ? 'unary' : arity === 3 ? 'ternary' : 'binary'} \`${name}\`, which this table does not declare`,
      index, token)
  }
  return name
}

// --------------------------------------------------------------------------- //
// node builders
// --------------------------------------------------------------------------- //

const num = (value) => ({ type: 'num', value })
const seriesNode = (name) => ({ type: 'series', name })
const opNode = (name, args) => ({ type: 'op', name, args })
const callNode = (name, args) => ({ type: 'call', name, args })

// --------------------------------------------------------------------------- //
// the fused-token reader
// --------------------------------------------------------------------------- //

/** Split `AVGC50.1` into `{ base: 'AVGC50', dotted: [1], dotIndex: 6 }`.
 *  `dotIndex` is the source offset of the FIRST dot, so an offset refusal
 *  points at the offset rather than at the token. */
function splitDotted(token) {
  const parts = token.text.split('.')
  const dotted = []
  let at = token.index + parts[0].length
  const firstDot = parts.length > 1 ? at : -1
  for (let n = 1; n < parts.length; n++) {
    dotted.push({ value: Number(parts[n]), index: at + 1 })
    at += 1 + parts[n].length
  }
  return { base: parts[0], dotted, firstDot }
}

// --------------------------------------------------------------------------- //
// ⭐⭐ THE OFFSET SEAM — the ONE place that knows how a bar offset is spelled
// --------------------------------------------------------------------------- //

/** ⭐⭐ THE OFFSET IS DISCOVERED FROM THE ENGINE'S OWN CANONICAL VOCABULARY, AND
 *  THERE IS NO HAND-LIST ANYWHERE IN THIS SEAM.
 *
 *  `parse.js` EXPORTS `NODE_TYPES`, and the bounded backward offset is a member
 *  of it. So "does this engine have a bar offset" is a question the engine
 *  answers about itself — not a name this file guessed, not a marker key it
 *  hoped for, and not a shape it inferred. That is the difference between a
 *  seam and a bet.
 *
 *  ⚠️ PARAMETERISED SO BOTH BRANCHES STAY REACHABLE. A gate nobody has seen fire
 *  is not a gate, and once the offset ships the "no offset" branch is
 *  unreachable through the shipped constant — so `pcf.test.js` drives it with a
 *  four-type vocabulary and the real one, and asserts both answers.
 *
 *  @returns `{kind: 'node'}` or `null` */
export function offsetBinding(nodeTypes = NODE_TYPES) {
  return nodeTypes.includes(OFFSET_NODE) ? { kind: 'node', type: OFFSET_NODE } : null
}

/** The canonical node type the engine spells a bar offset with. ⛔ ONE literal,
 *  in one place, and it is compared against `NODE_TYPES` rather than trusted. */
const OFFSET_NODE = 'offset'

/** ⭐ THE OFFSET GATE, AND THE ONLY PLACE A TC2000 `.z` BECOMES A TREE.
 *
 *  Zero is the current bar and returns the node untouched. A negative or
 *  non-whole offset REFUSES AT PARSE whether or not the engine has an offset
 *  form — that is what keeps a forward reference inexpressible and `maxLookback`
 *  a tree sum. A positive offset emits the engine's own node:
 *
 *      { type: 'offset', value: <integer ≥ 0>, args: [ <one child> ] }
 *
 *  ⛔ `value` IS A NUMBER ON THE NODE, NOT A `num` CHILD, AND THIS FILE MUST NOT
 *  "improve" THAT. A node shape with no slot for an expression cannot hold one,
 *  so "the offset is a constant" is true BY CONSTRUCTION rather than by a check
 *  somebody can delete — and `maxLookback` stays `value + maxLookback(child)`.
 *  The shape is `parse.js`'s to define and this reader's to emit; `assertCanonical`
 *  at the door is what proves this file did not invent a variant of it. */
function applyOffset(nodeTypes, node, value, index, token) {
  if (value === 0) return node
  if (!Number.isInteger(value) || value < 0) {
    refuse('pcf:window',
      `\`${token}\` offsets by ${JSON.stringify(value)}, and a bar offset is a whole number of bars back`,
      index, token)
  }
  if (!offsetBinding(nodeTypes)) {
    refuse('pcf:offset',
      `\`${token}\` reads ${value} bar${value === 1 ? '' : 's'} back`,
      index, token)
  }
  return { type: OFFSET_NODE, value, args: [node] }
}

/** A whole-number PCF parameter, or a refusal that names it. */
function wholeNumber(value, what, index, token) {
  if (!Number.isInteger(value) || value < 1) {
    refuse('pcf:window',
      `\`${token}\` gives ${JSON.stringify(value)} as its ${what}`, index, token)
  }
  return value
}

/** Fill a family's declared parameters from the base digits and the dotted
 *  suffixes, left to right. */
function fillParams(family, firstDigits, dotted, token) {
  const values = {}
  const supplied = [
    { value: firstDigits === '' ? null : Number(firstDigits), index: token.index },
    ...dotted,
  ]
  if (supplied.length > family.params.length) {
    const extra = supplied[family.params.length]
    refuse('pcf:arity',
      `\`${token.text}\` gives ${supplied.length} parameters and ${family.spelling} takes ${family.params.length}`,
      extra.index, token.text)
  }
  for (let n = 0; n < family.params.length; n++) {
    const name = family.params[n]
    const got = supplied[n]
    values[name] = got === undefined || got.value === null
      ? { value: name === 'offset' ? 0 : null, index: token.index }
      : got
  }
  return values
}

/** TC2000 INDICATORS THAT ARE PICKED FROM ITS DIALOG, NOT TYPED AS TOKENS.
 *
 *  ⛔ EACH ONE SAYS WHAT TO DO INSTEAD. "We do not have that" sends a member away;
 *  telling them their 250-bar average already refuses a symbol with less history
 *  lets them delete the row and keep their scan.
 *
 *  ⚠️ Matched on the SOURCE before tokenizing, because these are multi-word
 *  English and the tokenizer would split them into a pile of unknown identifiers.
 */
const PCF_DIALOG_INDICATORS = Object.freeze([
  {
    name: 'Price History',
    re: /\bPrice\s+History\b/i,
    why: 'this engine has no count of how many bars a symbol has. It is usually not '
      + 'needed here: a long average refuses outright on a symbol without enough '
      + 'history, so a `Price History` row can simply be dropped',
  },
  {
    name: 'Price as Percent of 52 Week High',
    re: /\bPrice\s+as\s+Percent\s+of\s+52\s+Week\s+High\b/i,
    why: 'in TC2000 that row holds a formula of its own — write it here directly as '
      + '`100 * c / maxh250`',
  },
])

/** TC2000 FUNDAMENTAL words → a declared scalar, carrying the unit conversion.
 *
 *  ⛔ EVERY ENTRY MUST STATE ITS UNIT RELATIONSHIP, and an entry whose units
 *  already agree still says so, because "no conversion" and "conversion nobody
 *  wrote" are indistinguishable in the code and one of them is a silent bug.
 *
 *  ⛔ AND EACH ONE READS THE SCALAR OFF THE TABLE rather than trusting that it is
 *  there — a fundamental this manifest stops declaring must refuse by name, not
 *  build a tree over a column that no longer exists.
 */
const PCF_SCALARS = Object.freeze({
  // TC2000: millions of USD.  This table: float USD.  → divide by 1e6.
  CAPITALIZATION: (table, token) => scalarInMillions(table, token, 'market_cap'),
  MARKETCAP: (table, token) => scalarInMillions(table, token, 'market_cap'),
})

/** A scalar the member writes in millions, expressed in the table's own units. */
function scalarInMillions(table, token, name) {
  if (!own(table.scalars || {}, name)) {
    refuse('pcf:name',
      `\`${token.text}\` reads \`${name}\`, which this table does not declare`,
      token.index, token.text)
  }
  return opNode('/', [seriesNode(name), num(1000000)])
}

/** One fused token → a canonical node. */
function readFused(table, token, letters, nodeTypes) {
  const { base, dotted } = splitDotted(token)
  const upper = base.toUpperCase()

  // A bare price letter, with or without an offset. TC2000 spells the offset
  // TWO ways on a price token — `C1` and `C.1` — and they mean the same thing.
  const bare = /^([A-Z])(\d*)$/.exec(upper)
  if (bare && letters.has(bare[1])) {
    const inline = bare[2]
    if (dotted.length > 1) {
      refuse('pcf:arity',
        `\`${token.text}\` gives ${dotted.length} parameters and a price token takes one offset`,
        dotted[1].index, token.text)
    }
    if (inline !== '' && dotted.length === 1) {
      refuse('pcf:arity',
        `\`${token.text}\` writes its offset twice — once fused and once dotted`,
        dotted[0].index, token.text)
    }
    const node = seriesNode(letters.get(bare[1]))
    if (inline !== '') return applyOffset(nodeTypes, node, Number(inline), token.index + 1, token.text)
    if (dotted.length === 1) return applyOffset(nodeTypes, node, dotted[0].value, dotted[0].index, token.text)
    return node
  }

  // A family, optionally followed by a price letter, then digits.
  for (const [name, family] of Object.entries(PCF_FUSED)) {
    const pattern = family.field
      ? new RegExp(`^${name}([A-Z])(\\d*)$`)
      : new RegExp(`^${name}(\\d*)$`)
    const m = pattern.exec(upper)
    if (!m) continue

    let series
    if (family.field) {
      const letter = m[1]
      if (!letters.has(letter)) {
        refuse('pcf:name',
          `\`${token.text}\` asks ${name} for the price letter \`${letter}\`, and this table declares ${
            [...letters.keys()].join(', ')}`,
          token.index + name.length, token.text)
      }
      series = [letters.get(letter)]
    } else {
      series = family.series
    }
    const digits = family.field ? m[2] : m[1]
    const values = fillParams(family, digits, dotted, token)

    const ints = []
    for (const param of family.params) {
      if (param === 'offset') continue
      const got = values[param]
      if (family.fixed && own(family.fixed, param)) {
        const want = family.fixed[param]
        const have = got.value === null ? want : got.value
        if (have !== want) {
          refuse('pcf:parameter',
            `\`${token.text}\` sets ${param} to ${have}, and this table can only express ${want}`,
            got.index, token.text)
        }
        continue
      }
      // ⭐ A PARAM THAT IS CHECKED AND NOT PASSED. `ADX14.14`'s second number is
      // the ADX smoothing, and this table's `adx` takes ONE period for both — so
      // the smoothing is verified to MATCH and then deliberately not pushed as an
      // argument. ⛔ Refusing an unequal pair beats dropping it: a member who
      // wrote `ADX14.20` and got a 14/14 ADX would be shown a number that is not
      // the indicator they asked for.
      if (family.matchParam && param === family.matchParam[0]) {
        const twin = values[family.matchParam[1]]
        const want = twin ? twin.value : null
        const have = got.value === null ? want : got.value
        if (have !== want) {
          refuse('pcf:parameter',
            `\`${token.text}\` sets ${param} to ${have} and ${family.matchParam[1]} to ${want}`
            + `, and this table's ${family.fn} uses one period for both`,
            got.index, token.text)
        }
        continue
      }
      if (got.value === null) {
        refuse('pcf:arity',
          `\`${token.text}\` leaves ${param} unsaid and ${family.spelling} requires it`,
          token.index, token.text)
      }
      ints.push(wholeNumber(got.value, param, got.index, token.text))
    }

    if (family.expand) {
      // ⛔ EVERY NAME THE EXPANSION USES IS CHECKED AGAINST THE MANIFEST, never
      // assumed -- this file declares only that TC2000 spells it `BOP`.
      resolveFn(table, 'sma', family.spelling, token.index, token.text)
      operator(table, '-', 2, token.index, token.text)
      operator(table, '/', 2, token.index, token.text)
      const built = PCF_EXPANSIONS[name](ints[0])
      const offX = values.offset
      return offX ? applyOffset(nodeTypes, built, offX.value, offX.index, token.text) : built
    }

    const spec = resolveFn(table, family.fn, family.spelling, token.index, token.text)
    const wanted = [...series.map(() => 'series'), ...ints.map(() => 'int')]
    checkSignature(spec, wanted, family.fn, family.spelling, token.index, token.text)
    for (const s of series) {
      if (!own(table.series, s)) {
        refuse('pcf:name',
          `\`${token.text}\` reads the series \`${s}\`, which this table does not declare`,
          token.index, token.text)
      }
    }
    // ⭐ THE OFFSET IS APPLIED TO THE WHOLE CALL, NOT TO ITS SOURCE SERIES.
    // `AVGC50.1` is *the 50-bar average as it stood one bar ago* — not the
    // average of a shifted close, which is the same number only by coincidence
    // for an SMA and a DIFFERENT number for an EMA, an RSI or an ATR. Getting
    // this the other way round is a silent misread on every recursive indicator
    // the manifest declares.
    const call = callNode(family.fn, [...series.map(seriesNode), ...ints.map(num)])
    const off = values.offset
    return off ? applyOffset(nodeTypes, call, off.value, off.index, token.text) : call
  }

  // ⭐⭐ A TC2000 FUNDAMENTAL, MAPPED ONTO A DECLARED SCALAR — WITH ITS UNIT.
  //
  // ⛔⛔ THE UNIT IS THE WHOLE JOB, AND GETTING IT WRONG WOULD BE SILENT. TC2000
  // states capitalisation in MILLIONS — a $250M company reads `250` — while this
  // table's `market_cap` is float USD straight off `get_market_cap`. Mapping the
  // name alone would turn every real screen (`Capitalization > 250`) into
  // "bigger than two hundred and fifty dollars", which passes the entire universe
  // and reports a market-cap floor that is not there. Nothing refuses, nothing
  // looks wrong, and the member's scan quietly stops filtering.
  //
  // So the CONVERSION RIDES ON THE NAME, because that is what the name means: the
  // TC2000 word `Capitalization` denotes market cap in millions, and this is the
  // expression for it. The read-back says `divided by 1000000` out loud, which is
  // how a member confirms we read their threshold the way they meant it.
  const scalarFn = PCF_SCALARS[upper]
  if (scalarFn) {
    if (dotted.length) {
      // ⛔ A nightly scalar has no bar to be offset FROM. `Capitalization.1` is a
      // question this data cannot answer, and answering it with today's value
      // would be a fabricated history.
      refuse('pcf:offset',
        `\`${token.text}\` is a fundamental, and a fundamental has no bar offset`,
        dotted[0].index, token.text)
    }
    return scalarFn(table, token)
  }

  // ⭐ A LOOK-ALIKE GETS ITS OWN SENTENCE. `RSI14` refusing with the same words as
  // a typo sends a member hunting for a spelling that does not exist; telling
  // them TC2000's RSI is not Wilder's — and that `WRSI` is the one they want —
  // is the difference between a dead end and a working scan.
  const lookalike = differentFormula(token.text)
  refuse('pcf:name',
    lookalike
      ? `\`${token.text}\` at character ${token.index} — ${lookalike}`
      : `\`${token.text}\` at character ${token.index}`, token.index, token.text)
  return null
}

// --------------------------------------------------------------------------- //
// the parser
// --------------------------------------------------------------------------- //

class Reader {
  constructor(tokens, table, nodeTypes) {
    this.tokens = tokens
    this.pos = 0
    this.table = table
    this.nodeTypes = nodeTypes
    this.letters = priceLetters(table)
    this.depth = 0
  }

  peek() { return this.tokens[this.pos] }

  next() { return this.tokens[this.pos++] }

  expect(text) {
    const t = this.peek()
    if (t.kind === 'op' && t.text === text) return this.next()
    refuse('pcf:syntax',
      `\`${text}\` was expected at character ${t.index}${t.kind === 'eof' ? ' (the formula ends here)' : `, and \`${t.text}\` is there`}`,
      t.index, t.text)
    return null
  }

  /** The word a `name` token spells as an operator, or null. */
  infixOf(token) {
    // ⛔ THE SYMBOL OPERATORS CHECK `OPERATOR_CALLS` TOO. `MOD` arrives as a NAME
    // token and fell through to the lookup below, so it worked immediately; `^`
    // and `\` arrive as OP tokens and this branch used to return `INFIX` only,
    // which meant the same table was consulted for one spelling and skipped for
    // the other two. One table, both token kinds.
    if (token.kind === 'op') {
      if (own(OPERATOR_CALLS, token.text)) {
        const o = OPERATOR_CALLS[token.text]
        return { call: o.fn, bp: o.bp, rightAssoc: !!o.rightAssoc }
      }
      return INFIX[token.text] || null
    }
    if (token.kind !== 'name') return null
    const upper = token.text.toUpperCase()
    if (own(DERIVED_LOGIC, upper)) return { derived: upper, bp: DERIVED_LOGIC_BP }
    if (own(OPERATOR_CALLS, upper)) {
      const o = OPERATOR_CALLS[upper]
      return { call: o.fn, bp: o.bp, rightAssoc: !!o.rightAssoc }
    }
    return INFIX[upper] || null
  }

  expression(minBp = 0) {
    this.depth += 1
    if (this.depth > MAX_DEPTH) {
      const t = this.peek()
      refuse('pcf:depth', `character ${t.index} is ${MAX_DEPTH} levels in`, t.index, t.text)
    }
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      const infix = this.infixOf(t)
      if (!infix || infix.bp < minBp) break
      this.next()
      // ⛔ RIGHT-ASSOCIATIVE OPERATORS RECURSE AT THEIR OWN BINDING POWER, NOT
      // ONE ABOVE IT. `bp + 1` is what makes an operator LEFT-associative; `^`
      // must group `2^3^2` as `2^(3^2)` = 512, and `bp + 1` would give
      // `(2^3)^2` = 64. Same parse either way — a different number.
      const right = this.expression(infix.rightAssoc ? infix.bp : infix.bp + 1)
      if (infix.call) {
        // TC2000 spells these infix; this table has them as functions, so the
        // rewrite happens here rather than widening the closed operator set.
        // ⛔ THROUGH THE SAME MANIFEST GATE EVERY OTHER CALL USES. An operator
        // that skipped `resolveFn`/`checkSignature` would be the one spelling in
        // this file that could name a function the table does not declare.
        const spec = resolveFn(this.table, infix.call, t.text, t.index, t.text)
        checkSignature(spec, ['series', 'series'], infix.call, t.text, t.index, t.text)
        left = callNode(infix.call, [left, right])
        continue
      }
      if (infix.derived) {
        // ⛔ EVERY OPERATOR THE EXPANSION USES IS CHECKED AGAINST THE MANIFEST, not
        // assumed. This file declares only that TC2000 spells it `XOR`; the table is
        // what declares `&&`, `||` and `!` exist at those arities.
        operator(this.table, '&&', 2, t.index, t.text)
        operator(this.table, '||', 2, t.index, t.text)
        operator(this.table, '!', 1, t.index, t.text)
        left = DERIVED_LOGIC[infix.derived](left, right)
        continue
      }
      operator(this.table, infix.op, 2, t.index, t.text)
      left = opNode(infix.op, [left, right])
    }
    this.depth -= 1
    return left
  }

  unary() {
    const t = this.peek()
    if (t.kind === 'op' && t.text === '-') {
      this.next()
      operator(this.table, 'u-', 1, t.index, t.text)
      return opNode('u-', [this.unary()])
    }
    if (t.kind === 'name' && t.text.toUpperCase() === PREFIX_NOT) {
      this.next()
      operator(this.table, '!', 1, t.index, t.text)
      return opNode('!', [this.unary()])
    }
    return this.atom()
  }

  atom() {
    const t = this.next()
    if (t.kind === 'num') {
      const value = Number(t.text)
      if (!Number.isFinite(value)) {
        refuse('pcf:syntax', `\`${t.text}\` at character ${t.index} is not a number`, t.index, t.text)
      }
      return num(value)
    }
    if (t.kind === 'op' && t.text === '(') {
      this.depth += 1
      if (this.depth > MAX_DEPTH) {
        refuse('pcf:depth', `character ${t.index} is ${MAX_DEPTH} levels in`, t.index, t.text)
      }
      const inner = this.expression(0)
      this.expect(')')
      this.depth -= 1
      return inner
    }
    if (t.kind === 'name') {
      const after = this.peek()
      if (after.kind === 'op' && after.text === '(') return this.call(t)
      return readFused(this.table, t, this.letters, this.nodeTypes)
    }
    refuse('pcf:syntax',
      `character ${t.index} carries ${t.kind === 'eof' ? 'the end of the formula' : `\`${t.text}\``} where a value was expected`,
      t.index, t.text)
    return null
  }

  /** `NAME(...)`. */
  call(nameToken) {
    const upper = nameToken.text.toUpperCase()
    if (nameToken.text.includes('.')) {
      refuse('pcf:syntax',
        `\`${nameToken.text}\` at character ${nameToken.index} carries parameters and is being called`,
        nameToken.index, nameToken.text)
    }
    this.expect('(')
    const args = []
    if (!(this.peek().kind === 'op' && this.peek().text === ')')) {
      for (;;) {
        const startsAt = this.peek().index
        args.push({ node: this.expression(0), index: startsAt })
        const t = this.peek()
        if (t.kind === 'op' && t.text === ',') { this.next(); continue }
        break
      }
    }
    this.expect(')')
    return this.buildCall(upper, nameToken, args)
  }

  buildCall(upper, token, args) {
    const at = token.index
    const nodes = args.map((a) => a.node)

    // A price letter with an explicit offset: TC2000's `C(z)` form.
    if (this.letters.has(upper)) {
      if (nodes.length !== 1) {
        refuse('pcf:arity',
          `\`${token.text}\` takes one offset and was handed ${nodes.length}`, at, token.text)
      }
      const only = nodes[0]
      // ⛔ AN OFFSET THAT IS NOT A LITERAL IS REFUSED HERE, NOT PASSED ON. A
      // computed offset is not decidable statically, and the moment lookback
      // stops being decidable statically the repaint linter stops being a tree
      // sum. This is also the one PCF spelling through which a NEGATIVE index
      // could arrive — `C(-1)` parses as unary minus — so it is where a forward
      // reference is stopped.
      if (only.type !== 'num') {
        refuse('pcf:window',
          `\`${token.text}(…)\` offsets by an expression rather than a written number`,
          at, token.text)
      }
      return applyOffset(this.nodeTypes, seriesNode(this.letters.get(upper)), only.value, at, token.text)
    }

    // The ternary. TC2000 spells it `IIF(b, t, f)`.
    if (upper === 'IIF') {
      if (nodes.length !== 3) {
        refuse('pcf:arity',
          `\`IIF\` takes three arguments and was handed ${nodes.length}`, at, token.text)
      }
      operator(this.table, '?:', 3, at, token.text)
      return opNode('?:', nodes)
    }

    // ⚠️ THERE IS DELIBERATELY NO `NOT` CASE HERE. `unary()` intercepts the word
    // before `atom()` ever sees it, so `NOT(x)` is prefix-NOT applied to a
    // parenthesised expression and a branch here would be dead code that reads
    // as protection. `pcf.test.js` asserts the tree `NOT(x)` produces.

    const stateful = PCF_STATEFUL[upper]
    if (stateful) {
      // ⛔ TWO ARGUMENTS, AND THE SECOND IS A WRITTEN NUMBER. It becomes the
      // recurrence's warm-up, and a warm-up that is not a literal is exactly what
      // `windowLiteral` refuses in the engine — refusing it here names the token.
      if (nodes.length !== 2) {
        refuse('pcf:arity',
          `\`${token.text}\` takes a condition and a bar count, got ${nodes.length}`,
          at, token.text)
      }
      const bars = nodes[1]
      if (bars.type !== 'num' || !Number.isInteger(bars.value) || bars.value < 1) {
        refuse('pcf:window',
          `\`${token.text}\` counts over a written whole number of bars`,
          args[1].index, token.text)
      }
      const spec = this.table.functions.accum
      if (!spec) {
        refuse('pcf:name', `\`${token.text}(…)\` at character ${at}`, at, token.text)
      }
      const NUM = (v) => num(v)
      const SELF = seriesNode(spec.recurrence.binds)
      const build = (n) => {
        if (n && n.op) return opNode(n.op, [build(n.left), build(n.right)])
        if (n && n.tern) return opNode('?:', n.tern.map(build))
        return n
      }
      operator(this.table, '?:', 3, at, token.text)
      // ⛔ -1 IS `u-` OVER A POSITIVE LITERAL, NOT A NEGATIVE `num`, BECAUSE THAT
      // IS WHAT THE PARSER BUILDS FOR `-1`. Emitting `{num:-1}` here would give
      // `SinceTrue(...)` and its written-out equivalent TWO `astHash`es for ONE
      // column — and that hash decides whether an edit force-migrates every
      // binding and resets `last_value`. The corpus asserts the two trees are
      // identical, which is how this was caught.
      operator(this.table, 'u-', 1, at, token.text)
      const negOne = opNode('u-', [NUM(1)])
      const body = build(stateful.update(nodes[0], SELF, NUM(1), NUM(0), negOne))
      const built = []
      // ⛔ AND THE SEED TAKES THE SAME TREATMENT — this is where the first fix
      // was incomplete. `SinceTrue`'s seed is -1, and a negative `num` there
      // hashed differently from the parser's `u-` even after the body was
      // corrected, so the two forms of ONE column still disagreed. Derived from
      // the sign rather than special-cased per entry.
      built[spec.recurrence.seed] = stateful.seed < 0
        ? opNode('u-', [NUM(-stateful.seed)])
        : NUM(stateful.seed)
      built[spec.recurrence.body] = body
      built[spec.recurrence.warmup] = NUM(bars.value)
      return callNode('accum', built)
    }

    const call = PCF_CALLS[upper]
    if (!call) {
      const lookalike = differentFormula(token.text)
      refuse('pcf:name',
        lookalike
          ? `\`${token.text}(…)\` at character ${at} — ${lookalike}`
          : `\`${token.text}(…)\` at character ${at}`, at, token.text)
    }

    let used = nodes
    if (call.barsAgo && nodes.length === call.shape.length + 1) {
      // ⭐ `XUP(v, w, x)` IS TC2000'S OWN DEFINITION AND IT IS SPELLED OUT HERE
      // WHEN x ≠ 1: *"true when v is less than w at x bars ago and v is greater
      // than or equal to w now"* (help.tc2000.com `/m/69445/l/755513`). There is
      // no primitive for a crossing measured against an arbitrary bar, so this
      // is the definition itself — through the SAME offset seam every `.z` goes
      // through, never a second offset representation.
      //
      // ⚠️ AND THE x = 1 CASE MAPS TO `crossOver`/`crossUnder` INSTEAD, WHICH IS
      // NOT BYTE-EXACT AND IS RECORDED RATHER THAN HIDDEN. TC2000's boundaries
      // are `prior <` / `now >=`; this table's `crossOver` is `prior <=` /
      // `now >`, so the two disagree when a value lands EXACTLY on the level —
      // reachable on a round-number threshold. `pcfCoverage().live` names the
      // difference and the report names the engine change that would close it.
      // The primitive is used anyway because it is the crossing this product's
      // own picker builds and the one its read-back can say in English.
      const extra = nodes[call.shape.length]
      if (extra.type !== 'num') {
        refuse('pcf:window',
          `\`${token.text}\` counts back by an expression rather than a written number`,
          args[call.shape.length].index, token.text)
      }
      if (extra.value !== 1) {
        const [left, right] = nodes
        const back = args[call.shape.length].index
        const now = call.fn === 'crossOver' ? '>=' : '<='
        const then = call.fn === 'crossOver' ? '<' : '>'
        operator(this.table, '&&', 2, at, token.text)
        operator(this.table, now, 2, at, token.text)
        operator(this.table, then, 2, at, token.text)
        return opNode('&&', [
          opNode(now, [left, right]),
          opNode(then, [
            applyOffset(this.nodeTypes, left, extra.value, back, token.text),
            applyOffset(this.nodeTypes, right, extra.value, back, token.text),
          ]),
        ])
      }
      used = nodes.slice(0, call.shape.length)
    }
    if (used.length !== call.shape.length) {
      refuse('pcf:arity',
        `\`${token.text}\` takes ${call.shape.length}${call.barsAgo ? ' (or three)' : ''} arguments and was handed ${nodes.length}`,
        at, token.text)
    }

    const wanted = []
    const emitted = []
    for (let n = 0; n < call.shape.length; n++) {
      if (call.shape[n] === 'window') {
        const node = used[n]
        if (node.type !== 'num') {
          refuse('pcf:window',
            `\`${token.text}\` was handed an expression as its period`, args[n].index, token.text)
        }
        wholeNumber(node.value, 'period', args[n].index, token.text)
        wanted.push('int')
      } else {
        wanted.push('series')
      }
      emitted.push(used[n])
    }

    const spec = resolveFn(this.table, call.fn, `${upper}(…)`, at, token.text)
    checkSignature(spec, wanted, call.fn, `${upper}(…)`, at, token.text)
    return callNode(call.fn, emitted)
  }
}

// --------------------------------------------------------------------------- //
// the door
// --------------------------------------------------------------------------- //

/** TC2000 PCF source → the canonical tree, or a tagged refusal. NEVER throws.
 *
 *  ⛔ A THROW FROM A READER REACHES THE BUILDER AS A BLANK SCREEN, and a parse
 *  failure is the NORMAL case in a box somebody is halfway through typing into.
 *  `parseFormula` is built on the same rule and this matches it exactly, so the
 *  surface treats both dialects identically.
 *
 *  @returns {{ok: true, ast: object, dialect: 'pcf'}
 *          | {ok: false, error: string, guard: string, index: number, token: string, dialect: 'pcf'}}
 */
export function parsePcf(source, table = TABLE, nodeTypes = NODE_TYPES) {
  if (typeof source !== 'string' || source.trim() === '') {
    return {
      ok: false, dialect: 'pcf', guard: 'pcf:empty', index: 0, token: '',
      error: `${PCF_REFUSALS['pcf:empty']} — the box is blank`,
    }
  }
  // ⭐⭐ TC2000'S DIALOG INDICATORS, NAMED BEFORE THE TOKENIZER SEES THEM.
  //
  // These are picked from TC2000's Indicator dropdown, not typed as formula
  // tokens, so they arrive as MULTI-WORD English. The tokenizer splits them and
  // the member gets "a formula is one expression, and this is several" about a
  // real TC2000 indicator they selected from a list — a true sentence that
  // explains nothing. Measured on a real Inside-Day column 2026-08-11.
  const dialogHit = PCF_DIALOG_INDICATORS.find((d) => d.re.test(source))
  if (dialogHit) {
    return {
      ok: false, dialect: 'pcf', guard: 'pcf:name',
      index: source.search(dialogHit.re), token: dialogHit.name,
      error: `\`${dialogHit.name}\` is a TC2000 indicator you pick from its dialog, `
        + `not a formula token — ${dialogHit.why}`,
    }
  }
  try {
    const reader = new Reader(tokenize(source), table, nodeTypes)
    const ast = reader.expression(0)
    const rest = reader.peek()
    if (rest.kind !== 'eof') {
      refuse('pcf:syntax',
        `\`${rest.text}\` at character ${rest.index} is past the end of the formula`,
        rest.index, rest.text)
    }
    // ⭐ THE OUTPUT IS PROVED CANONICAL BY THE ENGINE'S OWN CHECKER, not by this
    // module's belief about what it built. `assertCanonical` is what every
    // persisted tree passes through inside `astHash`; a fifth node type or a
    // stray key invented here dies at this line rather than in a store.
    assertCanonical(ast)
    return { ok: true, ast, dialect: 'pcf' }
  } catch (err) {
    if (err instanceof PcfRefusal) {
      return {
        ok: false, dialect: 'pcf', guard: err.guard, index: err.index,
        token: err.token, error: err.message,
      }
    }
    return {
      ok: false, dialect: 'pcf', guard: 'pcf:syntax', index: 0, token: '',
      error: `${PCF_REFUSALS['pcf:syntax']} — ${String(err && err.message ? err.message : err)}`,
    }
  }
}

// --------------------------------------------------------------------------- //
// which dialect is this?
// --------------------------------------------------------------------------- //

/** A marker only TC2000 produces. ⚠️ THE SINGLE-LETTER PRICE TOKENS ARE
 *  UPPERCASE-ONLY ON PURPOSE: every name this table declares is lowercase, so an
 *  uppercase `C` cannot be a native name, while a lowercase `c` might one day
 *  be. PCF itself is case-insensitive and a member who types `avgc50` still
 *  lands here through the multi-character markers. */
const PCF_MARKERS = [
  /\b(AND|OR|NOT|XOR|IIF|XUP|XDOWN|GREATEST|LEAST)\b/i,
  // ⛔ `MOD` IS THE ONE MARKER THAT IS ALSO A NATIVE NAME, so it must match only
  // the INFIX spelling. TC2000 writes `V MOD 100`; this engine writes
  // `mod(volume, 100)` — and once `mod` joined the closed table, a bare `\bMOD\b`
  // read every native formula containing it as TC2000 and handed it to the wrong
  // parser. The negative lookahead is what keeps the two dialects apart.
  /\bMOD\b(?!\s*\()/i,
  /<>/,
  /\b(X?AVG|MAX|MIN)[COHLV]\d/i,
  // ⛔ THE FUNDAMENTALS MUST BE MARKERS TOO, for exactly the reason `BOP` was:
  // `Capitalization > 250` carries no price letter and no fused indicator, so
  // without this it is DETECTED as native, handed to the wrong reader, and
  // refused at `sentence:name` for a spelling the TC2000 reader knows perfectly
  // well. Neither word is a native name, so no native formula can be captured.
  /\b(CAPITALIZATION|MARKETCAP)\b/i,
  // The dialog indicators, so a member who pasted one gets the TC2000 reader's
  // named refusal instead of the native reader's "this is several expressions".
  /\bPrice\s+History\b/i,
  /\bPrice\s+as\s+Percent\s+of\s+52\s+Week\s+High\b/i,
  // ⛔ EVERY FUSED FAMILY THIS READER ACCEPTS MUST APPEAR HERE, or the source
  // parses as TC2000 and is DETECTED as native — handed to the wrong reader, then
  // refused for a reason that has nothing to do with the script. `BOP` was added
  // to `PCF_FUSED` and missed here; the corpus caught it because `detectDialect`
  // is asserted over every accepted source, which is exactly why that rail exists.
  /\b(STDDEV|WRSI|ATR|MACD|STOC|BOP|CCI|ADX|DIPLUS|DIMINUS)\d/i,
  /(^|[^A-Za-z0-9_.])[COHLV]\d*(?![A-Za-z0-9_])/,
  /(^|[^<>!=])=(?!=)/,
]

/** A marker only the native dialect produces. */
const NATIVE_MARKERS = [/&&/, /\|\|/, /==/, /!=/, /\?/]

/** Which reader should read this source.
 *
 *  ⭐ NATIVE UNLESS SOMETHING IS UNAMBIGUOUSLY TC2000, and never when something
 *  is unambiguously native. That asymmetry is deliberate: every formula this
 *  product has ever saved is native, so the detector must be incapable of
 *  taking one away — the existing corpus contains no PCF marker, and
 *  `pcf.test.js` asserts that over the committed corpus rather than assuming it.
 *
 *  ⛔ IT IS NOT A FALLBACK. A source is read by ONE reader and the refusal a
 *  member sees is that reader's. Trying native, failing, then trying PCF would
 *  report a PCF refusal for a native typo — the wrong-door defect this branch
 *  has now found five times. */
export function detectDialect(source) {
  if (typeof source !== 'string' || source.trim() === '') return 'native'
  if (NATIVE_MARKERS.some((re) => re.test(source))) return 'native'
  return PCF_MARKERS.some((re) => re.test(source)) ? 'pcf' : 'native'
}

/** name → the reader. ⚠️ THE KEY SET IS THE DIALECT VOCABULARY, and an unknown
 *  name resolves to `native` rather than throwing: a bad argument must not take
 *  a text box or a schema validator down. */
export const READERS = Object.freeze({
  native: parseFormula,
  pcf: (source) => parsePcf(source),
})

/** ⭐ THE ONE PLACE THAT DECIDES WHICH LANGUAGE A SOURCE STRING IS IN.
 *
 *  Three callers need this and they must never disagree: the text box (which
 *  reads what a member is typing), `defSchema.validateAstCompute` (which
 *  re-reads a STORED source and refuses a pair that disagrees with its tree),
 *  and anything that later round-trips a saved definition back into an editor.
 *  A second copy of the decision would let a formula save and then fail to
 *  validate — a SECOND AUTHORITY OVER ONE VALUE, this repo's most repeated
 *  defect.
 *
 *  @returns {{dialect: string, result: object}} `result` is the reader's own
 *           tagged return, unedited, so the refusal a caller reports is the
 *           refusing door's.
 */
export function readFormulaSource(source, dialect = 'auto') {
  const named = dialect && dialect !== 'auto' && READERS[dialect] ? dialect : detectDialect(source)
  const use = READERS[named] ? named : 'native'
  return { dialect: use, result: READERS[use](source) }
}

// --------------------------------------------------------------------------- //
// the coverage map, MEASURED
// --------------------------------------------------------------------------- //

/** What a member can and cannot express through this reader, computed against a
 *  table rather than written down.
 *
 *  ⭐ THIS IS THE ARTIFACT THE REPORT QUOTES. A coverage map typed into a
 *  document is a description of the day it was written; this one is a function
 *  of the manifest, so the day the indicator agent lands a function the map
 *  moves with it and the test that reads it moves too. */
export function pcfCoverage(table = TABLE, nodeTypes = NODE_TYPES) {
  const letters = priceLetters(table)
  const binding = offsetBinding(nodeTypes)
  const live = []
  const blocked = []

  const consider = (spelling, fn, wanted, note) => {
    if (!own(table.functions, fn)) {
      blocked.push({
        spelling, fn, note,
        reason: `the table does not declare \`${fn}\``,
        toSupport: `declare \`${fn}\`(${wanted.join(', ')}) in closedTable.json and implement it in `
          + 'interpret.js::FN and ast_interpret.py::FN. Nothing in this reader changes.',
      })
      return
    }
    const declared = table.functions[fn].args || []
    const same = declared.length === wanted.length && wanted.every((k, n) => k === declared[n])
    if (!same) {
      blocked.push({
        spelling, fn, note,
        reason: `the table declares \`${fn}\`(${declared.join(', ')}) and this reader fills (${wanted.join(', ')})`,
        toSupport: 'decide which signature is right: change this family’s `series`/`params` to fill '
          + 'the declared one, or move the manifest.',
      })
      return
    }
    live.push({ spelling, fn, note })
  }

  for (const [name, family] of Object.entries(PCF_FUSED)) {
    const series = family.field ? [...letters.values()].slice(0, 1) : family.series
    const ints = family.params.filter((p) => p !== 'offset' && !(family.fixed && own(family.fixed, p)))
    consider(family.spelling, family.fn,
      [...series.map(() => 'series'), ...ints.map(() => 'int')],
      family.field ? `over ${[...letters.keys()].join('/')}` : undefined)
  }
  for (const [name, call] of Object.entries(PCF_CALLS)) {
    consider(`${name}(${call.shape.map((k) => (k === 'window' ? 'period' : 'value')).join(', ')})`,
      call.fn, call.shape.map((k) => (k === 'window' ? 'int' : 'series')),
      call.barsAgo
        ? 'the third argument is bars-ago; 1 or absent maps to the crossing primitive'
        : undefined)
  }

  // ⭐⭐ THE THIRD COLUMN, AND IT IS HALF THE DELIVERABLE. A coverage map that
  // only says what is refused is a LIMITATION; one that says what would have to
  // change is a PLAN. Every `toSupport` below names the artifact that moves —
  // a manifest entry, a walker, a line in this file — never a wish.
  const refused = [
    {
      construct: 'a bar offset — `C1`, `C.1`, `AVGC50.1`, `MAXC252.1`, `C(3)`, `XUP(v, w, 3)`',
      guard: 'pcf:offset',
      state: binding
        ? `SUPPORTED — \`${OFFSET_NODE}\` is one of the engine's canonical node types`
        : 'REFUSED — the engine declares no offset node',
      toSupport: binding
        ? 'nothing; this reader already emits `{type: "offset", value: n, args: [child]}`, which is '
          + 'the shape parse.js defines and assertCanonical checks at the door'
        : 'add the bounded, backward-only, literal-indexed offset to the engine’s canonical node '
          + 'vocabulary (parse.js::NODE_TYPES) and to both walkers. This reader discovers it there '
          + 'and emits it with no edit at all.',
    },
    {
      construct: '`XUP` / `XDOWN` at the DEFAULT one-bar distance',
      guard: null,
      state: 'SUPPORTED, with a boundary difference',
      toSupport: 'TC2000 defines XUP as `prior < level` AND `now >= level`; this table’s `crossOver` '
        + 'is `prior <= level` AND `now > level`. They disagree only when a value lands EXACTLY on '
        + 'the level — reachable on a round-number threshold. Exact parity needs either an '
        + 'inclusive-boundary crossing declared in closedTable.json, or this reader always spelling '
        + 'TC2000’s definition out, which it already does for a bars-ago other than 1.',
    },
    {
      construct: '`SUM(w, x)` — used by six published indicator templates',
      guard: 'pcf:name',
      state: 'REFUSED',
      toSupport: 'declare `sum(series, int)` with `lookback: "arg1"` in closedTable.json and '
        + 'implement it in both walkers. Adding `SUM` to PCF_CALLS is then one line.',
    },
    {
      construct: '`FAVG` (front-weighted average), `HAVG` (Hull), `LOG`, `SQR`, `ARCTANH`',
      guard: 'pcf:name',
      state: 'REFUSED',
      toSupport: 'each needs a table function plus both walkers. `LOG`/`SQR`/`ARCTANH` are '
        + 'element-wise maths and cheap; `FAVG`/`HAVG` are real indicators and belong with the '
        + 'indicator family that just landed.',
    },
    {
      construct: '`CountTrue(b, x)`, `SinceTrue(b, x)`, `TrueInRow(b, x)`',
      guard: 'pcf:name',
      state: 'REFUSED',
      toSupport: 'these reduce a CONDITION over a window, and the table has no such shape. It is the '
        + 'one addition here that is not a single function: `args: ["series", "int"]` per verb, plus '
        + 'a decision about what a NaN inside the window means for a count.',
    },
    {
      construct: 'indicator families whose argument ORDER the manifest does not state — `CCIx.z`, '
        + '`DIPLUSd.z`, `DIMINUSd.z`, `AROONUPx.z`, `MSy.z`, `TSVx.z`, `BOPy.z`, `WSTOCx.y.z`',
      guard: 'pcf:name',
      state: 'REFUSED — deliberately, even where the table declares the function',
      toSupport: 'the table declares `cci`, `plusDI`, `minusDI` and `williamsR` with three `series` '
        + 'arguments and does not say WHICH three or in what order. Guessing right today is a silent '
        + 'misread the day it is guessed wrong. Pin the order in `_functions_indicators` — it '
        + 'already does exactly that for `atr` and `stoch`, which is why those two ARE supported — '
        + 'and each family becomes one line here. `MS`/`TSV`/`WSTOC`/`AROON`/`BOP` are Worden’s own '
        + 'indicators and need the maths in both walkers first.',
    },
    {
      construct: '`RSIx.y.z` — TC2000’s "plain" RSI',
      guard: 'pcf:name',
      state: 'REFUSED deliberately; `WRSI<x>` (Wilder’s) IS supported',
      toSupport: 'nothing should change until somebody pins what Worden’s plain RSI computes. Its own '
        + 'template table derives the Kaufman Efficiency Ratio from it (`2 * RSIx.y.z - 100`) and '
        + 'declares Wilder’s separately as `WRSIx.z`, so `RSI14` is NOT the 14-period RSI a scan '
        + 'usually means. Mapping it to `rsi` would be a correct-looking number from the wrong '
        + 'indicator — the exact failure a refusal surface cannot catch.',
    },
    {
      construct: '`v ++ w`, `v +- w`, `v -+ w`, `v -- w` — TC2000’s typo-tolerant add/subtract',
      guard: 'pcf:syntax',
      state: 'REFUSED',
      toSupport: 'four lines in this reader’s tokenizer and no engine change at all. Left out because '
        + 'the doubled forms are indistinguishable from `a - -b` without a whitespace rule, and a '
        + 'whitespace-sensitive operator is worse than a refusal at the character.',
    },
    {
      construct: 'a string comparison — `sector = "Technology"`, `patterns` membership',
      guard: 'pcf:character',
      state: 'REFUSED',
      toSupport: 'closedTable.json::_scalars_excluded already owns this decision and states the cost: '
        + 'the table’s only literal is a number, so granting strings means a literal kind in the '
        + 'parser, both walkers, the linter and the read-back. It is a phase, not a line.',
    },
  ]

  return {
    priceLetters: Object.fromEntries(letters),
    operators: Object.fromEntries(Object.entries(INFIX).map(([k, v]) => [k, v.op])),
    offset: { binding, node: OFFSET_NODE, nodeTypes: [...nodeTypes] },
    live,
    blocked,
    refused,
  }
}
