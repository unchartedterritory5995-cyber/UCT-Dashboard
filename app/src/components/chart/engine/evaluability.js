// app/src/components/chart/engine/evaluability.js
//
// ─── ⭐⭐ P1 — THE SHARED EVALUABILITY GATE: CAN THIS OUTPUT BE EVALUATED
//     CORRECTLY IN THIS CONSUMER? ONE PLACE ASKS IT. ─────────────────────────────
//
// `evaluability(def, outputKey, lane, ctx)` →
//   { status: 'supported' | 'refused' | 'disclosed', lane, key, type,
//     guard?, reason?, note?, pending?, codes?, gate?,
//     authority: 'client' | 'server', final: boolean }
//
// It is the idea of the old branch's `operandCapability`, rebuilt on master's
// machinery and WITHOUT a second diagnostics system: every refusal it returns is
// one P0 already owns, under P0's own guard name and P0's own sentence —
//   · `bind:period-reads`             (`periodReads.js`, C29)
//   · `lower-tf:formula-unsupported`  (P0 sym/ltf slice)
//   · `chart:scalar-current-only`     (`chartScalars.js`, P0 0F)
//   · `other-symbol:*`                (`otherSymbols.js`, C26 / P0 sym)
//   · the alert lane's gates `plot` / `scalar` / `withheld` with the codes
//     `other-symbol:unsupplied` / `lower-tf:unsupplied`
//     (`api/services/alert_user_series.py`, which stays the AUTHORITY for alerts;
//     this file's alert answer is a PREFLIGHT held equal to it by the shared
//     fixture `tests/fixtures/ast/p1_evaluability_alert.json`).
//
// ⭐ THE CHART LANE'S PRE-COMPUTE REFUSALS ARE DECIDED HERE AND ONLY HERE.
// `nativeRegistry.astColumnsUnstopped` asks `chartStaticRefusals` and applies the
// answer with the control flow it always had (byte-identical columns and
// reasons), so the chart, the builder preview (it draws through the same
// `computeFor`) and every future consumer asking `evaluability` cannot disagree
// about which plot a chart refuses before it computes.
//
// ⛔ `final`: a refusal is final (no later stage un-refuses it). A `supported`
// answer is final only where nothing later can refuse: on the chart, `computeFor`
// can still refuse a column (budget, block runs, a runtime stop — read them with
// `columnErrors`); on the alert and scan lanes the SERVER door decides at arm /
// at the scan door (whole-series withholding, repaint, budget, cross-lane proof).
//
// ⛔ NOTHING HERE READS AN INTENT, A LABEL OR A CLIENT-SUPPLIED TYPE. The type is
// `outputType.js::outputTypeOf`'s, derived from the tree.

import { outputTypeOf, OUTPUT_TYPES, isTruthType } from './outputType'
import { periodReadsRefusalFor, PERIOD_READS_GUARD } from './periodReads'
import { chartScalarRefusal, CHART_SCALAR_GUARD } from './chartScalars'
import {
  resolveOtherSymbols, resolveFormulaSymbols, symTickersOf, isPineOriginDoc,
} from './otherSymbols'
import { scalarsIn } from './ast/freshness'
import CROSS from '../builder/authoring/crossContext.json'

export const STATUS = Object.freeze({ SUPPORTED: 'supported', REFUSED: 'refused', DISCLOSED: 'disclosed' })

/** The consumers / lanes the gate answers for (P1-DESIGN.md §6). */
export const LANES = Object.freeze({
  CHART: 'chart',                     // a plotted line / histogram / band …
  CHART_MARKER: 'chart-marker',       // a `style: 'markers'` glyph per bar
  CHART_PAINT: 'chart-paint',         // a `paints[]` bgcolor / barcolor
  BUILDER_PREVIEW: 'builder-preview', // the sheet's live preview (draws via computeFor)
  INFO_VALUE: 'info-value',           // the latest valid value of an installed output
  SIGNAL: 'signal',                   // a truth output for chart meaning + alerts
  ALERT: 'alert',                     // the server alert lane (authority: server)
  SCAN: 'scan',                       // the screener / scan door (authority: server)
})
const CHART_FAMILY = new Set([LANES.CHART, LANES.CHART_MARKER, LANES.CHART_PAINT,
  LANES.BUILDER_PREVIEW, LANES.INFO_VALUE, LANES.SIGNAL])

