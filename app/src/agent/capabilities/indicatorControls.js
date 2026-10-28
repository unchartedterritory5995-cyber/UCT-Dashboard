// ── INDICATORS P2: style, placement, panes, duplicate, copy — through Indicators' contract ─────────
//
// The Agent half of `docs/indicators/AGENT-CONTRACT-P2-2026-10-27.md` (I-1…I-12). Every decision about a
// change — what values are allowed, whether it is stale, whether it landed, how it is undone — is Indicators'
// (`components/chart/builder/agentMutations.js`, `uct.indicators.mutation/1`). These capabilities only turn
// the member's request into ONE request for ONE chart and present it; the indicatorEdits target kind
// (indicatorEdits.js) runs the same plan → apply → persist → confirm → Undo it runs for add / remove:
//
//   indicatorStyle.set      setAppearance (line width / style / overlap) · setPlotStyle · setColor
//   indicatorStyle.placeIn  setDisplayTarget (price pane / volume pane / its own pane / another indicator's pane)
//   pane.move               movePane (up / down / top / bottom / above / below another pane)
//   pane.resize             setPaneSize (a share of the chart's height, bigger / smaller, or automatic)
//   indicatorCopy.duplicate duplicate (a second copy on the same chart)
//   indicatorCopy.copyTo    copyFrom (indicators from one chart onto another — one op per chart: fan-out)
//
// Each is its own routing group (`indicatorSetup`), so the NL-1 core keeps its size. One indicator change
// per request, sequential (the `common` rules), each with its own receipt and exact Undo.
// ⛔ NO WRITER HERE, and no value is invented: every option comes from `styleOptionsOf` / `paneKeysOf`.

import { registerCapability } from '../capabilities'
import { styleOptionsOf, REASONS } from '../../components/chart/builder/agentMutations'
import { paneKeysOf } from '../../components/chart/builder/agentPanes'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { normalizeColor } from './chart'
import {
  common, oneChange, targetOf, planFor, refusalSentence, extReceiptLine, VOLUME_OPTS, placeWord, indicatorEditsRef, defIdOfWords,
} from './indicatorEdits'

const APPEARANCE = ['lineWidth', 'lineStyle', 'overlap']
const PROPERTIES = ['color', 'upColor', 'downColor', 'lineWidth', 'lineStyle', 'plotStyle', 'overlap']
const lc = (s) => String(s ?? '').trim().toLowerCase()

