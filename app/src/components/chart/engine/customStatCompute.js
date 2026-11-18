// app/src/components/chart/engine/customStatCompute.js
//
// ─── A CUSTOM HEADER STAT'S VALUE: THE REGISTRY'S OWN COMPUTE, OVER THE CHART'S OWN BARS ─────────────────────────
//
// A custom stat (`header.customStats`, headerCustomStats.js) is "the value of THIS indicator output, with THESE
// parameters, on the newest bar". It is answered here, and nothing here is a second indicator engine:
//
//   · THE NUMBER IS `computeFor`'s. The same registry call the binder makes for every drawn line
//     (`binder.js`, `registry.computeFor(def, calcBars, inst.inputs, ctx)`), handed the same bars the chart draws
//     from (`filteredBars`), so "EMA 21" in the header and an EMA 21 line on the chart are the same column.
//   · THE GATE IS THE SHARED ONE. `evaluability(def, key, 'info-value', ctx)` (the header info-value lane) decides
//     first; a refusal prints `n/a` with the gate's own sentence, never a number. Then the compute's own column
//     refusals (`columnErrors`: budget, block runs).
//   · THE TEXT IS THE LEGEND'S. `chipValueText` with the plot's declared decimals / compact, exactly what the legend
//     prints for that line.
//   · "LATEST VALUE" = THE NEWEST BAR'S VALUE, AND ONLY IF IT IS FINITE (the info-value rule,
//     infoValueResolve.js): a NaN newest bar prints '—', never a stale earlier value and never 0.
//
// ⛔ WHAT A HEADER STAT CAN BE ("valid"): one number per bar on the chart's own bars. So the offer is limited to
//   definitions computed in this browser from those bars alone:
//   · lanes: `native` (the shipped indicators) and `ast` (a member's saved formula). The `server` lane (UCT RS, its
//     columns are fetched per symbol) and the `runtime` lane (a pasted Pine script run bar by bar) are refused;
//   · a definition that reads another symbol or timeframe (`meta.otherSymbols` / `lowerTf` / `calcBarsRequest`, or a
//     `sym` / `ltf` / `tf` read in its tree) is refused: the header has no second bar series to hand it;
//   · every `source` input must be a field of the chart's own bars (Close, HL2, …): another indicator, a symbol, a
//     fundamental or an economic series is refused;
//   · the output must be a declared DATA plot typed SERIES (a number per bar): guides, hidden helper columns,
//     OHLC-shaped plots, yes/no conditions and current-only scalars are refused, and so is a plot drawn displaced
//     (`plot.displace`, Ichimoku's lagging span), whose newest drawn bar is not its newest computed value.
//
// PURE apart from the registry it is handed (default: the shipped one). No React.

import * as shippedRegistry from './nativeRegistry'
import { evaluability, STATUS } from './evaluability'
import { outputTypeOf, OUTPUT_TYPES } from './outputType'
import { chipValueText } from './readout'
import { instanceLabel, parseSource, barFieldSeries } from './sourceRef'
import { SOURCE_BAR_FIELDS } from './defSchema'
import { customStatKey } from '../headerCustomStats'

const UNKNOWN_TEXT = '—'
const COMPUTE_LANES = new Set(['native', 'ast'])
const OHLC_STYLES = new Set(['candlestick', 'bar'])
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const CUSTOM_STAT_STATES = Object.freeze({
  VALUE: 'value',         // a finite value on the newest bar, formatted
  UNKNOWN: 'unknown',     // computed, but the newest bar has no value ('—')
  PENDING: 'pending',     // no bars yet, or the member's saved formula is not installed yet
  REFUSED: 'refused',     // this output cannot be a header stat here (the sentence says why)
  MISSING: 'missing',     // the indicator or the output no longer exists
})

const nameOf = (def) => (def && ((def.meta && (def.meta.shortName || def.meta.name)) || def.name || def.id)) || 'Indicator'
const fullNameOf = (def) => (def && ((def.meta && def.meta.name) || def.name || def.id)) || 'Indicator'

/** Does the definition's tree read other bars (another symbol, a lower / higher timeframe)? */
function treeReadsOtherBars(def) {
  const c = (def && def.compute) || {}
  const roots = isObj(c.trees) ? Object.values(c.trees) : [c.ast]
  const stack = [...roots]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'sym' || n.type === 'ltf' || n.type === 'tf' || n.type === 'tf_live') return true
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v)
  }
  return false
}

