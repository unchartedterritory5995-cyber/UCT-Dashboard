// app/src/components/chart/engine/ast/callExpansions.js
//
// ─── ⭐⭐ BATCH 2 — FORMULA FUNCTIONS THAT ARE EXACT IDENTITIES OVER THE TABLE ───
//
// Linear regression, correlation, VWMA, rate of change, momentum and the Keltner
// Channel bands cost the closed table NOTHING: each is an exact closed form over
// functions both interpreters already compute (`sum`, `wma`, `sma`, `stdev`,
// `ema`, offsets, arithmetic). The Pine translator has expanded `ta.linreg`,
// `ta.correlation`, `ta.vwma`, `ta.roc` and `ta.mom` this way since C1, and its
// derivations and vendor checks live beside those expansions in `pine.js`.
//
// ⭐ THIS IS NOW THE ONE COPY. `pine.js::BUILTIN_CALL_TREE` reads these builders,
// the native formula language expands the same names right after it parses
// (`parse.js::parseFormula`), and the conversational door expands a model's call
// before its tree gate (`applyPatch.gateTree`). One builder per name means a
// member's `linreg(close, 50, 0)` and an imported `ta.linreg(close, 50, 0)` are
// THE SAME TREE (the same `astHash`) — not two spellings that happen to agree.
//
// ⛔ A STORED DEFINITION CARRIES ONLY THE EXPANSION. No interpreter, alert lane,
// screen, budget or linter learns a new name, so nothing downstream can disagree
// about what these compute. Readable names come back STRUCTURALLY
// (`recogniseExpansion`), the same way colour-rule helpers are recognised.
//
// ⛔ A BUILDER DECLINES (null) RATHER THAN GUESSING: a window that is not a whole
// number literal (≥ 1, or ≥ 2 where the maths divides by n−1) has no expansion,
// and the caller refuses it by name.
//
// The server mirrors these builders for the trees a model emits
// (`api/services/call_expansions.py`); `tests/test_call_expansions_parity.py`
// runs this module through node and requires byte-identical trees.

// ⚠️ A NEGATIVE LITERAL IS `u-` OF A POSITIVE ONE, because that is what the parser
// produces when it reads the text the printer writes (`pine.js::cNum`, same rule).
const cNum = (value) => (value < 0
  ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] }
  : { type: 'num', value })
const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
const cCall = (name, args) => ({ type: 'call', name, args })

/** A whole-number literal window ≥ `min`, or NaN. */
function windowOf(node, min) {
  const n = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(n) && Number.isInteger(n) && n >= min ? n : NaN
}

/** Pine's `ta.tr` (no first-bar fallback) — `pine.js::BUILTIN_SERIES_TREE.tr`. */
export function trueRangeTree() {
  const prevClose = { type: 'offset', value: 1, args: [cSeries('close')] }
  const gap = (side) => cCall('abs', [cOp('-', [cSeries(side), prevClose])])
  return cCall('max', [
    cOp('-', [cSeries('high'), cSeries('low')]),
    cCall('max', [gap('high'), gap('low')]),
  ])
}

// ─── ⭐⭐ SUPERTREND — THE FIRST EXPANSION THAT CARRIES BAR-TO-BAR STATE ─────────
//
// The manifest used to refuse this name because the grammar had "no self-reference"
// (`closedTable.json::_functions_excluded._supertrend_was_here` keeps the history). It has
// one now: `accum(seed, body, warmup)`
// (`_functions_recurrence`), the bounded recurrence both interpreters run. TradingView's
// `ta.supertrend(factor, atrPeriod)` is three such recurrences composed, and nothing
// else — so it is an EXPANSION, never a new table entry or a new evaluator:
//
//   upper  = accum(nz(up, 0), (up < prev || close[1] > prev) ? up : prev, W)   — the ratchet
//   lower  = accum(nz(dn, 0), (dn > prev || close[1] < prev) ? dn : prev, W)
//            with prev = nz(self, 0)
//   dir    = accum(1, na(atrPine[1]) ? 1
//                   : self == 1 ? (close > upper ? -1 : 1)
//                              : (close < lower ? 1 : -1), W)           — the flip
//   value  = dir == -1 ? lower : upper
//
// with `up/dn = hl2 ± factor × atrPine(n)` — Pine's own ATR seed (`atrPine`), so the
// band is TradingView's band, and Pine's direction convention: −1 is an UP-trend (the
// line sits below price), 1 a DOWN-trend. `prevSuperTrend == prevUpperBand` in Pine's
// source is "the previous direction was 1", which is what `dir`'s own state says.
//
// ⭐⭐ ENGINE 57 — THE `nz` IS PINE'S, AND WITHOUT IT THE LISTING DREW NOTHING. Pine's
// `pine_supertrend` reads `prevUpperBand = nz(upperBand[1])` (and the lower band the same
// way) and sets the direction to 1 while `na(atr[1])`. The expansion had neither: seeded
// with the raw band, which is `na` for the ATR's first `n - 1` bars, a ratchet whose
// comparisons answer 0 on an `na` operand (`interpret.js::cmp`) picked `self` and held
// `na` FOREVER. Off the listing that was invisible (every window is re-seeded where the
// ATR is long known). From the listing (`opts.historyFromListing`, the listing pass runs
// from bar 0) it latched on bar 0, and the builtin Supertrend drew NOTHING on all 666
// bars of NYSE:RDDT 1D (capture `supertrend-0c4115d2-rddt-1d-2026-11-14`, S6). With the
// two `nz`s and the `na(atr[1])` arm the bands are Pine's own from bar 0: an independent
// full-history reference (`supertrend.test.js::pineSupertrend`) has 0 mismatches against
// the capture on both plots over 666 bars, and so does every bar this expansion draws.
// Off the listing a window's bands and direction are unchanged wherever they were known.
//
// ⛔ BOUNDED, AND THEREFORE HONEST ABOUT ITS LEFT EDGE. Each recurrence re-seeds `W`
// bars back, so a value is a function of a fixed window and never of how many bars were
// fetched. The direction reads the two bands across ITS window, so the value is WITHHELD
// (`na`) until both bands were already known `W` bars earlier — the guard below. Before
// it, the direction would be read off bands that do not exist yet (measured: the first
// ~W published bars disagreed with a full-history reference on every seed).
// ⛔ ENGINE 57 KEEPS THE GUARD OFF THE LISTING AND LIFTS IT ON IT: it is now the bounded
// window's own curtain `2W + n - 1` deep (`unknown` below), `na` on bars `t < 2W + n - 1` off the
// listing exactly as before, and known on every bar from the listing, where the bands and
// the direction are Pine's own from bar 0.
// ⭐ MEASURED AGREEMENT (2026-10-29, `supertrend.test.js`): against an independent
// full-history implementation of Pine's published `ta.supertrend`, 0 of 77,820 published
// bars differ at W = 200 over 30 random-walk series × 3 (factor, period) settings — and
// the rail re-measures it on every run. A ratchet seeded from a different history can in
// principle disagree for longer than W; that is the bounded-recurrence bargain
// `_functions_recurrence` already states for every `accum`, and it is why W is 200.
export const SUPERTREND_WARMUP = 200
/** What a member is told wherever vendor notes are shown. ⛔ The claim is the measured
 *  one and no stronger: the bounded window agrees on every bar we have measured, and a
 *  band whose last reset is older than the window CAN disagree. */