// ── the request for ONE style change (or why there is none) ──
/** A colour as the contract accepts it: a name or hex (→ #rrggbb), or a theme token / rgb() / hsl() as said. */
export function colorValueOf(v) {
  const hex = normalizeColor(v)
  if (hex) return hex
  const s = String(v ?? '').trim()
  return /^(token:|rgba?\(|hsla?\(|#)/i.test(s) ? s : null
}
/** The colour target a colour change means: the one the member named (by its label or key), else the only one. */
function colorTargetOf(opts, output) {
  const inputs = (opts.colors || []).filter(c => c.target.startsWith('input:'))
  if (output) {
    const w = lc(output)
    const hit = inputs.filter(c => lc(c.label) === w || lc(c.target.slice(6)) === w || lc(c.label).includes(w))
    return hit.length === 1 ? { target: hit[0].target } : { ask: inputs }
  }
  return inputs.length === 1 ? { target: inputs[0].target } : { ask: inputs }
}
/** "thicker" / "thinner" → the next line width the Inspector offers (from the current one). */
function relativeWidth(opts, word) {
  const a = (opts.appearance || []).find(x => x.key === 'lineWidth')
  if (!a) return null
  const i = a.options.indexOf(Number(a.current))
  const j = word === 'thicker' ? i + 1 : i - 1
  return j >= 0 && j < a.options.length ? a.options[j] : a.current
}
export function styleRequest(st, { instance, property, value, output }) {
  const t = targetOf(st, instance)
  if (!t.ok) return { why: refusalSentence(t, { chart: st.chart }) }
  const id = t.instanceId
  if (!PROPERTIES.includes(property)) return { why: `“${property}” isn't something I can change on an indicator.` }
  let opts
  try { opts = styleOptionsOf(st.cs, nativeRegistry, id) } catch { opts = null }
  if (!opts || !opts.ok) return { why: refusalSentence(opts || { reason: REASONS.BAD_REQUEST }, { chart: st.chart }) }
  if (APPEARANCE.includes(property)) {
    let v = value
    if (property === 'lineWidth' && (lc(value) === 'thicker' || lc(value) === 'thinner')) v = relativeWidth(opts, lc(value))
    else if (property === 'lineWidth') v = Number(value)
    else if (property === 'overlap') v = value === true || lc(value) === 'true' || lc(value) === 'on'
    else v = lc(value)
    return { req: { op: 'setAppearance', instanceId: id, key: property, value: v }, name: t.name }
  }
  if (property === 'plotStyle') {
    const plots = opts.plotStyles || []
    const pick = output ? plots.find(p => lc(p.label) === lc(output) || lc(p.plotKey) === lc(output)) : null
    return { req: { op: 'setPlotStyle', instanceId: id, style: lc(value), ...(pick ? { plotKey: pick.plotKey } : {}) }, name: t.name }
  }
  const color = colorValueOf(value)
  if (!color) return { why: `“${value}” isn't a colour I know — use a name like green or a #hex.` }
  if (property === 'upColor' || property === 'downColor') {
    const signs = (opts.colors || []).filter(c => c.target === (property === 'upColor' ? 'sign:up' : 'sign:down'))
    const pick = output ? signs.find(c => lc(c.plotKey) === lc(output) || lc(c.label).includes(lc(output))) : signs[0]
    return { req: { op: 'setColor', instanceId: id, target: property === 'upColor' ? 'sign:up' : 'sign:down', color, ...(pick?.plotKey ? { plotKey: pick.plotKey } : {}) }, name: t.name }
  }
  const tgt = colorTargetOf(opts, output)
  if (tgt.ask) {
    return { why: tgt.ask.length ? `${t.name} has more than one colour — which one: ${tgt.ask.map(c => c.label).join(', ')}?` : `${t.name} has no colour setting I can change.` }
  }
  return { req: { op: 'setColor', instanceId: id, target: tgt.target, color }, name: t.name }
}

// ── panes ──
/** The panes of one chart, top to bottom (Indicators' own list). */
export function panesOf(st) {
  try { return paneKeysOf(st.cs, nativeRegistry, VOLUME_OPTS) } catch { return [] }
}
/** "price" / "volume" / an indicator (id, name, length, kind) → its pane key, or why not. */
export function paneKeyOf(st, words) {
  const w = lc(words)
  const panes = panesOf(st)
  if (w === 'price' || w === 'the price' || w === 'price pane' || w === 'candles') return panes.some(p => p.paneKey === 'price') ? { key: 'price' } : { why: 'There is no price pane on that chart.' }
  if (w === 'volume' || w === 'volume pane') return panes.some(p => p.paneKey === 'volume') ? { key: 'volume' } : { why: 'Volume is not in its own pane on that chart.' }
  const byLabel = panes.filter(p => lc(p.label) === w)
  if (byLabel.length === 1) return { key: byLabel[0].paneKey }
  const t = targetOf(st, words)
  if (!t.ok) return { why: refusalSentence(t, { chart: st.chart }) }
  const hit = panes.find(p => p.ownerInstanceIds.includes(t.instanceId))
  if (!hit) return { why: `${t.name} isn't drawn on that chart right now.` }
  if (hit.kind === 'price') return { why: `${t.name} draws on the price pane — put it in its own pane first (or move the price pane).` }
  return { key: hit.paneKey, name: t.name }
}
const POSITIONS = ['up', 'down', 'top', 'bottom', 'above', 'below']
export function moveRequest(st, { pane, to, relativeTo }) {
  const p = paneKeyOf(st, pane)
  if (p.why) return { why: p.why }
  const order = panesOf(st).map(x => x.paneKey)
  if (to === 'up' || to === 'down') return { req: { op: 'movePane', paneKey: p.key, delta: to === 'up' ? -1 : 1 } }
  if (to === 'top') return { req: { op: 'movePane', paneKey: p.key, beforeKey: order[0] === p.key ? order[1] ?? null : order[0] } }
  if (to === 'bottom') return { req: { op: 'movePane', paneKey: p.key, beforeKey: null } }
  if (to !== 'above' && to !== 'below') return { why: `Say where: ${POSITIONS.join(', ')}.` }
  if (relativeTo == null) return { why: `Above or below which pane — ${panesOf(st).map(x => x.label).join(', ')}?` }
  const r = paneKeyOf(st, relativeTo)
  if (r.why) return { why: r.why }
  if (r.key === p.key) return { why: 'That is the same pane.' }
  if (to === 'above') return { req: { op: 'movePane', paneKey: p.key, beforeKey: r.key } }
  const rest = order.filter(k => k !== p.key)
  return { req: { op: 'movePane', paneKey: p.key, beforeKey: rest[rest.indexOf(r.key) + 1] ?? null } }
}
export function resizeRequest(st, { pane, size }) {
  const p = paneKeyOf(st, pane)
  if (p.why) return { why: p.why }
  const panes = panesOf(st)
  const cur = panes.find(x => x.paneKey === p.key)
  const w = lc(size)
  if (w === 'auto' || w === 'automatic' || w === 'reset') return { req: { op: 'setPaneSize', paneKey: p.key, share: null } }
  // an automatic pane's height is the chart's to decide: "bigger" starts from an even share
  const base = Number.isFinite(cur?.share) ? cur.share : 1 / Math.max(2, panes.length)
  const round = (x) => Math.round(Math.min(0.9, Math.max(0.04, x)) * 100) / 100
  if (w === 'bigger' || w === 'taller' || w === 'larger') return { req: { op: 'setPaneSize', paneKey: p.key, share: round(base * 1.5) } }
  if (w === 'smaller' || w === 'shorter') return { req: { op: 'setPaneSize', paneKey: p.key, share: round(base / 1.5) } }
  const n = Number(size)
  if (!Number.isFinite(n) || n <= 0) return { why: 'Say a size (a percent of the chart\'s height), bigger, smaller or automatic.' }
  return { req: { op: 'setPaneSize', paneKey: p.key, share: n > 1 ? n / 100 : n } }
}

// ── copy ──
const asChart = (r) => (typeof r === 'string' ? r.replace(/^(?:ind|ixe):/, '') : r)
export function copyRequest(st, { from, instances }, env) {
  const srcChart = asChart(from)
  if (!srcChart) return { why: 'Copy from which chart?' }
  if (srcChart === st.chartRef) return { why: 'That is the same chart — name the chart to copy the indicators FROM.' }
  const src = env?.peer?.(indicatorEditsRef(srcChart))
  if (!src) return { why: 'That chart isn\'t on the board — name the chart to copy the indicators from.' }
  const srcSt = { chart: src.label, chartRef: src.chartRef, cs: src.cs, rows: src.rows }
  const rows = srcSt.rows || []
  if (!rows.length) return { why: `${src.label} has no indicators to copy.` }
  const ids = []
  for (const x of (Array.isArray(instances) && instances.length ? instances : rows.map(r => r.instanceId))) {
    const t = targetOf(srcSt, x)
    if (!t.ok) return { why: refusalSentence(t, { chart: src.label }) }
    if (!ids.includes(t.instanceId)) ids.push(t.instanceId)
  }
  return { req: { op: 'copyFrom', sourceCs: src.cs, instanceIds: ids, sourceChartId: srcChart }, from: src.label }
}

// ── the shared check / apply / describe for one built request ──
function checkBuilt(st, built, op) {
  if (built.why) return built.why
  return oneChange(st) || planCheckP2(st, built.req, op)
}
function planCheckP2(st, req, op) {
  if (!st.canManage) return refusalSentence({ reason: REASONS.READONLY }, { chart: st.chart })
  const p = planFor(st, req)
  if (!p.ok && p.reason === REASONS.NO_CHANGE) return null                 // said as a no-op, not a refusal
  return p.ok ? null : refusalSentence(p, { chart: st.chart, op: op || req.op })
}
function applyBuilt(st, built) {
  if (built.why || !built.req) return st
  const p = planFor(st, built.req)
  return p.ok ? { ...st, change: { request: built.req, plan: p.plan } } : st
}
function describeBuilt(a) {
  if (!a.change) return null
  const { plan } = a.change
  const pv = plan.preview || {}
  return extReceiptLine({ op: plan.op, change: pv.change, copied: pv.copied, already: pv.already, from: pv.from }, pv.nameAfter || pv.name || 'the indicator', ` on ${a.chart}`)
}

let registered = false
export function registerIndicatorControlCapabilities() {
  if (registered) return
  registered = true
  const instanceArg = { type: 'string' }

  registerCapability({
    ...common,
    name: 'indicatorStyle.set',
    fanOut: true,
    summary: 'Change how ONE indicator on ONE chart looks — its colour (or a histogram\'s up / down colours), line width, line style or plot style — exactly what its settings / Inspector offer. One change per op; Undo puts it back.',
    hints: 'target = the ref of that chart\'s indicatorEdits entry; instance = the indicator\'s id from that chart\'s indicators list (or "#20" for the one of length 20, "#20:ema"). property = color | upColor | downColor | lineWidth (1–4, or "thicker" / "thinner") | lineStyle (solid | dashed | dotted) | plotStyle (line, histogram, area… as offered) | overlap. value = the member\'s value (a colour name or #hex for colours). output = which line or colour when the indicator has several (its label), else null. "Make the 9 green and the 20 red and dashed" = three ops.',
    args: { type: 'object', properties: { instance: instanceArg, property: { type: 'string', enum: PROPERTIES }, value: { type: ['string', 'number', 'boolean'] }, output: { type: ['string', 'null'] } }, required: ['instance', 'property', 'value', 'output'], additionalProperties: false },
    fast: ({ lower }) => fastStyle(lower),
    check: (st, args) => checkBuilt(st, styleRequest(st, args)),
    apply: (st, args) => applyBuilt(st, styleRequest(st, args)),
    describe: (b, a) => describeBuilt(a),
    noop: () => 'it already looks like that',
  })

  registerCapability({
    ...common,
    name: 'indicatorStyle.placeIn',
    fanOut: true,
    summary: 'Move ONE indicator on ONE chart to where it draws — on the price pane, on the volume pane, in its own pane, inside another indicator\'s pane, or back to automatic (the Inspector\'s "Display in"). Undo puts it back.',
    hints: 'target = the chart\'s indicatorEdits entry; instance = the indicator; place = price | volume | pane (its own) | auto | another indicator on that chart (its id or name) to draw inside its pane.',
    args: { type: 'object', properties: { instance: instanceArg, place: { type: 'string' } }, required: ['instance', 'place'], additionalProperties: false },
    fast: ({ lower }) => fastPlace(lower),
    confirmIf(st, args) {
      const b = placeRequest(st, args)
      if (!b.req) return false
      const p = planFor(st, b.req)
      return !!(p.ok && (p.plan.preview.change?.guests || []).length)        // others in its pane move too: shown first
    },
    check: (st, args) => checkBuilt(st, placeRequest(st, args)),
    apply: (st, args) => applyBuilt(st, placeRequest(st, args)),
    describe: (b, a) => describeBuilt(a),
    noop: (b, a, { place } = {}) => `it is already ${placeWord(place)}`,
  })

  registerCapability({
    ...common,
    name: 'pane.move',
    summary: 'Reorder ONE chart\'s panes (Chart Data → Arrange): move a pane up, down, to the top or bottom, or above / below another pane ("move RSI above price"). Undo puts the order back.',
    hints: 'target = the chart\'s indicatorEdits entry; pane = price | volume | an indicator drawn in its own pane (its id, name or kind, e.g. "rsi"); to = up | down | top | bottom | above | below; relativeTo = the other pane for above / below, else null.',
    args: { type: 'object', properties: { pane: { type: 'string' }, to: { type: 'string', enum: POSITIONS }, relativeTo: { type: ['string', 'null'] } }, required: ['pane', 'to', 'relativeTo'], additionalProperties: false },
    fast: ({ lower }) => fastMove(lower),
    check: (st, args) => checkBuilt(st, moveRequest(st, args)),
    apply: (st, args) => applyBuilt(st, moveRequest(st, args)),
    describe: (b, a) => describeBuilt(a),
    noop: () => 'that pane is already there',
  })

  registerCapability({
    ...common,
    name: 'pane.resize',
    summary: 'Change the height of ONE pane on ONE chart (what dragging its divider does): a percent of the chart\'s height, bigger, smaller, or back to automatic. Undo puts it back.',
    hints: 'target = the chart\'s indicatorEdits entry; pane = price | volume | an indicator in its own pane; size = a percent (4–90) or "bigger" | "smaller" | "auto".',
    args: { type: 'object', properties: { pane: { type: 'string' }, size: { type: ['string', 'number'] } }, required: ['pane', 'size'], additionalProperties: false },
    fast: ({ lower }) => fastResize(lower),
    check: (st, args) => checkBuilt(st, resizeRequest(st, args)),
    apply: (st, args) => applyBuilt(st, resizeRequest(st, args)),
    describe: (b, a) => describeBuilt(a),
    noop: () => 'that pane is already that size',
  })

  registerCapability({
    ...common,
    name: 'indicatorCopy.duplicate',
    addsIndicators: true,
    summary: 'Add a second copy of ONE indicator on the same chart, with everything it is configured with (the legend\'s Duplicate). Undo removes only the copy.',
    hints: 'target = the chart\'s indicatorEdits entry; instance = the indicator to copy. To put indicators on ANOTHER chart use indicatorCopy.copyTo.',
    args: { type: 'object', properties: { instance: instanceArg }, required: ['instance'], additionalProperties: false },
    check(st, { instance }) {
      const t = targetOf(st, instance)
      return checkBuilt(st, t.ok ? { req: { op: 'duplicate', instanceId: t.instanceId } } : { why: refusalSentence(t, { chart: st.chart }) })
    },
    apply(st, { instance }) {
      const t = targetOf(st, instance)
      return t.ok ? applyBuilt(st, { req: { op: 'duplicate', instanceId: t.instanceId } }) : st
    },
    describe: (b, a) => describeBuilt(a),
  })

  registerCapability({
    ...common,
    name: 'indicatorCopy.copyTo',
    addsIndicators: true,
    fanOut: true,
    summary: 'Copy indicators from one chart onto ANOTHER chart, exactly as configured (colours, settings, panes and links between them — the Indicator templates copy). One op per destination chart; an indicator already there is skipped and said. Undo removes what was added.',
    hints: 'target = the DESTINATION chart\'s indicatorEdits entry; from = the ref of the chart to copy FROM; instances = the indicators to copy (ids or names from that chart), or [] for all of them. "Copy these indicators to all my charts" = one op per other chart.',
    argRefs: { from: ['chart', 'indicators', 'indicatorEdits'] },
    args: { type: 'object', properties: { from: { type: 'string' }, instances: { type: 'array', items: { type: 'string' } } }, required: ['from', 'instances'], additionalProperties: false },
    check: (st, args, env) => checkBuilt(st, copyRequest(st, args, env)),
    apply: (st, args, env) => applyBuilt(st, copyRequest(st, args, env)),
    describe: (b, a) => describeBuilt(a),
    noop: () => 'those indicators are already on that chart',
  })
}

export function placeRequest(st, { instance, place }) {
  const t = targetOf(st, instance)
  if (!t.ok) return { why: refusalSentence(t, { chart: st.chart }) }
  const w = lc(place).replace(/^(?:the |its )/, '')
  const map = { price: 'price', 'price pane': 'price', candles: 'price', chart: 'price', volume: 'volume', 'volume pane': 'volume', pane: 'pane', 'own pane': 'pane', 'separate pane': 'pane', 'new pane': 'pane', auto: 'auto', automatic: 'auto', default: 'auto' }
  let target = map[w]
  if (!target) {
    const host = targetOf(st, place)
    if (!host.ok) return { why: `I can put ${t.name} on the price pane, the volume pane, in its own pane, or inside another indicator's pane — which?` }
    if (host.instanceId === t.instanceId) return { why: 'That is the same indicator.' }
    target = `@${host.instanceId}`
  }
  return { req: { op: 'setDisplayTarget', instanceId: t.instanceId, target } }
}

// ── instant phrases (no model call) — only the unambiguous shapes; anything else reaches the model ──
const COLORS = ['white', 'black', 'blue', 'green', 'red', 'gray', 'grey', 'teal', 'orange', 'yellow', 'purple', 'pink', 'navy', 'cream']
const instanceWord = (w) => {
  const s = lc(w).replace(/^(?:the |my )/, '').replace(/ (?:line|indicator)$/, '')
  const n = /^(\d{1,4})(?: ?(ema|sma|wma|hma))?$/.exec(s)
  if (n) return n[2] ? `#${n[1]}:${n[2]}` : `#${n[1]}`
  // a word is an indicator only when it NAMES one exactly ("rsi", "macd") — "make the chart green" is not ours
  return defIdOfWords(s) ? s : null
}
function fastStyle(lower) {
  let m = new RegExp(`^(?:make|turn|colou?r|paint) (.+?) (${COLORS.join('|')}|#[0-9a-f]{3}|#[0-9a-f]{6})$`).exec(lower)
  if (m && instanceWord(m[1])) return { instance: instanceWord(m[1]), property: 'color', value: m[2], output: null }
  m = /^make (.+?) (thicker|thinner|dashed|dotted|solid)$/.exec(lower)
  if (m && instanceWord(m[1])) {
    const v = m[2]
    return v === 'thicker' || v === 'thinner' ? { instance: instanceWord(m[1]), property: 'lineWidth', value: v, output: null } : { instance: instanceWord(m[1]), property: 'lineStyle', value: v, output: null }
  }
  m = /^(?:show|draw|make) (.+?) (?:as )?an? (histogram|line|area|columns)$/.exec(lower)
  if (m && instanceWord(m[1])) return { instance: instanceWord(m[1]), property: 'plotStyle', value: m[2], output: null }
  return null
}
function fastPlace(lower) {
  const m = /^(?:put|move) (.+?) (?:in|into|on|onto) (?:its own pane|a (?:separate|new) pane|the price pane|price|the volume pane|volume)$/.exec(lower)
  if (!m || !instanceWord(m[1])) return null
  const place = /own|separate|new/.test(lower) ? 'pane' : /volume/.test(lower) ? 'volume' : 'price'
  return { instance: instanceWord(m[1]), place }
}
const paneWord = (w) => (/^(?:the )?(price|volume)$/.test(lc(w)) ? lc(w).replace(/^the /, '') : instanceWord(w))
function fastMove(lower) {
  let m = /^move (?:the )?(.+?)(?: pane)? (above|below) (?:the )?(.+?)(?: pane)?$/.exec(lower)
  if (m && paneWord(m[1]) && paneWord(m[3])) return { pane: paneWord(m[1]), to: m[2], relativeTo: paneWord(m[3]) }
  m = /^move (?:the )?(.+?)(?: pane)? (up|down|to the top|to the bottom)$/.exec(lower)
  if (m && paneWord(m[1])) return { pane: paneWord(m[1]), to: m[2].replace('to the ', ''), relativeTo: null }
  return null
}
function fastResize(lower) {
  const m = /^make (?:the )?(.+?) pane (bigger|smaller|taller|shorter)$/.exec(lower)
  return m && paneWord(m[1]) ? { pane: paneWord(m[1]), size: m[2] } : null
}