/** Why `def` can never be a header stat (a sentence), or null when some of its outputs may be. */
export function customStatDefRefusal(def, registry = shippedRegistry) {
  if (!def || !isObj(def)) return 'This indicator is not available.'
  const kind = (def.compute && def.compute.kind) || 'native'
  if (kind === 'server') return 'This indicator is computed on the server, so it cannot be a header stat.'
  if (!COMPUTE_LANES.has(kind)) return 'This indicator runs as a script, so it cannot be a header stat.'
  if (registry.CARVED_OUT_INDICATOR_KEYS && registry.CARVED_OUT_INDICATOR_KEYS.has(def.id)) {
    return 'This indicator draws a profile, not one value per bar.'
  }
  if (def.meta && def.meta.labelFrom === 'source') return 'This indicator only repeats a data series.'
  const m = def.meta || {}
  if (m.calcBarsRequest === true || (Array.isArray(m.otherSymbols) && m.otherSymbols.length)
    || (Array.isArray(m.lowerTf) && m.lowerTf.length) || (kind === 'ast' && treeReadsOtherBars(def))) {
    return 'This indicator reads another symbol or timeframe, which the header cannot supply.'
  }
  for (const input of Array.isArray(def.inputs) ? def.inputs : []) {
    if (!input || input.type !== 'source') continue
    const p = parseSource(input.default)
    if (!p || p.kind !== 'bar') return 'This indicator reads a series other than this chart\'s prices.'
  }
  return null
}

/** Why output `key` of `def` cannot be a header stat, or null when it can. */
export function customStatOutputRefusal(def, key, registry = shippedRegistry) {
  const why = customStatDefRefusal(def, registry)
  if (why) return why
  const plot = (Array.isArray(def.plots) ? def.plots : []).find((p) => p && p.key === key)
  if (!plot) return 'This indicator has no such output.'
  if (plot.style === 'hlines') return 'This is a guide line, which carries no value per bar.'
  if (plot.hidden === true) return 'This is a helper column the indicator does not show.'
  if (OHLC_STYLES.has(plot.style)) return 'This output is a candle, not one number.'
  if (Number.isInteger(plot.displace) && plot.displace !== 0) {
    return 'This output is drawn shifted in time, so its newest value is not on the newest bar.'
  }
  const t = outputTypeOf(def, key)
  if (t.type !== OUTPUT_TYPES.SERIES) {
    return t.type === OUTPUT_TYPES.CONDITION || t.type === OUTPUT_TYPES.EVENTS
      ? 'This output is a yes/no, not a number.'
      : 'This output is not a number on every bar.'
  }
  return null
}

/** The outputs of `def` a header stat can show, in declaration order: `[{key, label}]`. */
export function customStatOutputs(def, registry = shippedRegistry) {
  if (customStatDefRefusal(def, registry)) return []
  const plots = (Array.isArray(def.plots) ? def.plots : []).filter((p) => p && typeof p.key === 'string')
  return plots.filter((p) => !customStatOutputRefusal(def, p.key, registry))
    .map((p) => ({ key: p.key, label: (typeof p.label === 'string' && p.label) || p.key }))
}

/** `inputs` reduced to the definition's declared, VALID values (anything else falls back to the default). Colors and
 *  text are dropped: they never change the value. */
export function sanitizeStatInputs(def, inputs) {
  const out = {}
  const raw = isObj(inputs) ? inputs : {}
  for (const d of Array.isArray(def && def.inputs) ? def.inputs : []) {
    if (!d || typeof d.key !== 'string' || !Object.prototype.hasOwnProperty.call(raw, d.key)) continue
    const v = raw[d.key]
    const inRange = (x) => (d.min == null || x >= d.min) && (d.max == null || x <= d.max)
    switch (d.type) {
      case 'int': if (Number.isInteger(v) && inRange(v)) out[d.key] = v; break
      case 'float': if (typeof v === 'number' && Number.isFinite(v) && inRange(v)) out[d.key] = v; break
      case 'bool': if (typeof v === 'boolean') out[d.key] = v; break
      case 'enum': {
        const vals = (d.options || []).map((o) => (Array.isArray(o) ? o[0] : (isObj(o) ? o.value : o)))
        if (vals.includes(v)) out[d.key] = v
        break
      }
      case 'source': if (SOURCE_BAR_FIELDS.includes(v)) out[d.key] = v; break
      default: break
    }
  }
  return out
}