export const SUPERTREND_NOTE = `TradingView carries the Supertrend bands from the first bar of history; this engine re-seeds each band ${SUPERTREND_WARMUP} bars back and shows nothing for the first ~${2 * SUPERTREND_WARMUP} bars plus the ATR period, except on a chart whose history starts at the symbol's listing, where it carries them from the first bar as TradingView does. Every shown bar matched TradingView's published formula on the series we measured, but a band whose last reset is more than ${SUPERTREND_WARMUP} bars old can differ, and so can the first bars after the warm-up at a long ATR period, whose average is still settling.`
/** The name an `accum` body reads its own previous value through —
 *  `closedTable.json::functions.accum.recurrence.binds`. Typed here only because this
 *  module is also run by plain node (the parity test), which cannot import JSON; the
 *  rail `supertrend.test.js` (and the Python one) asserts it IS the manifest's value. */
export const ACCUM_SELF = 'self'

/** A positive finite number literal (a supertrend factor), or NaN. */
function factorOf(node) {
  const f = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(f) && f > 0 ? f : NaN
}

/** `{value, direction}` trees for `ta.supertrend(factor, n)`, or null. */
export function supertrendTrees(factorNode, periodNode, warmup = SUPERTREND_WARMUP) {
  const f = factorOf(factorNode)
  const n = windowOf(periodNode, 1)
  if (!Number.isFinite(f) || !Number.isFinite(n)) return null
  const self = cSeries(ACCUM_SELF)
  const close = cSeries('close')
  const prevClose = { type: 'offset', value: 1, args: [close] }
  const hl2 = cOp('/', [cOp('+', [cSeries('high'), cSeries('low')]), cNum(2)])
  const atr = cCall('atrPine', [cSeries('high'), cSeries('low'), close, cNum(n)])
  const band = (sign) => cOp(sign, [hl2, cOp('*', [cNum(f), atr])])
  const up = band('+')
  const dn = band('-')
  const W = cNum(warmup)
  const zero = cNum(0)
  // Pine's `nz(upperBand[1])` / `nz(lowerBand[1])`: the previous band, 0 where it is `na`
  const prev = cCall('nz', [self, zero])
  const upper = cCall('accum', [cCall('nz', [up, zero]), cOp('?:', [
    cOp('||', [cOp('<', [up, prev]), cOp('>', [prevClose, prev])]), up, prev]), W])
  const lower = cCall('accum', [cCall('nz', [dn, zero]), cOp('?:', [
    cOp('||', [cOp('>', [dn, prev]), cOp('<', [prevClose, prev])]), dn, prev]), W])
  const one = cNum(1)
  const minusOne = cNum(-1)
  // Pine's `if na(atr[1]) direction := 1`, then the flip
  const direction = cCall('accum', [one, cOp('?:', [
    cCall('na', [{ type: 'offset', value: 1, args: [atr] }]),
    one,
    cOp('?:', [
      cOp('==', [self, one]),
      cOp('?:', [cOp('>', [close, upper]), minusOne, one]),
      cOp('?:', [cOp('<', [close, lower]), one, minusOne]),
    ]),
  ]), W])
  // ⭐⭐ ENGINE 57 — THE GUARD IS A BOUNDED WINDOW'S OWN CURTAIN, `2W + n - 1` DEEP. Off the
  // listing a bounded `accum` is `na` before its warm-up bar, so `accum(0, 0, 2W + n - 1)` is `na`
  // exactly on bars `t < 2W + n - 1` — the bars the base expansion withheld (its raw band seeds
  // were `na` through the ATR's `n - 1` warm-up bars, so its `na(upper[W]) || na(lower[W])` held
  // for `t < 2W + n - 1`, not `t < 2W`; review F2, railed against a verbatim copy of the base
  // tree in `supertrend.test.js`). It is in the TREE, so every consumer withholds those bars —
  // the bare `interpret()`, the screen, the Python lane — whatever warm-up mask it applies or not.
  // Its body is the constant 0, which forgets its seed at once, so nothing reads it as a value
  // carried from before the loaded bars (`varOriginMask`; ⚰️ an identity body
  // `accum(accum(0, self, W), self, W)` was withheld whole off the listing as `var-origin:window`).
  // From the listing (`opts.historyFromListing`) the listing pass runs it from bar 0 and it is 0 on
  // every bar, so nothing is withheld there: the bands and the direction are Pine's own from bar 0
  // (the S6 capture: every drawn bar of both plots, 348 Up + 309 Down, equal). ⚰️ The offset form
  // could not do that: `upper[W]` reaches before bar 0 on bars `t < W`, which the listing reads as
  // Pine's `na`, so it blanked bars 9..199 that TradingView draws — and `||` also read the upper
  // band's REAL `na` on bars 1..n-2 (the ATR warm-up) as unknown and blanked bars W+1..W+n-2.
  // ⚠️ RESIDUAL, unchanged from the base: off the listing `atrPine` is an RMA seeded on this chart's
  // bar n-1, which converges to TradingView's only as (1 - 1/n)^k; at a long period (n = 50) bars
  // past the curtain can still differ at the 1e-6 level (`SUPERTREND_NOTE` says so).
  const unknown = cCall('na', [cCall('accum', [cNum(0), cNum(0), cNum(2 * warmup + n - 1)])])
  const na = cOp('/', [cNum(0), cNum(0)])
  return {
    value: cOp('?:', [unknown, na, cOp('?:', [cOp('==', [direction, minusOne]), lower, upper])]),
    direction: cOp('?:', [unknown, na, direction]),
  }
}