/** Guards this gate adds for questions P0 had no name for (type-layer only). */
export const GATE_GUARDS = Object.freeze({
  UNDECLARED: 'output:undeclared',
  UNTYPED: 'output:untyped',
  UNKNOWN_LANE: 'lane:unknown',
  SIGNAL_NUMERIC: 'signal:numeric-output',
  SIGNAL_SCALAR: 'signal:scalar-output',
  SCAN_NOT_CONDITION: 'scan:not-a-condition',
  MARKER_NUMERIC: 'marker:numeric-output',
})

// ─── P0's `ltf` refusal for a document that is not a Pine translation ─────────

/** ⭐⭐ P0 — the guard a formula document's `ltf` plot is refused under. */
export const FORMULA_LTF_GUARD = 'lower-tf:formula-unsupported'
export const FORMULA_LTF_MESSAGE = 'This indicator reads a timeframe below the chart (`ltf(…)`), which is '
  + 'only computed for an imported Pine script; a formula that reads one is not computed on any chart.'

/** Does a tree contain an `ltf` node? Iterative, like `symTickersOf`. */
export function treeReadsLtf(tree) {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue }
    if (n.type === 'ltf') return true
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return false
}

/** The `sym` tickers ONE tree reads (upper-cased, sorted). */
function treeSymTickers(tree) {
  return symTickersOf({ compute: { ast: tree } })
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Same predicate as `nativeRegistry.astPlotKey`. */
function dataPlotKeys(def) {
  const plots = Array.isArray(def && def.plots) ? def.plots : []
  return plots.filter((p) => p && p.style !== 'hlines' && typeof p.key === 'string').map((p) => p.key)
}

/**
 * ⭐⭐ THE CHART LANE'S PRE-COMPUTE REFUSALS for an `ast` document on THIS
 * binding (`ctx.tf`), exactly as `astColumnsUnstopped` has always applied them:
 *
 *   - `whole`: a column-error map when the document computes NOTHING here —
 *     every plot (or the single tree) folded another period's value, or every
 *     plot (or the single tree) reads `ltf` in a non-Pine document. Period wins.
 *   - `perKey`: otherwise, per plot, the first of period > ltf > scalar
 *     (multi-tree), or the single tree's scalar refusal.
 *
 * @returns {{whole: Record<string,{guard,message}>|null, perKey: Map<string,{guard,message}>}}
 */
export function chartStaticRefusals(def, ctx) {
  const keys = dataPlotKeys(def)
  const compute = (def && def.compute) || {}
  const trees = isObj(compute.trees) ? compute.trees : null
  const periodWhy = new Map()
  for (const k of keys) {
    const why = periodReadsRefusalFor(def, k, ctx && ctx.tf)
    if (why) periodWhy.set(k, why)
  }
  if (periodWhy.size && (!trees || periodWhy.size === keys.length)) {
    const whole = {}
    for (const key of keys) whole[key] = { guard: PERIOD_READS_GUARD, message: periodWhy.get(key) || [...periodWhy.values()][0] }
    return { whole, perKey: new Map() }
  }
  const ltfWhy = new Map()
  if (!isPineOriginDoc(def)) {
    for (const k of keys) {
      const tree = trees ? trees[k] : compute.ast
      if (treeReadsLtf(tree)) ltfWhy.set(k, FORMULA_LTF_MESSAGE)
    }
  }
  if (ltfWhy.size && (!trees || ltfWhy.size === keys.length)) {
    const whole = {}
    for (const key of keys) whole[key] = { guard: FORMULA_LTF_GUARD, message: FORMULA_LTF_MESSAGE }
    return { whole, perKey: new Map() }
  }
  const perKey = new Map()
  if (trees) {
    for (const key of keys) {
      if (periodWhy.has(key)) { perKey.set(key, { guard: PERIOD_READS_GUARD, message: periodWhy.get(key) }); continue }
      if (ltfWhy.has(key)) { perKey.set(key, { guard: FORMULA_LTF_GUARD, message: ltfWhy.get(key) }); continue }
      if (!Object.prototype.hasOwnProperty.call(trees, key)) continue
      const scalarWhy = chartScalarRefusal(trees[key])
      if (scalarWhy) perKey.set(key, { guard: CHART_SCALAR_GUARD, message: scalarWhy })
    }
  } else if (keys.length === 1) {
    const soleScalarWhy = chartScalarRefusal(compute.ast)
    if (soleScalarWhy) perKey.set(keys[0], { guard: CHART_SCALAR_GUARD, message: soleScalarWhy })
  }
  return { whole: null, perKey }
}

/**
 * ⭐⭐ C26 / P0 — which other symbols THIS binding may read: a Pine translation
 * by its recorded spellings (`resolveOtherSymbols`), any other document by our
 * store's ticker (`resolveFormulaSymbols`). Null when it reads none.
 * `nativeRegistry.otherSymbolsFor` IS this function.
 */
export function otherSymbolsDecision(def, ctx) {
  if (!def) return null
  if (!isPineOriginDoc(def)) {
    if (!symTickersOf(def).length) return null
    return resolveFormulaSymbols(def, { secondary: ctx && ctx.secondary, framed: !!(ctx && ctx.framed) })
  }
  if (!def.meta || !(symTickersOf(def).length || (def.meta.otherSymbols || []).length)) return null
  return resolveOtherSymbols(def, {
    secondary: ctx && ctx.secondary,
    exchangeOf: ctx && ctx.exchangeOf,
    symbol: ctx && ctx.symbol,
    framed: !!(ctx && ctx.framed),
  })
}

function answer(base, extra) {
  return Object.freeze({ ...base, ...extra })
}

/** The alert lane's tree for `key` — `alert_user_series._make_value_fn`'s
 *  resolution: `trees[key]`, else (a document that declares v2 → `plot` gate),
 *  else `compute.ast`. */
const V2_COMPUTE_KEYS = ['trees', 'treesHash', 'scanPlot', 'sources']
function alertTreeOf(compute, key) {
  const trees = compute.trees
  if (isObj(trees) && Object.prototype.hasOwnProperty.call(trees, key)) return { tree: trees[key] }
  if (V2_COMPUTE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(compute, k))) return { plotRefused: true }
  return { tree: compute.ast }
}