/** Is the output centred on zero (the indicator declares a 0 guide)? Then the header tints it green / red by sign. */
export function customStatSigned(def) {
  return (Array.isArray(def && def.plots) ? def.plots : [])
    .some((p) => p && p.style === 'hlines' && Array.isArray(p.levels) && p.levels.includes(0))
}

/** The stat's name, the way the chart names the line: `EMA 21`, `RSI 14`, `MACD · Signal`. `{label, short, title}`. */
export function customStatLabel(def, entry) {
  const inputs = sanitizeStatInputs(def, entry && entry.inputs)
  let base
  try { base = instanceLabel(def, { inputs }) } catch { base = nameOf(def) }
  // the header row is tight: the chart's `RSI (14)` reads `RSI 14` there (same name, no brackets)
  base = String(base || nameOf(def)).replace(/\s*\(([^()]*)\)$/, ' $1')
  const dataPlots = customStatOutputs(def)
  const plot = (def.plots || []).find((p) => p && p.key === entry.plotKey)
  const plotLabel = plot ? ((plot.legend && plot.legend.label) || plot.label || plot.key) : entry.plotKey
  const multi = dataPlots.length > 1 || (def.plots || []).filter((p) => p && p.style !== 'hlines' && p.hidden !== true).length > 1
  const label = multi && plotLabel && plotLabel !== base ? `${base} · ${plotLabel}` : base
  return { label, short: label, title: `${fullNameOf(def)}${multi && plot ? ` · ${plot.label || plot.key}` : ''}` }
}

/** Every definition this chart can resolve that has at least one valid output: the builder's list.
 *  `[{defId, name, category, mine, outputs}]`, shipped first (by category, then name), then the member's own. */
export function customStatChoices(registry = shippedRegistry) {
  const all = typeof registry.listAllDefinitions === 'function' ? registry.listAllDefinitions() : []
  const mineIds = new Set((typeof registry.listUserDefinitions === 'function' ? registry.listUserDefinitions() : [])
    .map((d) => d && d.id))
  const out = []
  for (const def of all) {
    if (!def || typeof def.id !== 'string') continue
    const outputs = customStatOutputs(def, registry)
    if (!outputs.length) continue
    out.push({
      defId: def.id, name: fullNameOf(def), mine: mineIds.has(def.id),
      category: (def.meta && def.meta.category) || (mineIds.has(def.id) ? 'My indicators' : 'Other'), outputs,
    })
  }
  return out.sort((a, b) => (a.mine - b.mine) || (a.mine ? 0 : a.category.localeCompare(b.category)) || a.name.localeCompare(b.name))
}

const answer = (entry, extra) => ({ key: customStatKey(entry.id), ...extra })

/**
 * One custom stat, resolved over `bars`.
 * @param {{id, defId, plotKey, inputs, name?}} entry a sanitised stored entry
 * @param {object[]} bars the chart's own bars (`{t,o,h,l,c,v}`), oldest first
 * @param {{sym?, symbol?, tf?, newestBarIsForming?}} ctx what the binder hands `computeFor` for the chart's series
 * @returns {{key, state, text, value?, label, short, title, signed, reason?}}
 */