// ─── ⭐⭐ PARABOLIC SAR — THE FIRST EXPANSION OVER A MULTI-STATE RECURRENCE ─────
//
// `closedTable.json::_functions_excluded.sar` refused this name because SAR
// carries a trend, a stop, an extreme point and an acceleration factor that all
// read one another bar to bar — a tuple no single `accum` could hold. `accum4`
// (`_functions_multi_state`) is that tuple, so `sar(step, maxStep)` ships as an
// EXPANSION, never a table entry, exactly as Supertrend did.
//
// ⭐ THE RULES ARE THE CHART'S OWN. `indicators.js::computeParabolicSAR` is the
// Parabolic SAR the chart already draws, so the formula's `sar` is that one rule —
// never a second SAR that disagrees with the indicator beside it:
//
//   proj   = sar + af·(ep − sar)
//   up:    stop = min(proj, low[1], low[2]);  low < stop  ⇒ flip down, sar = ep, ep = low,  af = step
//                                             else high > ep ⇒ ep = high, af = min(af + step, maxStep)
//   down:  stop = max(proj, high[1], high[2]); high > stop ⇒ flip up,  sar = ep, ep = high, af = step
//                                             else low < ep  ⇒ ep = low,  af = min(af + step, maxStep)
//
// with the window seeded at bar `i − W` as the chart seeds bar 0: up if the close
// rose, the stop at that bar's low (high), the extreme at its high (low), af = step.
//
// ⛔ BOUNDED, AND THE DOMAIN IS THE MEASURED ONE. The chart's SAR runs from the
// first bar; this re-seeds `W` bars back. The old ruling's worry — "a missed trend
// flip never decays out of the state" — was MEASURED (2026-10-30): with step ≥ 0.02
// and maxStep ≥ 0.2 the windowed value equals the full-history chart SAR on every
// bar measured — 0 of 212,206 bars over 38 distinct captured series, and 0 of
// ~650,000 synthetic bars across trending, grinding, spiking and choppy regimes —
// because the clamp to the prior two lows/highs and an `af` that reaches 0.2 merge
// two trajectories exactly. BELOW that domain it does not: step 0.01 drifted up to
// 5%, step 0.001 up to 34%. So a slower setting is REFUSED by name rather than
// served from a different history — `expansionProblem` says so and names the chart
// indicator, which runs from the first bar, as the alternative.
// ⛔ The value is withheld until the window's seed bar has a previous close
// (`close[W + 1]` known), so no published bar reads a seed that does not exist.
//
// ⚰️ W WAS 200 UNTIL 2026-11-16, AND 200 WAS NOT ENOUGH. `vw-lower-tf-bars-rddt-15-2026-11-16`
// (NYSE:RDDT 15m, 20,886 bars) put 43 published bars (5167-5246) off the full-history SAR, 17 of
// them in value AND direction: a SAR seeded at bar 4967 needs 280 bars to rejoin the full history.
// ⭐ W = 400, CHOSEN BY MEASUREMENT (docs/pine/evidence/2026-11-16-sar-window/EVIDENCE.md). The
// "merge distance" (how many bars a SAR seeded at bar s needs to equal the full-history state) was
// measured on 342 series: the 62 distinct captured series plus 280 sampled from the local bars
// store, 40 per timeframe at 1m, 5m, 15m, 30m, 60m, D and W. That is 1.1M bars at step 0.02,
// max 0.2.
//   · The worst distances: 280 (RDDT 15m), 265 (META 15m), 253 (BCBP D), 250 (SPY 1m).
//   · W = 200: 312 published bars wrong. W = 300, 400 and 600: 0 of 1,039,563 at 400.
//   · 400 is 1.43x the worst measured, and its lookback (402) fits the 550-bar budget.
//   · The compute is unchanged: the merged windows step about 25.6 states per bar at both 200 and
//     400. What it costs is 200 more leading bars before the first value, and a deeper fetch.
// ⛔ NO FINITE WINDOW IS A PROOF. Where price sets no new high or low and the SAR never flips,
// two starting points can stay apart indefinitely (a series of identical bars does). That is
// SAR_NOTE's caveat. Two windows that agree prove nothing either: every seed inside such a
// stretch agrees with every other while the full history differs.
// ⭐ A DOCUMENT SAVED BEFORE THIS CHANGE carries the 200-bar tree (a stored tree is not
// re-expanded on load). `recogniseExpansion` reads that legacy tree back as the
// `sar(step, maxStep)` the member wrote, so the next save re-expands it at 400.
// `SAR_LEGACY_WARMUPS` names the windows earlier engines saved. A load-time rewrite is an
// engine-gap row (`docs/pine/capture-queue-2026-11-16-sar-window.md`).
export const SAR_WARMUP = 400
export const SAR_LEGACY_WARMUPS = Object.freeze([200])
export const SAR_MIN_STEP = 0.02
export const SAR_MIN_MAX_STEP = 0.2
export const SAR_NOTE = `Parabolic SAR here uses the chart's own Parabolic SAR rules and starts each value ${SAR_WARMUP} bars back instead of at the first bar of history. With a step of at least ${SAR_MIN_STEP} and a maximum of at least ${SAR_MIN_MAX_STEP} it matched the chart's full-history SAR on every bar we measured, across 342 price series. During a long stretch where price sets no new high or low and the SAR never flips, it can still differ from a chart that started further back. It is not TradingView's ta.sar, whose first bars and reversal details differ.`

/** A finite number literal in (0, 1], or NaN. */
function accelOf(node) {
  const f = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(f) && f > 0 && f <= 1 ? f : NaN
}

/** `{value, direction}` trees for Parabolic SAR with `(step, maxStep)`, or null
 *  outside the measured domain. `direction` is 1 in an up-trend (the stop below
 *  price) and −1 in a down-trend — the chart's own `isUptrend`. */
export function sarTrees(stepNode, maxNode, warmup = SAR_WARMUP) {
  const step = accelOf(stepNode)
  const max = accelOf(maxNode)
  if (!Number.isFinite(step) || !Number.isFinite(max)) return null
  if (step < SAR_MIN_STEP || max < SAR_MIN_MAX_STEP || max < step) return null
  const s = (k) => cSeries(`state${k}`)
  const H = cSeries('high')
  const L = cSeries('low')
  const C = cSeries('close')
  const back = (node, n) => ({ type: 'offset', value: n, args: [node] })
  const one = cNum(1)
  const minusOne = cNum(-1)
  const STEP = cNum(step)
  const MAX = cNum(max)
  // seeds — the bar the window starts on, read as the chart reads bar 0
  const rose = cOp('>', [C, back(C, 1)])
  const seedTrend = cOp('?:', [rose, one, minusOne])
  const seedSar = cOp('?:', [rose, L, H])
  const seedEp = cOp('?:', [rose, H, L])
  // updates — every one reads LAST bar's four states
  const isUp = cOp('==', [s(1), one])
  const proj = cOp('+', [s(2), cOp('*', [s(4), cOp('-', [s(3), s(2)])])])
  const upStop = cCall('min', [proj, cCall('min', [back(L, 1), back(L, 2)])])
  const dnStop = cCall('max', [proj, cCall('max', [back(H, 1), back(H, 2)])])
  const flipDn = cOp('<', [L, upStop])
  const flipUp = cOp('>', [H, dnStop])
  const newHigh = cOp('>', [H, s(3)])
  const newLow = cOp('<', [L, s(3)])
  const faster = cCall('min', [cOp('+', [s(4), STEP]), MAX])
  const trend = cOp('?:', [isUp, cOp('?:', [flipDn, minusOne, one]), cOp('?:', [flipUp, one, minusOne])])
  const sar = cOp('?:', [isUp, cOp('?:', [flipDn, s(3), upStop]), cOp('?:', [flipUp, s(3), dnStop])])
  const ep = cOp('?:', [isUp,
    cOp('?:', [flipDn, L, cOp('?:', [newHigh, H, s(3)])]),
    cOp('?:', [flipUp, H, cOp('?:', [newLow, L, s(3)])])])
  const af = cOp('?:', [isUp,
    cOp('?:', [flipDn, STEP, cOp('?:', [newHigh, faster, s(4)])]),
    cOp('?:', [flipUp, STEP, cOp('?:', [newLow, faster, s(4)])])])
  // ⛔ A MISSING BAR POISONS ITS WINDOWS, never a confident guess. With `low` unknown
  // the flip test would read "no reversal" (a comparison with `na` is 0) and carry
  // on as if nothing happened; instead every state goes `na`, so each window holding
  // the hole is withheld and the value comes back once the hole leaves the window.
  const na = cOp('/', [cNum(0), cNum(0)])
  const hole = cOp('||', [cCall('na', [H]), cCall('na', [L])])
  const guarded = (u) => cOp('?:', [hole, na, u])
  const W = cNum(warmup)
  const run = (output) => cCall('accum4', [cNum(output), W, seedTrend, seedSar, seedEp, STEP,
    guarded(trend), guarded(sar), guarded(ep), guarded(af)])
  const unknown = cCall('na', [back(C, warmup + 1)])
  const value = run(2)
  return {
    value: cOp('?:', [unknown, na, value]),
    // the direction is shown exactly where the stop is
    direction: cOp('?:', [cOp('||', [unknown, cCall('na', [value])]), na, run(1)]),
  }
}

/**
 * name → `{ min, max, describe, build(args) → tree | null }`. `args` are canonical
 * trees; `describe` is the formula-reference line for the vocabulary list.
 */
