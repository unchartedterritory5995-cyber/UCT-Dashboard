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
import { TF_MERGE_NEWEST_CODE, SCOPE_TYPES } from './ast/interpret'
import { TABLE } from './ast/parse'
import { readAt } from './paramLiteral'
import { boundAtInputs } from './knobBind.js'
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

/** ⭐⭐ ENGINE 55 — the guard a formula document's `tf_merge` plot is refused under.
 *  `tf_merge` is Pine's look-ahead-off request as TradingView merges it
 *  (`interpret.js`'s `tf_merge` arm); only the Pine door writes it. A formula a member
 *  types reads `tf(…)` — the last closed period on every bar — which is unchanged. */
export const FORMULA_TF_MERGE_GUARD = 'request:formula-unsupported'
export const FORMULA_TF_MERGE_MESSAGE = 'This indicator reads a higher timeframe the way TradingView\'s '
  + '`request.security` merges it (`tf_merge(…)`), which is computed only for an imported Pine script; in a '
  + 'formula, write `tf(…)` for the last closed week or month instead.'

/** Does a tree contain an `ltf` node? Iterative, like `symTickersOf`. */
export function treeReadsLtf(tree) {
  return treeHoldsType(tree, 'ltf')
}

/** ⭐ ENGINE 55 — does a tree contain a `tf_merge` node? */
export function treeReadsTfMerge(tree) {
  return treeHoldsType(tree, 'tf_merge')
}

/** The calls the closed table declares `forward` (they read LATER bars: `pivothigh`, `pivotlow`,
 *  `ichimokuChikou`). Derived from the table, as the Python twin derives it. */
const FORWARD_CALLS = new Set(Object.keys(TABLE.functions)
  .filter((k) => !!TABLE.functions[k] && typeof TABLE.functions[k] === 'object'
    && Object.prototype.hasOwnProperty.call(TABLE.functions[k], 'forward')))

/** A history offset's `k` is a literal whole number >= 1 (`alert_user_series._whole_back`). */
const wholeBack = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1

/** The `offset` nodes of `tree` a parameter setting can move: every locator of
 *  `compute.paramManifest` read against THIS tree, whatever tree it was recorded for (an
 *  over-read only refuses more), that ends at an offset node or at its `value`
 *  (`paramInputs.js::writeLiteral`'s two shapes). Twin of `alert_user_series._param_offset_ids`. */
function paramOffsets(tree, compute) {
  const out = new Set()
  const manifest = isObj(compute) ? compute.paramManifest : null
  if (!isObj(manifest)) return out
  for (const entry of Object.values(manifest)) {
    const locators = isObj(entry) ? entry.locators : null
    if (!Array.isArray(locators)) continue
    for (const loc of locators) {
      const path = isObj(loc) ? loc.astPath : null
      if (!Array.isArray(path) || !path.every((s) => typeof s === 'string' || Number.isInteger(s))) continue
      const at = readAt(tree, path)
      if (isObj(at) && at.type === 'offset') out.add(at)
      if (path.length && path[path.length - 1] === 'value') {
        const parent = readAt(tree, path.slice(0, -1))
        if (isObj(parent) && parent.type === 'offset') out.add(parent)
      }
    }
  }
  return out
}

/**
 * ⭐⭐ ALERT TF_MERGE (coordinator ruling 2026-11-19, option A) — does this plot read a `tf_merge` the
 * alert lane cannot PROVE settled on the bar it reads? Then it is refused, `withheld` /
 * `request:htf-newest-unconfirmed`, as every `tf_merge` plot was before.
 *
 * A STATIC rule, CONSERVATIVE BY CONSTRUCTION (the tree and the parameter manifest, never bars): a merge
 * is PROVEN when EVERY path from the root to it passes a history offset `x[k]` whose `k` is a literal
 * whole number >= 1 that no parameter setting moves (#1996's `cutHistory` rule, `strategyTaint.js`), and
 * nothing on that path or inside the merge is another request (`SCOPE_TYPES`), a call the closed table
 * declares `forward` (`pivothigh(x, 2, 2)[2]` reads `x` on the newest bar), or an offset a parameter
 * setting moves. `x` / `x[0]`, a conditional with one arm on `x`, `barsAgo(x, …)` (a dynamic offset,
 * however spelled) are not proven. The twin of `alert_user_series.merge_newest_unproven` (its docstring
 * carries the reasoning), held equal case by case by `tests/fixtures/ast/alert_tf_merge_history.json`.
 */