const TICKER_RE = new RegExp(CROSS.tickerPattern)
const AMBIGUOUS = new Set(CROSS.ambiguousBare)
const storeKey = (t) => { const m = /^([A-Z]{1,5})\.([A-Z])$/.exec(t); return m ? `${m[1]}-${m[2]}` : t }

/** ⭐ PHASE 5 — why the alert lane cannot supply these tickers, or null (it can).
 *  Twin of `alert_user_series.cross_symbol_refusal`. */
export function crossSymbolAlertCode(tickers) {
  if (!tickers.length) return null
  if (tickers.some((t) => !TICKER_RE.test(t))) return 'other-symbol:unservable'
  if (tickers.some((t) => AMBIGUOUS.has(t))) return 'other-symbol:ambiguous'
  if (new Set(tickers.map(storeKey)).size > CROSS.maxOtherSymbols) return 'other-symbol:fan-out'
  return null
}

/** The alert lane's per-plot gates (`_make_value_fn`), in its order. */
function alertPlotRefusal(compute, key) {
  const { tree, plotRefused } = alertTreeOf(compute, key)
  if (plotRefused) return { gate: 'plot', codes: [] }
  const scalars = isObj(tree) ? [...scalarsIn(tree)].sort() : []
  if (scalars.length) return { gate: 'scalar', codes: scalars }
  const codes = []
  // ⭐ PHASE 5 — THE ALERT LANE SUPPLIES ANOTHER SYMBOL now (`alert_user_series`
  // loads it at evaluation, the scan's local loader): admitted when every ticker is
  // a servable, unambiguous spelling and there are at most `maxOtherSymbols` of
  // them. Same codes as the server's `cross_symbol_refusal`.
  const crossCode = crossSymbolAlertCode(treeSymTickers(tree))
  if (crossCode) codes.push(crossCode)
  if (treeReadsLtf(tree)) codes.push('lower-tf:unsupplied')
  if (codes.length) return { gate: 'withheld', codes }
  return null
}