// ─── ⭐⭐ FISHER TRANSFORM — Engine 79 (#1871) (studio, 2026-11-18) ────────────────
//
// TradingView's built-in, as a capture reads it (SPY daily from its listing, 8,509 bars, lengths
// 9 and 20) and as Tulip Indicators publishes it, citing Ehlers:
//
//   x      = (hl2 − lowest(hl2, n)) / (highest(hl2, n) − lowest(hl2, n))
//   value  = 0.66 · (x − 0.5) + 0.67 · value[1]         (a missing value[1] is read as 0)
//   value  = 0.999 if value > 0.99, −0.999 if value < −0.99      ← a SNAP, not a clamp
//   fisher = 0.5 · ln((1 + value) / (1 − value)) + 0.5 · fisher[1]
//
// Two running values replaced together (`accum2`): the first is `value`, the second the Fisher
// line, which needs `value` as it is on THIS bar and so writes its update out again. The snap is a
// choice on its own value, so nothing in its SHAPE proves that where it started stops mattering;
// it is offered on evidence instead, like `supertrend` and `sar`. GRADED: this exact tree, through
// this engine, with each value restarted FISHER_WARMUP bars back, equals TradingView's Fisher line
// on every bar it has a value for at both lengths (8,209 of 8,209; largest relative difference 3
// parts in 10 quadrillion). It has no value on a chart's first FISHER_WARMUP bars, where
// TradingView's has one from the first full range. The capture is vendor data and is not in the
// repository; `callExpansions.test.js` holds this builder to the fingerprint of the tree that was
// graded, so the evidence cannot drift from the code.
//
// ⛔ NO PINE NAME. Pine has no `ta.fisher`; `pine.js::BUILTIN_CALL_TREE` gets no entry for it, and
// the translator's output is unchanged by this function existing.
//
// The trigger line TradingView draws beside it is `fisher(n)[1]`: the same function, one bar back.
export const FISHER_WARMUP = 300
export const FISHER_NOTE = `This Fisher Transform starts each value ${FISHER_WARMUP} bars back on every bar, so the first ${FISHER_WARMUP} bars of a chart's history have no value. After that it is equal to TradingView's Fisher Transform on captured charts.`

export function fisherTree(lengthNode, warmup = FISHER_WARMUP) {
  const n = windowOf(lengthNode, 2)
  if (!Number.isFinite(n)) return null
  // every use is a fresh node: a stored tree shares nothing
  const hl2 = () => cOp('/', [cOp('+', [cSeries('high'), cSeries('low')]), cNum(2)])
  const lo = () => cCall('lowest', [hl2(), cNum(n)])
  const hi = () => cCall('highest', [hl2(), cNum(n)])
  const x = () => cOp('/', [cOp('-', [hl2(), lo()]), cOp('-', [hi(), lo()])])
  const raw = () => cOp('+', [
    cOp('*', [cNum(0.66), cOp('-', [x(), cNum(0.5)])]),
    cOp('*', [cNum(0.67), cCall('nz', [cSeries('state1'), cNum(0)])]),
  ])
  const value = () => cOp('?:', [
    cOp('>', [raw(), cNum(0.99)]), cNum(0.999),
    cOp('?:', [cOp('<', [raw(), cNum(-0.99)]), cNum(-0.999), raw()]),
  ])
  const fisher = cOp('+', [
    cOp('*', [cNum(0.5), cCall('ln', [cOp('/', [cOp('+', [cNum(1), value()]), cOp('-', [cNum(1), value()])])])]),
    cOp('*', [cNum(0.5), cCall('nz', [cSeries('state2'), cNum(0)])]),
  ])
  return cCall('accum2', [cNum(2), cNum(warmup), cNum(0), cNum(0), value(), fisher])
}

// ─── ⭐⭐ LAGUERRE FILTER AND LAGUERRE RSI — Engine 79 (#1882) (studio, 2026-11-18) ─
//
// Ehlers' four-stage Laguerre filter ("Time Warp - Without Space Travel"), as published:
//
//   L0 = (1 − γ)·src + γ·L0[1]
//   L1 = −γ·L0 + L0[1] + γ·L1[1]          (L2 and L3 the same, one stage on)
//   Laguerre Filter = (L0 + 2·L1 + 2·L2 + L3) / 6
//   Laguerre RSI    = CU / (CU + CD), where each neighbouring pair's gap goes to CU when the
//                     earlier stage is at or above the later one and to CD otherwise
//
// Four running values replaced together (`accum4`); a stage that needs the one before it on THIS
// bar writes that stage's update out again. Every update is a plain-number mix of the four, so by
// its shape the starting values provably stop mattering (the linear shape of
// `api/services/running_values.py`); these two are functions for a different reason: written out,
// the RSI reads the four stages a dozen times and is thousands of nodes.
//
// ⭐ THE RSI IS WRITTEN AS 0.5 + 0.5·(L0 − L3) / (|L0−L1| + |L1−L2| + |L2−L3|). The three gaps
// telescope: CU − CD is L0 − L3 and CU + CD is the sum of their sizes, so this is CU / (CU + CD),
// the same number, read from eight stage references where the published wording needs thirty-six
// (which would write out three times what a formula may hold). 0 to 1; no value where all four
// stages are equal, as published.
//
// ⭐ THE RESTART WINDOW IS SIZED FROM GAMMA (`LAGUERRE_WARMUPS`). The larger gamma is, the longer
// the filter remembers: it needs 27 bars to forget its start at 0.5, 82 at 0.8, 354 at 0.95, and
// more than a chart formula may reach above about 0.97. Each tier's window leaves less than a
// billionth of the start at its largest gamma; a gamma above LAGUERRE_MAX_GAMMA is declined.
//
// GRADED: TradingView running a probe written from the published equations (SPY daily from its
// listing, 8,509 bars) against these trees through this engine: the filter at γ 0.8 over hl2 is
// equal on every bar it has a value for to 1 part in a quadrillion, the RSI at γ 0.5 over the
// close to 2 parts in 100 billion (what a 64-bar restart leaves). That witnesses this engine's
// restart against a carried run of the SAME equations; TradingView has no Laguerre of its own, so
// nothing here "matches TradingView's". `callExpansions.test.js` holds these builders to the
// fingerprints of the trees that were graded.
//
// ⛔ NO PINE NAME, as for `fisher`.
export const LAGUERRE_MAX_GAMMA = 0.95
/** [the largest gamma of the tier, how many bars back each value is restarted]. */
export const LAGUERRE_WARMUPS = Object.freeze([[0.5, 64], [0.7, 128], [0.8, 192], [0.9, 400], [0.95, 800]])
/** A source may not itself be a running value: one never sits inside another. */
const RUNNING_NAMES = new Set(['accum', 'accum2', 'accum3', 'accum4', 'supertrend', 'supertrendDirection', 'sar', 'sarDirection',
  'fisher', 'laguerre', 'laguerreRsi'])