export function mergeNewestUnproven(tree, compute) {
  if (!treeReadsTfMerge(tree)) return false
  const moved = paramOffsets(tree, compute)
  const seen = new Map()                                  // node -> bitmask of the states it was walked in
  const stack = [[tree, false, false, false]]
  while (stack.length) {
    const [node, cut0, tainted0, inside0] = stack.pop()
    if (!isObj(node)) continue
    const bit = 1 << ((cut0 ? 4 : 0) + (tainted0 ? 2 : 0) + (inside0 ? 1 : 0))
    const had = seen.get(node) || 0
    if (had & bit) continue
    seen.set(node, had | bit)
    let cut = cut0
    let tainted = tainted0
    let inside = inside0
    const movedHere = node.type === 'offset' && moved.has(node)
    const blocks = SCOPE_TYPES.has(node.type) || movedHere || (node.type === 'call' && FORWARD_CALLS.has(node.name))
    if (inside && blocks) return true
    if (node.type === 'tf_merge') {
      if (tainted || !cut) return true
      inside = true
    }
    if (node.type === 'offset' && !movedHere && wholeBack(node.value)) cut = true
    if (blocks) tainted = true
    if (Array.isArray(node.args)) for (const a of node.args) stack.push([a, cut, tainted, inside])
  }
  return false
}

