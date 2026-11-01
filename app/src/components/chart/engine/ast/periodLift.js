// app/src/components/chart/engine/ast/periodLift.js
//
// ─── ⭐⭐ I2 WS1 — A THINKSCRIPT WEEKLY/MONTHLY READ COMPUTES ON WEEKLY BARS ──
//
// Audit P0-2 (PA1 §2). thinkorswim marks only the LEAF: `Average(close(period =
// AggregationPeriod.WEEK), 10)` names WEEK on `close`, and the function around
// it runs in that aggregation — a 10-WEEK average. The translator used to emit
// `sma(tf(close, 'W'), 10)`: a 10-DAY average of a stepped weekly close, which
// matched thinkorswim on 0 of 120 bars and was labelled "Exact import".
//
// This pass moves the period read OUT to the largest subexpression that reads
// only that period, so the window runs inside it:
//
//   Average(close(W), 10)        sma(tf(close,'W'),10)      → tf_live(sma(close,10),'W')
//   close(W)[1]                  tf(close,'W')[1]           → tf(close,'W')
//   Average(close(W), 10)[1]     sma(tf(close,'W'),10)[1]   → tf(sma(close,10),'W')
//   close / close(W)             close / tf(close,'W')      → close / tf_live(close,'W')
//
// ⭐ BASIS F — owner decision 2026-11-01 (developing higher-timeframe bars, for
// thinkorswim compatibility):
//   - an UNSHIFTED read is `tf_live`: on the current period it moves until the
//     period closes (disclosed — the output carries the repaint badge), and on a
//     past bar it is that period's FINAL value;
//   - a read under `[k ≥ 1]` is `tf(X[k-1])`: the confirmed, non-repainting value
//     of the period k back — exactly equal to the shifted forming read (PA1 §2.1,
//     120/120), so a developing value is never silently swapped for a confirmed
//     one or the other way round.
// ⛔ NOT YET CONFIRMED AGAINST THINKORSWIM. The owner's capture procedure is
// `docs/indicators/i2/THINKORSWIM-VALIDATION.md`; until it is compared, the
// disclosure says "intended to match", never "as thinkorswim does". If the
// capture contradicts F, `BASIS` is the one line to change, with its rails.
//
// ⛔ A WINDOW OVER A MIX OF DAILY AND WEEKLY VALUES IS REFUSED, not guessed —
// `Average(close - close(W), 10)`: thinkorswim does not publish which bars that
// average runs on (PA1 row 29). An element-wise mix (`close / close(W)`,
// `close > Average(close(W), 10)`) and a cross between a daily and a weekly
// series stay in daily context — the cross is decided on daily bars of both.
//
// ⛔ PURE. It never mutates its input; the period leaves it lifts are the ones
// the thinkScript translator emits (`tf` over a bar field — the only `tf` that
// door produces), so a hand-written formula is never touched: this pass runs in
// the thinkScript door only.

export const BASIS = 'F'

/** The guard a mixed window refuses with (declared in `thinkscript.js::REFUSALS`). */
export const MIXED_GUARD = 'thinkscript:aggregation-mixed'

/** Calls decided bar by bar on the CHART's bars even when their two sides are
 *  of different periods: a cross compares today with yesterday on each side. */
const CROSS_CALLS = new Set(['crossOver', 'crossUnder'])

const NEUTRAL = 'neutral'
const BASE = 'base'
const MIXED = 'mixed'

const isObj = (v) => !!v && typeof v === 'object'

/** A period leaf as the thinkScript door emits it: `tf(series, 'W'|'M')`. */
export function isPeriodLeaf(n) {
  return isObj(n) && n.type === 'tf' && Array.isArray(n.args) && n.args.length === 1
    && isObj(n.args[0]) && n.args[0].type === 'series'
}

function combine(kinds) {
  let out = NEUTRAL
  for (const k of kinds) {
    if (k === NEUTRAL) continue
    if (out === NEUTRAL) { out = k; continue }
    if (out !== k) return MIXED
  }
  return out
}

/** `neutral` (constants only) · `base` (the chart's own bars) · a period code ·
 *  `mixed`. Memoised per node identity for one pass. */
function periodOf(node, memo) {
  if (!isObj(node)) return NEUTRAL
  if (memo.has(node)) return memo.get(node)
  let k
  if (isPeriodLeaf(node)) k = String(node.value)
  else if (node.type === 'series') k = BASE
  else if (node.type === 'num' || node.type === 'str') k = NEUTRAL
  else if (node.type === 'sym') k = BASE
  else k = combine((node.args || []).map((a) => periodOf(a, memo)))
  memo.set(node, k)
  return k
}

/** The subtree with every period leaf replaced by its bare field — the same
 *  expression, now to be evaluated INSIDE the period. */
function strip(node) {
  if (!isObj(node)) return node
  if (isPeriodLeaf(node)) return node.args[0]
  if (!Array.isArray(node.args)) return node
  return { ...node, args: node.args.map(strip) }
}

function wrap(node, code) {
  // ⭐ `[k ≥ 1]` over a single-period subtree: the confirmed value k periods back.
  if (node.type === 'offset' && Number.isInteger(node.value) && node.value >= 1) {
    const inner = strip(node.args[0])
    const k = node.value - 1
    const child = k === 0 ? inner : { type: 'offset', value: k, args: [inner] }
    return { type: 'tf', value: code, args: [child] }
  }
  return { type: 'tf_live', value: code, args: [strip(node)] }
}

/** A refusal value the thinkScript door turns into its own `ThinkScriptRefusal`. */
export class PeriodLiftRefusal extends Error {
  constructor(what) {
    super(what)
    this.guard = MIXED_GUARD
    this.what = what
  }
}

function windowed(node) {
  return node.type === 'offset'
    || (node.type === 'call' && !CROSS_CALLS.has(node.name) && hasLookback(node))
}

let LOOKBACK_OF = null
function hasLookback(node) {
  const f = LOOKBACK_OF && LOOKBACK_OF[node.name]
  // ⛔ AN UNDECLARED CALL IS TREATED AS WINDOWED — the refusing direction. A call
  // the manifest does not describe could be reading several bars.
  if (!f) return true
  return f.lookback !== 0
}

/**
 * Lift every thinkScript period read in `ast` to the largest subexpression that
 * reads only that period.
 *
 * @param {object} ast        the resolved output tree
 * @param {object} functions  the manifest's `functions` table (for `lookback`)
 * @returns {{ast: object, reads: Array<{period: string, form: 'live'|'closed'}>}}
 *   `reads` is what the import result records about each lifted read; empty when
 *   the tree had none (and then `ast` is returned unchanged, by identity).
 * @throws {PeriodLiftRefusal} on a window over a mix of periods
 */
export function liftPeriods(ast, functions) {
  LOOKBACK_OF = functions || null
  const memo = new Map()
  const reads = []
  const visit = (node) => {
    const k = periodOf(node, memo)
    if (k === NEUTRAL || k === BASE) return node
    if (k !== MIXED) {
      const w = wrap(node, k)
      reads.push({ period: k, form: w.type === 'tf_live' ? 'live' : 'closed' })
      return w
    }
    if (windowed(node)) {
      throw new PeriodLiftRefusal(node.type === 'offset' ? '[n]' : `\`${node.name}\``)
    }
    return { ...node, args: node.args.map(visit) }
  }
  try {
    const out = visit(ast)
    return { ast: reads.length ? out : ast, reads }
  } finally {
    LOOKBACK_OF = null
  }
}