function gammaOf(node) {
  const g = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(g) && g > 0 && g <= LAGUERRE_MAX_GAMMA ? g : NaN
}
export function laguerreWarmup(gamma) {
  for (const [most, bars] of LAGUERRE_WARMUPS) if (gamma <= most) return bars
  return NaN
}
function holdsRunningValue(node) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'call' && RUNNING_NAMES.has(n.name)) return true
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return false
}
/** Stage `which` (1 to 4) of the Laguerre filter of `sourceNode`, or null. */
export function laguerreStage(sourceNode, gammaNode, which) {
  const g = gammaOf(gammaNode)
  if (!Number.isFinite(g) || !sourceNode || typeof sourceNode !== 'object' || holdsRunningValue(sourceNode)) return null
  const warmup = laguerreWarmup(g)
  const st = (i) => cSeries(`state${i}`)
  const l0 = () => cOp('+', [cOp('*', [cOp('-', [cNum(1), cNum(g)]), sourceNode]), cOp('*', [cNum(g), st(1)])])
  const next = (now, was, own) => cOp('+', [cOp('-', [was, cOp('*', [cNum(g), now])]), cOp('*', [cNum(g), own])])
  const l1 = () => next(l0(), st(1), st(2))
  const l2 = () => next(l1(), st(2), st(3))
  const l3 = () => next(l2(), st(3), st(4))
  return cCall('accum4', [cNum(which), cNum(warmup), sourceNode, sourceNode, sourceNode, sourceNode, l0(), l1(), l2(), l3()])
}
function laguerreFilterTree(a) {
  if (!laguerreStage(a[0], a[1], 1)) return null
  const L = (k) => laguerreStage(a[0], a[1], k)
  const total = cOp('+', [cOp('+', [cOp('+', [L(1), cOp('*', [cNum(2), L(2)])]), cOp('*', [cNum(2), L(3)])]), L(4)])
  return cOp('/', [total, cNum(6)])
}
function laguerreRsiTree(a) {
  if (!laguerreStage(a[0], a[1], 1)) return null
  const L = (k) => laguerreStage(a[0], a[1], k)
  const gap = (i) => cCall('abs', [cOp('-', [L(i), L(i + 1)])])
  const gaps = cOp('+', [cOp('+', [gap(1), gap(2)]), gap(3)])
  return cOp('+', [cNum(0.5), cOp('/', [cOp('*', [cNum(0.5), cOp('-', [L(1), L(4)])]), gaps])])
}

export const CALL_EXPANSIONS = Object.freeze({
  // ta.roc(src, n) = 100 * (src - src[n]) / src[n], grouped left (pine.js note).
  roc: {
    min: 2, max: 2, signature: 'roc(source, length)', describe: 'rate of change, in percent: 100 × (source − source n bars ago) ÷ source n bars ago',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      const prev = { type: 'offset', value: n, args: [a[0]] }
      return cOp('/', [cOp('*', [cNum(100), cOp('-', [a[0], prev])]), prev])
    },
  },
  // ta.mom(src, n) = src - src[n] — roc's own numerator.
  mom: {
    min: 2, max: 2, signature: 'mom(source, length)', describe: 'momentum: source − source n bars ago',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cOp('-', [a[0], { type: 'offset', value: n, args: [a[0]] }])
    },
  },
  // ta.vwma = sma(src·volume, n) / sma(volume, n) — TradingView's published closed form.
  // ⭐ 2026-11-18 — the Detrended Price Oscillator, in TradingView's DEFAULT (not centred) form:
  // the source minus its n-bar simple average AS IT STOOD floor(n / 2) + 1 bars ago. The bars-back
  // count is DERIVED from the length, which is why this is a function: a library entry records
  // where each setting's number sits and has no way to say "half of that one, plus one". An exact
  // closed form over the table, as roc and mom are. (The textbook form reads the PRICE that many
  // bars back against today's average and is drawn shifted into the past: another number.)
  dpo: {
    min: 2, max: 2, signature: 'dpo(source, length)', describe: 'Detrended Price Oscillator (TradingView\'s default form): source − its n-bar simple average as it stood floor(n ÷ 2) + 1 bars ago',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cOp('-', [a[0], { type: 'offset', value: Math.floor(n / 2) + 1, args: [cCall('sma', [a[0], cNum(n)])] }])
    },
  },
  vwma: {
    min: 2, max: 2, signature: 'vwma(source, length)', describe: 'volume-weighted moving average: sma(source × volume) ÷ sma(volume)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      const vol = cSeries('volume')
      return cOp('/', [
        cCall('sma', [cOp('*', [a[0], vol]), cNum(n)]),
        cCall('sma', [vol, cNum(n)]),
      ])
    },
  },
  // ta.linreg(src, n, offset) = sum/n + (n·wma − sum)·C, C = 6((n−1)/2 − offset)/(n(n−1)).
  linreg: {
    min: 2, max: 3, signature: 'linreg(source, length, offset = 0)', describe: 'linear regression: the least-squares line over the last n bars, read `offset` bars back from its end',
    build: (a) => {
      const n = windowOf(a[1], 2)
      const off = a[2] === undefined ? 0 : (a[2] && a[2].type === 'num' ? Number(a[2].value) : NaN)
      if (!Number.isFinite(n) || !Number.isFinite(off)) return null
      const total = cCall('sum', [a[0], cNum(n)])
      const weighted = cCall('wma', [a[0], cNum(n)])
      const C = (6 * ((n - 1) / 2 - off)) / (n * (n - 1))
      return cOp('+', [
        cOp('/', [total, cNum(n)]),
        cOp('*', [cOp('-', [cOp('*', [cNum(n), weighted]), total]), cNum(C)]),
      ])
    },
  },
  // ta.correlation(x, y, n) = (sma(x·y) − sma(x)·sma(y)) / (stdev(x)·stdev(y)).
  correlation: {
    min: 3, max: 3, signature: 'correlation(source1, source2, length)', describe: 'Pearson correlation of two series over n bars, from −1 to 1',
    build: (a) => {
      const n = windowOf(a[2], 2)
      if (!Number.isFinite(n)) return null
      const [x, y] = a
      const covariance = cOp('-', [
        cCall('sma', [cOp('*', [x, y]), cNum(n)]),
        cOp('*', [cCall('sma', [x, cNum(n)]), cCall('sma', [y, cNum(n)])]),
      ])
      return cOp('/', [covariance, cOp('*', [cCall('stdev', [x, cNum(n)]), cCall('stdev', [y, cNum(n)])])])
    },
  },
  // ta.kc(src, n, mult) → [middle, upper, lower]: ema(src,n) ± mult·ema(tr,n) (pine.js `kc`).
  kcMiddle: {
    min: 2, max: 2, signature: 'kcMiddle(source, length)', describe: 'Keltner Channel middle line: ema(source, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cCall('ema', [a[0], cNum(n)])
    },
  },
  kcUpper: {
    min: 3, max: 3, signature: 'kcUpper(source, length, multiplier)', describe: 'Keltner Channel upper band: ema(source, n) + multiplier × ema(true range, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      const mid = cCall('ema', [a[0], cNum(n)])
      return cOp('+', [mid, cOp('*', [a[2], cCall('ema', [trueRangeTree(), cNum(n)])])])
    },
  },
  kcLower: {
    min: 3, max: 3, signature: 'kcLower(source, length, multiplier)', describe: 'Keltner Channel lower band: ema(source, n) − multiplier × ema(true range, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      const mid = cCall('ema', [a[0], cNum(n)])
      return cOp('-', [mid, cOp('*', [a[2], cCall('ema', [trueRangeTree(), cNum(n)])])])
    },
  },
  // ta.bb(src, n, mult) → [middle, upper, lower]: sma(src,n) ± mult·stdev(src,n) — the SAME
  // trees pine.js `PINE_TUPLE_BUILTINS.bb` builds, so a Pine `ta.bb` import and a member's
  // "add Bollinger Bands" store one identity (2026-11-01).
  bbMiddle: {
    min: 2, max: 2, signature: 'bbMiddle(source, length)', describe: 'Bollinger Band middle line: sma(source, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cCall('sma', [a[0], cNum(n)])
    },
  },
  bbUpper: {
    min: 3, max: 3, signature: 'bbUpper(source, length, multiplier)', describe: 'Bollinger Band upper band: sma(source, n) + multiplier × stdev(source, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      return cOp('+', [cCall('sma', [a[0], cNum(n)]), cOp('*', [a[2], cCall('stdev', [a[0], cNum(n)])])])
    },
  },
  bbLower: {
    min: 3, max: 3, signature: 'bbLower(source, length, multiplier)', describe: 'Bollinger Band lower band: sma(source, n) − multiplier × stdev(source, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      return cOp('-', [cCall('sma', [a[0], cNum(n)]), cOp('*', [a[2], cCall('stdev', [a[0], cNum(n)])])])
    },
  },
  // ta.supertrend(factor, atrPeriod)[0] / [1] — see `supertrendTrees` above.
  // ⛔ `vendorNote`: the ONE expansion that is not an exact identity. Its bands are
  // bounded recurrences, so it is disclosed wherever vendor notes are read
  // (`parse.js::vendorNotesForTree`) and an import of `ta.supertrend` is never
  // labelled "exact" — the honesty rule `importOutcome.js` exists for (audit P0-7).
  supertrend: {
    min: 2, max: 2, signature: 'supertrend(factor, atrPeriod)', describe: `Supertrend: the ATR trailing stop that only tightens while the trend holds and flips when price closes through it (TradingView's ta.supertrend; shown after a ${SUPERTREND_WARMUP}-bar warm-up)`,
    vendorNote: SUPERTREND_NOTE,
    build: (a) => { const t = supertrendTrees(a[0], a[1]); return t ? t.value : null },
  },
  supertrendDirection: {
    min: 2, max: 2, signature: 'supertrendDirection(factor, atrPeriod)', describe: 'the Supertrend direction: −1 in an up-trend (the line below price), 1 in a down-trend — TradingView\'s convention',
    vendorNote: SUPERTREND_NOTE,
    build: (a) => { const t = supertrendTrees(a[0], a[1]); return t ? t.direction : null },
  },
  // Parabolic SAR — `sarTrees` above: the chart's own SAR rules over `accum4`.
  // ⛔ `vendorNote`: bounded, and not TradingView's `ta.sar` — disclosed wherever
  // vendor notes are read, exactly as `supertrend` is.
  sar: {
    min: 2, max: 2, signature: 'sar(step, maxStep)', describe: `Parabolic SAR: the stop that trails the trend and jumps to the other side when price crosses it, accelerating by \`step\` up to \`maxStep\` — the chart's own Parabolic SAR (step at least ${SAR_MIN_STEP}, maximum at least ${SAR_MIN_MAX_STEP}; shown after a ${SAR_WARMUP}-bar warm-up)`,
    vendorNote: SAR_NOTE,
    build: (a) => { const t = sarTrees(a[0], a[1]); return t ? t.value : null },
  },
  sarDirection: {
    min: 2, max: 2, signature: 'sarDirection(step, maxStep)', describe: 'the Parabolic SAR trend: 1 in an up-trend (the stop below price), −1 in a down-trend',
    vendorNote: SAR_NOTE,
    build: (a) => { const t = sarTrees(a[0], a[1]); return t ? t.direction : null },
  },
  // Fisher Transform — `fisherTree` above. Engine 79 (#1871).
  fisher: {
    min: 1, max: 1, signature: 'fisher(length)', describe: 'the Fisher Transform as TradingView computes it: where the bar\'s midpoint sits in its range over `length` bars, smoothed, stretched with a log and smoothed again. Its trigger line is `fisher(length)` one bar earlier',
    vendorNote: FISHER_NOTE,
    build: (a) => fisherTree(a[0]),
  },
  // Laguerre Filter and Laguerre RSI — `laguerreStage` above. Engine 79 (#1882).
  laguerre: {
    min: 2, max: 2, signature: 'laguerre(source, gamma)', describe: 'the Laguerre Filter (Ehlers): four smoothing stages of `source`, each keeping `gamma` of itself, averaged with weights 1, 2, 2, 1. A larger gamma is smoother and slower',
    build: (a) => laguerreFilterTree(a),
  },
  laguerreRsi: {
    min: 2, max: 2, signature: 'laguerreRsi(source, gamma)', describe: 'the Laguerre RSI (Ehlers), 0 to 1: of the gaps between the four Laguerre stages of `source`, the share where an earlier stage is above the later one',
    build: (a) => laguerreRsiTree(a),
  },
})