/** The alert lane's gates that refuse ONE plot, not the definition
 *  (`alert_user_series.PER_PLOT_GATES`). */
const ALERT_PER_PLOT_GATES = new Set(['withheld', 'scalar'])

const ALERT_SENTENCE = {
  lane: 'This output is not a formula, and the alert lane admits only formulas.',
  plot: 'This document declares several plots and carries no tree for this one, so the alert lane '
    + 'cannot tell which number to watch.',
  scalar: 'It reads a current-only screener value that has no bar history, so an alert on it would '
    + 'arm and never fire. It works as a screen.',
  withheld: 'It reads a series the alert lane is never handed (a timeframe below the chart, or another '
    + 'symbol it cannot load: an ambiguous spelling, or more than two), so an alert on it would arm and never fire.',
}

function alertAnswer(def, key, base) {
  const compute = (def && def.compute) || {}
  if (compute.kind === 'native' || compute.kind === 'server') {
    return answer(base, { status: STATUS.SUPPORTED, authority: 'server', final: false,
      note: 'A shipped indicator alerts through the builtin alert catalog; the server decides what it offers.' })
  }
  if (compute.kind !== 'ast') {
    return answer(base, { status: STATUS.REFUSED, authority: 'server', final: true, gate: 'lane',
      guard: 'alert:lane', codes: [], reason: ALERT_SENTENCE.lane })
  }
  const keys = (Array.isArray(def.plots) ? def.plots : [])
    .map((p) => (isObj(p) ? p.key : p)).filter(Boolean).map(String)
  // ⛔ THE SERVER ADMITS A DEFINITION WHOLE ON A `plot` REFUSAL: a document that
  // declares several plots and carries no tree for one refuses every plot.
  // ⭐ P2 OWNER POLICY 7 — `scalar` IS PER OUTPUT, like `withheld` (C45): a
  // scalar-reading plot stays refused, its valid SERIES/CONDITION siblings are
  // admitted. Mirrors `alert_user_series.PER_PLOT_GATES`.
  for (const k of keys) {
    const r = alertPlotRefusal(compute, k)
    if (r && !ALERT_PER_PLOT_GATES.has(r.gate)) {
      return answer(base, { status: STATUS.REFUSED, authority: 'server', final: true, gate: r.gate,
        guard: `alert:${r.gate}`, codes: r.codes,
        reason: k === key ? ALERT_SENTENCE[r.gate]
          : `Its sibling plot \`${k}\` is refused by the alert lane (${r.gate}), and the lane admits a definition whole. `
            + ALERT_SENTENCE[r.gate] })
    }
  }
  if (!keys.includes(String(key))) {
    return answer(base, { status: STATUS.REFUSED, authority: 'server', final: true, gate: 'definition',
      guard: GATE_GUARDS.UNDECLARED, codes: [], reason: 'This definition declares no such plot.' })
  }
  const own = alertPlotRefusal(compute, key)
  if (own) {
    return answer(base, { status: STATUS.REFUSED, authority: 'server', final: true, gate: own.gate,
      guard: `alert:${own.gate}`, codes: own.codes, reason: ALERT_SENTENCE[own.gate] })
  }
  return answer(base, { status: STATUS.SUPPORTED, authority: 'server', final: false,
    note: 'The server decides the rest at arm: whole-series withholding, repaint, budget and the '
      + 'two-lane proof on the alert\'s own bars.' })
}

/** The chart family's computability for one output on THIS binding. */
function chartAnswer(def, key, base, ctx) {
  const compute = (def && def.compute) || {}
  if (compute.kind === 'ast') {
    const { whole, perKey } = chartStaticRefusals(def, ctx)
    const hit = (whole && whole[key]) || perKey.get(key)
    if (hit) {
      return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
        guard: hit.guard, reason: hit.message })
    }
    // ⭐ the other symbols THIS output reads, decided as the bind decides them
    const tree = outputTreeFor(def, key)
    const mine = new Set(treeSymTickers(tree))
    if (mine.size) {
      const other = otherSymbolsDecision(def, ctx)
      const refused = ((other && other.refused) || []).filter((r) => mine.has(String(r.ticker).toUpperCase()))
      if (refused.length) {
        const r = refused[0]
        return answer(base, { status: STATUS.REFUSED, authority: 'client', final: !r.pending,
          guard: r.code, reason: r.reason, ...(r.pending ? { pending: true } : {}),
          codes: refused.map((x) => x.code) })
      }
    }
  }
  return answer(base, { status: STATUS.SUPPORTED, authority: 'client', final: false })
}