function treeHoldsType(tree, type) {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue }
    if (n.type === type) return true
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
  const mergeWhy = new Map()
  if (!isPineOriginDoc(def)) {
    for (const k of keys) {
      const tree = trees ? trees[k] : compute.ast
      if (treeReadsLtf(tree)) ltfWhy.set(k, FORMULA_LTF_MESSAGE)
      else if (treeReadsTfMerge(tree)) mergeWhy.set(k, FORMULA_TF_MERGE_MESSAGE)
    }
  }
  const formulaWhy = (k) => (ltfWhy.has(k) ? { guard: FORMULA_LTF_GUARD, message: FORMULA_LTF_MESSAGE }
    : mergeWhy.has(k) ? { guard: FORMULA_TF_MERGE_GUARD, message: FORMULA_TF_MERGE_MESSAGE } : null)
  if ((ltfWhy.size || mergeWhy.size) && (!trees || ltfWhy.size + mergeWhy.size === keys.length)) {
    const whole = {}
    const first = formulaWhy(keys.find((k) => formulaWhy(k)))
    for (const key of keys) whole[key] = formulaWhy(key) || first
    return { whole, perKey: new Map() }
  }
  const perKey = new Map()
  if (trees) {
    for (const key of keys) {
      if (periodWhy.has(key)) { perKey.set(key, { guard: PERIOD_READS_GUARD, message: periodWhy.get(key) }); continue }
      if (formulaWhy(key)) { perKey.set(key, formulaWhy(key)); continue }
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
    // ⭐ RS RATING L1b — a witnessed spelling is served on the timeframes its witness covers
    tf: ctx && ctx.tf,
    // ⭐ RS RATING L11 PR 2 — the chart's newest bar reads its own period (`newestOwnPeriodOf`)
    chartNewestDay: ctx && ctx.chartNewestDay,
    // ⭐ RS RATING L12 PR 2 (Q-L12-2) — the chart's bars, for a seed's intraday fold (`utcMidnightAtOrAfterOf`)
    chartBars: ctx && ctx.chartBars,
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
  // ⭐ ENGINE 55 — Pine's merged higher-timeframe read: its newest finished bar is
  // withheld (`interpret.js::tfMergeMask`), and that is the bar an alert reads.
  // Mirrors `alert_user_series._make_value_fn`.
  // ⭐⭐ ALERT TF_MERGE (2026-11-19, option A) — unless every merge is read through a history
  // offset k >= 1 (`mergeNewestUnproven`, static), which the chart draws on the newest bar (#1996).
  if (mergeNewestUnproven(tree, compute)) codes.push(TF_MERGE_NEWEST_CODE)
  if (codes.length) return { gate: 'withheld', codes }
  return null
}

/** The alert lane's gates that refuse ONE plot, not the definition
 *  (`alert_user_series.PER_PLOT_GATES`). */
const ALERT_PER_PLOT_GATES = new Set(['withheld', 'scalar', 'presentation'])

/** ⭐ UIE PHASE 6 (OPEN-FINDINGS-2026-10 §1) — an `hlines` plot is a level-line GUIDE (presentation,
 *  not a value): refused for itself only, decided before any tree lookup. Mirrors
 *  `alert_user_series._make_value_fn`'s `presentation` gate. */
function isGuidePlot(def, key) {
  const p = (Array.isArray(def && def.plots) ? def.plots : []).find((x) => isObj(x) && String(x.key) === String(key))
  return !!p && p.style === 'hlines'
}
const alertPlotGate = (def, compute, key) => (isGuidePlot(def, key) ? { gate: 'presentation', codes: [] } : alertPlotRefusal(compute, key))

const ALERT_SENTENCE = {
  lane: 'This output is not a formula, and the alert lane admits only formulas.',
  plot: 'This document declares several plots and carries no tree for this one, so the alert lane '
    + 'cannot tell which number to watch.',
  scalar: 'It reads a current-only screener value that has no bar history, so an alert on it would '
    + 'arm and never fire. It works as a screen.',
  presentation: 'These are level lines — a guide drawn at fixed values, not a value that moves — so there is '
    + 'nothing for an alert to watch. Alert on the indicator\'s own line instead (for example, RSI crossing above 70).',
  withheld: 'It reads a series the alert lane is never handed (a timeframe below the chart, or another '
    + 'symbol it cannot load: an ambiguous spelling, or more than two), or a weekly or monthly value whose newest '
    + 'finished bar is not known until the next session, so an alert on it would arm and never fire.',
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
    const r = alertPlotGate(def, compute, k)
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
  const own = alertPlotGate(def, compute, key)
  if (own) {
    return answer(base, { status: STATUS.REFUSED, authority: 'server', final: true, gate: own.gate,
      guard: `alert:${own.gate}`, codes: own.codes, reason: ALERT_SENTENCE[own.gate] })
  }
  return answer(base, { status: STATUS.SUPPORTED, authority: 'server', final: false,
    note: 'The server decides the rest at arm: whole-series withholding, repaint, budget and the '
      + 'two-lane proof on the alert\'s own bars.' })
}

const _gateMemo = new WeakMap()
/** ⭐⭐ (train e95, the 2b bind audit) THE DOCUMENT A GATE READS: `def` bound at the binding's settings (`ctx.inputs`;
 *  the declared defaults for a caller that holds no instance), every knob ternary's unpicked arm pruned
 *  (`knobBind.js::boundAtInputs`, the chart lane's own bind). Since 2b the SAVED document keeps every arm of a
 *  `switch` on a member's `input.string`, so a gate that read it refused a knob script on an arm the member never
 *  picked (an event field UCT does not hold, another symbol, a lower timeframe); a picked arm still refuses by name.
 *  Memoised per document and settings; the document itself when nothing prunes. */
export function gateDocument(def, ctx) {
  if (!isObj(def) || !isObj(def.compute)) return def
  const inputs = ctx && isObj(ctx.inputs) ? ctx.inputs : null
  const sig = inputs ? JSON.stringify(inputs) : ''
  let byDef = _gateMemo.get(def)
  if (byDef && byDef.has(sig)) return byDef.get(sig)
  const out = boundAtInputs(def, inputs || {})
  if (!byDef) {
    byDef = new Map()
    _gateMemo.set(def, byDef)
  }
  if (byDef.size > 16) byDef.clear()
  byDef.set(sig, out)
  return out
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
export function evaluability(savedDef, key, lane, ctx) {
  // ⭐⭐ (train e95, the 2b bind audit) every lane below decides on what this binding draws (`gateDocument`)
  const def = gateDocument(savedDef, ctx)
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