export const EXPANSION_NAMES = Object.freeze(Object.keys(CALL_EXPANSIONS))

export const isExpansionName = (name) => typeof name === 'string'
  && Object.prototype.hasOwnProperty.call(CALL_EXPANSIONS, name)

/** Why `call` (an expansion name) has no expansion, in member words, or null. */
export function expansionProblem(call) {
  const spec = CALL_EXPANSIONS[call.name]
  const n = (call.args || []).length
  if ((call.name === 'sar' || call.name === 'sarDirection') && n === 3) {
    return `${call.name} takes 2 arguments — ${spec.signature}. TradingView's ta.sar(start, increment, maximum) `
      + `uses one step for both the start and the increment here: \`${call.name}(0.02, 0.2)\` is the usual setting`
  }
  if (n < spec.min || n > spec.max) {
    return `${call.name} takes ${spec.min === spec.max ? spec.min : `${spec.min} or ${spec.max}`} arguments — ${spec.signature}`
  }
  if (call.name === 'supertrend' || call.name === 'supertrendDirection') {
    return `${call.name} needs a positive factor and a whole-number ATR period, both written as numbers — ${spec.signature}`
  }
  if (call.name === 'sar' || call.name === 'sarDirection') {
    return `${call.name} needs a step of at least ${SAR_MIN_STEP} and a maximum of at least ${SAR_MIN_MAX_STEP} (and no more than 1), both written as numbers, the maximum at least the step — ${spec.signature}. `
      + `Slower settings are not offered because a value computed from a bounded window of recent bars was measured to drift from the full-history SAR there; the chart's Parabolic SAR indicator runs from the first bar and takes any setting`
  }
  if (call.name === 'laguerre' || call.name === 'laguerreRsi') {
    return `${call.name} needs a gamma written as a number above 0 and at most ${LAGUERRE_MAX_GAMMA} (above that the filter does not settle within the bars a chart formula may reach), and a source that is not itself a running value — ${spec.signature}`
  }
  return `${call.name} needs a whole-number length${call.name === 'linreg' || call.name === 'correlation' || call.name === 'fisher' ? ' of at least 2' : ''} written as a number — ${spec.signature}`
}

/** The expansion of one call node of an expansion name, or null (`expansionProblem` says why). */
export function expandCall(call) {
  const spec = CALL_EXPANSIONS[call.name]
  const n = (call.args || []).length
  if (!spec || n < spec.min || n > spec.max) return null
  return spec.build(call.args)
}

/** Thrown by `expandCalls` — `guard` 'resolve:expansion'. */
export class ExpansionRefusal extends Error {
  constructor(message) { super(message); this.guard = 'resolve:expansion'; this.name = 'ExpansionRefusal' }
}