function outputTreeFor(def, key) {
  const compute = (def && def.compute) || {}
  if (isObj(compute.trees)) return compute.trees[key]
  return compute.ast
}

/**
 * ⭐⭐ THE ONE QUESTION: can output `key` of `def` be evaluated correctly in `lane`?
 *
 * @param {object} def   an installed (or about-to-be-installed) definition
 * @param {string} key   the output key (`plots[].key` / `events[].key`)
 * @param {string} lane  one of `LANES`
 * @param {object} [ctx] the binding: `tf`, `secondary`, `framed`, `exchangeOf`, `symbol`
 */
export function evaluability(def, key, lane, ctx) {
  const typed = outputTypeOf(def, key)
  const base = { lane, key, type: typed.type }
  if (!Object.values(LANES).includes(lane)) {
    return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
      guard: GATE_GUARDS.UNKNOWN_LANE, reason: `\`${lane}\` is not a consumer this gate knows.` })
  }
  if (lane === LANES.ALERT) return alertAnswer(def, key, base)
  if (typed.untyped === 'untyped:undeclared-output' || typed.untyped === 'untyped:guide') {
    return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
      guard: GATE_GUARDS.UNDECLARED,
      reason: typed.untyped === 'untyped:guide'
        ? 'This is a guide line, which carries no value per bar.'
        : 'This definition declares no such output.' })
  }
  if (lane === LANES.SCAN) {
    // Type layer only — the scan door (`scan_definition.assert_scannable`) owns
    // symbols, cadence, budget and withholding.
    const scannable = typed.type === OUTPUT_TYPES.CONDITION
      || (typed.type === OUTPUT_TYPES.SCALAR && typed.yields === 'bool')
    return scannable
      ? answer(base, { status: STATUS.SUPPORTED, authority: 'server', final: false,
        note: 'The scan door decides symbols, cadence, budget and withholding.' })
      : answer(base, { status: STATUS.REFUSED, authority: 'server', final: true,
        guard: GATE_GUARDS.SCAN_NOT_CONDITION,
        reason: 'A screen keeps the symbols where a yes/no is true; this output is not a yes/no.' })
  }
  if (lane === LANES.SIGNAL) {
    if (typed.type === OUTPUT_TYPES.SERIES) {
      return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
        guard: GATE_GUARDS.SIGNAL_NUMERIC,
        reason: 'This output is a number on every bar, not a yes/no. A signal needs a condition — '
          + 'compare it to something (for example `x > 0`) to make one.' })
    }
    if (typed.type === OUTPUT_TYPES.SCALAR) {
      return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
        guard: CHART_SCALAR_GUARD, reason: chartScalarRefusal(outputTreeFor(def, key)) })
    }
    if (!isTruthType(typed.type)) {
      return answer(base, { status: STATUS.REFUSED, authority: 'client', final: true,
        guard: GATE_GUARDS.UNTYPED,
        reason: 'This output carries no derivable type (it is computed bar by bar by the script runtime), '
          + 'so it cannot be read as a yes/no.' })
    }
  }
  if (!CHART_FAMILY.has(lane)) return answer(base, { status: STATUS.SUPPORTED, authority: 'client', final: false })
  const chart = chartAnswer(def, key, base, ctx)
  if (chart.status !== STATUS.SUPPORTED) return chart
  // ⭐ A marker glyph is drawn where the value is a finite number above 0
  // (`markerPrimitive.js::marks`, Pine's plotshape rule). On a yes/no that is
  // "where it is true"; on a number it is "where it is positive" — said.
  if (lane === LANES.CHART_MARKER && typed.type === OUTPUT_TYPES.SERIES) {
    return answer(chart, { status: STATUS.DISCLOSED, guard: GATE_GUARDS.MARKER_NUMERIC,
      note: 'This output is a number, so a marker is drawn on every bar where it is above 0.' })
  }
  return chart
}