export function computeCustomStat(entry, bars, ctx = {}, registry = shippedRegistry) {
  const def = registry.getDefinition(entry.defId)
  const fallback = entry.name || 'Custom stat'
  if (!def) {
    // a saved formula that is not installed YET is the common case (the store loads after the chart); the stored
    // name keeps the row steady and the value waits
    return answer(entry, { state: CUSTOM_STAT_STATES.MISSING, text: UNKNOWN_TEXT, label: fallback, short: fallback,
      title: fallback, signed: false, reason: 'This indicator is not available on this chart (it may have been deleted).' })
  }
  const names = customStatLabel(def, entry)
  const signed = customStatSigned(def)
  const base = { ...names, signed }
  const why = customStatOutputRefusal(def, entry.plotKey, registry)
  if (why) return answer(entry, { ...base, state: CUSTOM_STAT_STATES.REFUSED, text: 'n/a', reason: why })
  const rows = Array.isArray(bars) ? bars : []
  if (!rows.length) return answer(entry, { ...base, state: CUSTOM_STAT_STATES.PENDING, text: UNKNOWN_TEXT })

  const gate = evaluability(def, entry.plotKey, 'info-value', { tf: ctx.tf, symbol: ctx.symbol || null })
  if (gate.status === STATUS.REFUSED) {
    return answer(entry, { ...base, state: gate.pending ? CUSTOM_STAT_STATES.PENDING : CUSTOM_STAT_STATES.REFUSED,
      text: gate.pending ? UNKNOWN_TEXT : 'n/a', reason: gate.reason })
  }

  const inputs = sanitizeStatInputs(def, entry.inputs)
  // the source inputs, resolved exactly as the binder resolves a bar-field source (`barFieldSeries`)
  let sources = null
  for (const d of def.inputs || []) {
    if (!d || d.type !== 'source') continue
    const p = parseSource(inputs[d.key] !== undefined ? inputs[d.key] : d.default)
    if (!p || p.kind !== 'bar') {
      return answer(entry, { ...base, state: CUSTOM_STAT_STATES.REFUSED, text: 'n/a',
        reason: 'This indicator reads a series other than this chart\'s prices.' })
    }
    sources = sources || {}
    sources[d.key] = barFieldSeries(rows, p.field)
  }
  const primary = sources ? sources[Object.keys(sources)[0]] : null
  let cols
  try {
    cols = registry.computeFor(def, rows, inputs, {
      sym: ctx.sym, symbol: ctx.symbol || null, tf: ctx.tf, source: primary, sources,
      newestBarIsForming: ctx.newestBarIsForming ?? null,
    })
  } catch {
    return answer(entry, { ...base, state: CUSTOM_STAT_STATES.REFUSED, text: 'n/a',
      reason: 'This indicator could not be computed on this chart.' })
  }
  const err = (typeof registry.columnErrors === 'function' ? registry.columnErrors(cols) : {})[entry.plotKey]
  if (err) return answer(entry, { ...base, state: CUSTOM_STAT_STATES.REFUSED, text: 'n/a', reason: err.message })
  const col = cols && cols[entry.plotKey]
  const value = col && col.length === rows.length ? Number(col[col.length - 1]) : NaN
  if (!Number.isFinite(value)) {
    return answer(entry, { ...base, state: CUSTOM_STAT_STATES.UNKNOWN, text: UNKNOWN_TEXT,
      reason: 'The newest bar has no value for this output yet.' })
  }
  const plot = def.plots.find((p) => p && p.key === entry.plotKey)
  const legend = (plot && plot.legend) || {}
  const text = chipValueText({ value, decimals: legend.decimals, compact: legend.compact === true })
  return answer(entry, { ...base, state: CUSTOM_STAT_STATES.VALUE, value, text })
}

// One memo per bars array: a re-render with the same bars and entries computes nothing. Keyed on the entry's
// identity-bearing fields, the definition object (a re-installed formula is a new object) and the ctx.
const _memo = new WeakMap()

/** Every entry resolved over `bars`: `{ [cx:<id>]: result }`. */
export function computeCustomStats(entries, bars, ctx = {}, registry = shippedRegistry) {
  const out = {}
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return out
  const memoBars = Array.isArray(bars) ? bars : null
  let byBars = memoBars ? _memo.get(memoBars) : null
  if (memoBars && !byBars) { byBars = new Map(); _memo.set(memoBars, byBars) }
  for (const e of list) {
    const def = registry.getDefinition(e.defId)
    const sig = JSON.stringify([e.id, e.defId, e.plotKey, e.inputs, e.name || '', ctx.sym || '', ctx.tf || '',
      ctx.newestBarIsForming ?? null])
    const hit = byBars && byBars.get(sig)
    if (hit && hit.def === def && hit.registry === registry) { out[hit.res.key] = hit.res; continue }
    const res = computeCustomStat(e, memoBars || [], ctx, registry)
    if (byBars) byBars.set(sig, { def, registry, res })
    out[res.key] = res
  }
  return out
}