/**
 * Every call of an expansion name in `tree`, replaced (innermost first) by its
 * expansion. `declared(name)` → true for a name the closed table itself declares,
 * which is never expanded. Returns the SAME object when nothing was expanded.
 * Throws `ExpansionRefusal` for a call that has no expansion.
 */
export function expandCalls(tree, declared = () => false) {
  if (!tree || typeof tree !== 'object') return tree
  // ⛔ AN ITERATIVE SCAN FIRST: a tree with no expansion call is returned untouched
  // without recursing, so a pathologically deep formula still reaches the BUDGET's
  // depth refusal (`parse.deepTree.test.js`) instead of a stack overflow here.
  const { found, depth } = scanExpansions(tree, declared)
  if (!found) return tree
  if (depth > MAX_EXPANSION_DEPTH) throw new ExpansionRefusal(TOO_DEEP)
  const out = expandIn(tree, declared)
  // ⛔⛔ THE EXPANDED SIZE IS BOUNDED, because an expansion REPEATS its arguments
  // (`correlation` reads each of its two series four times): nesting multiplies, so a
  // 250-character formula nested ten deep became a 25 MB definition and a twelve-deep
  // one froze the tab for a minute (measured 10-09). Evaluation is not the cost — the
  // evaluator computes a shared subtree once — the WRITTEN tree is: the gate walk, the
  // hash, the stored JSON and the server's checks all read it as a tree.
  if (expandedSize(out, MAX_EXPANDED_NODES) > MAX_EXPANDED_NODES) throw new ExpansionRefusal(TOO_LARGE)
  return out
}

/** ⭐ The written size an expansion may reach, in tree nodes (the stored JSON's). A
 *  definition is at most 64 KB at the save door (`user_definitions.MAX_DEFINITION_BYTES`),
 *  about 1,500 nodes for the WHOLE document, so a tree past this cap could hardly be saved
 *  beside anything else. The largest realistic composite measured (three nested linregs)
 *  writes 209. */
export const MAX_EXPANDED_NODES = 1000
/** A tree holding an expansion deeper than this is refused before the recursive pass. */
export const MAX_EXPANSION_DEPTH = 200
const TOO_LARGE = `this formula nests linreg, correlation, vwma, roc, mom, the Keltner bands or supertrend so deeply that it would write out more than ${MAX_EXPANDED_NODES} terms — nest fewer of them`
const TOO_DEEP = `this formula is nested more than ${MAX_EXPANSION_DEPTH} levels deep`

function scanExpansions(tree, declared) {
  let found = false
  let depth = 0
  const stack = [[tree, 1]]
  while (stack.length) {
    const [n, d] = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (d > depth) depth = d
    if (n.type === 'call' && isExpansionName(n.name) && !declared(n.name)) found = true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push([a, d + 1])
  }
  return { found, depth }
}

/** The tree-node count of `tree` (a shared subtree counted at every place it is
 *  written), saturating just past `cap`. Linear in the DISTINCT nodes. */
export function expandedSize(tree, cap = Infinity) {
  const memo = new Map()
  const stack = [[tree, false]]
  while (stack.length) {
    const [n, done] = stack.pop()
    if (!n || typeof n !== 'object' || (memo.has(n) && !done)) continue
    const args = Array.isArray(n.args) ? n.args : []
    if (!done) {
      stack.push([n, true])
      for (const a of args) if (a && typeof a === 'object' && !memo.has(a)) stack.push([a, false])
      continue
    }
    let size = 1
    for (const a of args) size += a && typeof a === 'object' ? (memo.get(a) || 0) : 0
    memo.set(n, Math.min(size, cap + 1))
  }
  return memo.get(tree) || 0
}

function expandIn(tree, declared) {
  if (!tree || typeof tree !== 'object') return tree
  let changed = false
  const args = Array.isArray(tree.args) ? tree.args.map((a) => {
    const x = expandIn(a, declared)
    if (x !== a) changed = true
    return x
  }) : tree.args
  const node = changed ? { ...tree, args } : tree
  if (node.type === 'call' && isExpansionName(node.name) && !declared(node.name)) {
    const out = expandCall(node)
    if (!out) throw new ExpansionRefusal(expansionProblem(node))
    return out
  }
  return node
}

// ─── recognition: the readable name back from the expansion ───────────────────

// ⛔ KEY ORDER IS NOT IDENTITY (prod 10-09). A definition comes back from the store with its
// keys SORTED ({"args","name","type"}); the rebuild is written {type, name, args}. An
// order-sensitive comparison failed every reopened expansion: the view showed the raw
// arithmetic and its slots were the expanded tree's, so a length edit rewrote ONE copy of
// the length — silently different maths. Canonical (sorted-key) form, as `astHash` uses.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object'
    ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v))
const keyOf = (t) => { try { return canon(t) } catch { return null } }
const same = (a, b) => { const x = keyOf(a); return x !== null && x === keyOf(b) }
/** The first node of `tree` (depth first, iterative) that `test` accepts, or null. */
function findNode(tree, test) {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (test(n)) return n
    if (Array.isArray(n.args)) for (let i = n.args.length - 1; i >= 0; i--) stack.push(n.args[i])
  }
  return null
}
const isCall = (t, name) => !!t && t.type === 'call' && t.name === name && Array.isArray(t.args)
const isOp = (t, name, n) => !!t && t.type === 'op' && t.name === name && Array.isArray(t.args) && t.args.length === n
const numOf = (t) => (t && t.type === 'num' ? t.value
  : (isOp(t, 'u-', 1) && t.args[0].type === 'num' ? -t.args[0].value : NaN))

/** The candidate `(name, args)` pairs a tree could be the expansion of, read off
 *  its shape. Each candidate is CONFIRMED by rebuilding it (below). */
function candidates(t) {
  const out = []
  if (isOp(t, '/', 2) && isOp(t.args[0], '*', 2) && t.args[1] && t.args[1].type === 'offset') {
    const prev = t.args[1]
    out.push(['roc', [prev.args[0], cNum(prev.value)]])
  }
  if (isOp(t, '-', 2) && t.args[1] && t.args[1].type === 'offset') {
    out.push(['mom', [t.args[0], cNum(t.args[1].value)]])
    // dpo: the same outline with an average read back (confirmed by rebuilding: the count must be
    // the one that length derives, and the average must be of the same source)
    const avg = t.args[1].args && t.args[1].args[0]
    if (isCall(avg, 'sma') && avg.args.length === 2) out.push(['dpo', [t.args[0], avg.args[1]]])
  }
  if (isOp(t, '/', 2) && isCall(t.args[1], 'sma') && isCall(t.args[0], 'sma') && isOp(t.args[0].args[0], '*', 2)) {
    out.push(['vwma', [t.args[0].args[0].args[0], t.args[1].args[1]]])
  }
  if (isOp(t, '+', 2) && isOp(t.args[0], '/', 2) && isCall(t.args[0].args[0], 'sum') && isOp(t.args[1], '*', 2)) {
    const total = t.args[0].args[0]
    const n = numOf(total.args[1])
    const C = numOf(t.args[1].args[1])
    if (Number.isFinite(n) && n >= 2 && Number.isFinite(C)) {
      // invert C = 6((n−1)/2 − off)/(n(n−1)) and keep the offset only if it rebuilds exactly
      const off = Math.round(((n - 1) / 2 - (C * n * (n - 1)) / 6) * 1e9) / 1e9
      out.push(['linreg', off === 0 ? [total.args[0], cNum(n)] : [total.args[0], cNum(n), cNum(off)]])
      if (off !== 0) out.push(['linreg', [total.args[0], cNum(n), cNum(off)]])
    }
  }
  if (isOp(t, '/', 2) && isOp(t.args[0], '-', 2) && isCall(t.args[0].args[0], 'sma') && isOp(t.args[0].args[0].args[0], '*', 2)) {
    const [x, y] = t.args[0].args[0].args[0].args
    out.push(['correlation', [x, y, t.args[0].args[0].args[1]]])
  }
  if (isCall(t, 'ema') && t.args.length === 2) out.push(['kcMiddle', [t.args[0], t.args[1]]])
  if ((isOp(t, '+', 2) || isOp(t, '-', 2)) && isCall(t.args[0], 'ema') && isOp(t.args[1], '*', 2)) {
    out.push([t.name === '+' ? 'kcUpper' : 'kcLower', [t.args[0].args[0], t.args[0].args[1], t.args[1].args[0]]])
  }
  if (isCall(t, 'sma') && t.args.length === 2) out.push(['bbMiddle', [t.args[0], t.args[1]]])
  if ((isOp(t, '+', 2) || isOp(t, '-', 2)) && isCall(t.args[0], 'sma') && isOp(t.args[1], '*', 2)) {
    out.push([t.name === '+' ? 'bbUpper' : 'bbLower', [t.args[0].args[0], t.args[0].args[1], t.args[1].args[0]]])
  }
  // supertrend / supertrendDirection: `unknown ? na : …`, where `unknown` is `na(accum(…))`
  // (engine 57); the factor and the ATR period are read off a band's seed `nz(hl2 ± f ·
  // atrPine(…), 0)`. Rebuilt and compared below, so a guess here can only miss.
  if (isOp(t, '?:', 3) && isCall(t.args[0], 'na') && isCall(t.args[0].args[0], 'accum')) {
    const seed = findNode(t.args[2], (n) => isCall(n, 'nz') && isOp(n.args[0], '+', 2)
      && isOp(n.args[0].args[1], '*', 2) && isCall(n.args[0].args[1].args[1], 'atrPine'))
    const scaled = seed ? seed.args[0].args[1] : null
    const atr = scaled ? scaled.args[1] : null
    if (atr && atr.args.length === 4) {
      out.push(['supertrend', [scaled.args[0], atr.args[3]]])
      out.push(['supertrendDirection', [scaled.args[0], atr.args[3]]])
    }
  }
  // sar / sarDirection: `unknown ? na : …` over an `accum4` whose 4th seed is the step;
  // the maximum is read off the acceleration update's `min(af + step, max)`. Rebuilt
  // and compared below, so a guess here can only miss, never misname.
  if (isOp(t, '?:', 3)) {
    const run = isCall(t.args[2], 'accum4') ? t.args[2] : null
    if (run && run.args.length === 10) {
      const stepNode = run.args[5]
      const af = run.args[9]
      const inner = af && af.args && af.args[2]
      const upArm = inner && inner.args && inner.args[1]
      const climb = upArm && upArm.args && upArm.args[2]
      const faster = climb && climb.args && climb.args[1]
      const maxNode = isCall(faster, 'min') ? faster.args[1] : null
      if (stepNode && maxNode) {
        out.push(['sar', [stepNode, maxNode]])
        out.push(['sarDirection', [stepNode, maxNode]])
      }
    }
  }
  // laguerre / laguerreRsi: built on `accum4` stages whose first update is `(1 − γ)·src + γ·state1`;
  // the source is a seed and gamma is read off that update. Rebuilt and compared below.
  const stageIn = (node) => findNode(node, (n) => isCall(n, 'accum4') && n.args.length === 10)
  const gammaIn = (stage) => {
    const l0 = stage && stage.args[6]
    return isOp(l0, '+', 2) && isOp(l0.args[1], '*', 2) ? l0.args[1].args[0] : null
  }
  if (isOp(t, '/', 2) && numOf(t.args[1]) === 6) {
    const stage = stageIn(t.args[0])
    if (stage && gammaIn(stage)) out.push(['laguerre', [stage.args[2], gammaIn(stage)]])
  }
  if (isOp(t, '+', 2) && numOf(t.args[0]) === 0.5 && isOp(t.args[1], '/', 2)) {
    const stage = stageIn(t.args[1])
    if (stage && gammaIn(stage)) out.push(['laguerreRsi', [stage.args[2], gammaIn(stage)]])
  }
  // fisher: an `accum2` whose first update ranges something with `lowest(…, n)`; the length is
  // read off that. Rebuilt and compared below, so a guess here can only miss, never misname.
  if (isCall(t, 'accum2') && t.args.length === 6) {
    const low = findNode(t.args[4], (n) => isCall(n, 'lowest') && n.args.length === 2)
    if (low) out.push(['fisher', [low.args[1]]])
  }
  return out
}

/**
 * ⭐ `{name, args}` when `tree` is EXACTLY the expansion of an expansion call, else
 * null. Three shapes are too ordinary to rename by default: `kcMiddle` is a bare
 * `ema` (an EMA is an EMA unless its siblings say otherwise — `allowBareEma`),
 * `bbMiddle` a bare `sma` (`allowBareSma`) and
 * `mom` is any `x − x[n]` (a hand-written difference stays a difference —
 * `allowMom`). Both still EXPAND exactly; only the read-back name is withheld.
 */
export function recogniseExpansion(tree, { allowBareEma = false, allowBareSma = false, allowMom = false } = {}) {
  if (!tree || typeof tree !== 'object') return null
  for (const [name, args] of candidates(tree)) {
    if (name === 'kcMiddle' && !allowBareEma) continue
    if (name === 'bbMiddle' && !allowBareSma) continue
    if (name === 'mom' && !allowMom) continue
    const built = expandCall({ type: 'call', name, args })
    if (built && same(built, tree)) return { name, args }
    // ⭐ 2026-11-16 — a document saved before the SAR window moved to SAR_WARMUP carries the
    // older window's tree: read it back as the call the member wrote (re-expanded at the
    // current window on the next save), and say which window it was saved with.
    if (name === 'sar' || name === 'sarDirection') {
      for (const w of SAR_LEGACY_WARMUPS) {
        const legacy = sarTrees(args[0], args[1], w)
        if (legacy && same(name === 'sar' ? legacy.value : legacy.direction, tree)) return { name, args, legacyWarmup: w }
      }
    }
  }
  return null
}

/** ⭐ 2026-11-16 — the note a SAR tree saved with an earlier window carries instead of SAR_NOTE. */
export function sarLegacyNote(warmup) {
  return `This Parabolic SAR was saved when it started each value ${warmup} bars back. On a few bars of some charts that start differs from the chart's full-history SAR (measured: 312 of about 1.1 million bars). Save the formula again to use the current ${SAR_WARMUP}-bar start.`
}

/** `tree` with every recognised expansion collapsed back to its call (the readable
 *  form the printer writes — the parser expands it again to the SAME tree). */
export function collapseExpansions(tree) {
  if (!tree || typeof tree !== 'object') return tree
  const hit = recogniseExpansion(tree)
  if (hit) return { type: 'call', name: hit.name, args: hit.args.map(collapseExpansions) }
  if (!Array.isArray(tree.args)) return tree
  let changed = false
  const args = tree.args.map((a) => { const x = collapseExpansions(a); if (x !== a) changed = true; return x })
  return changed ? { ...tree, args } : tree
}
