// app/src/components/chart/builder/authoring/readback.js
//
// ─── ⭐⭐ P2 — THE CONVERSATIONAL READBACK: FROM THE RESULTING DEFINITION ONLY ──
//
// What the member confirms is what will run, so the readback is computed from
// the RESULTING canonical definition and the authoring state — `sentence.js`
// for the maths, `outputTypeOf` for the type, the shared gate for each output's
// lane, the stored presentation, the requested alert / info value — and NEVER
// from model prose. The one model string it shows is a slot-less assumption,
// quoted and labelled as the assistant's.

import { sentenceFor } from '../../engine/ast/sentence'
import { declaredInputs, lintRepaint } from '../../engine/ast/lint'
import { outputTreeOf } from '../../engine/outputType'
import { STATUS } from '../../engine/evaluability'
import { policyLabel } from '../../engine/triggerPolicy'
import { INTENTS, intentReadback, NO_PAINT } from '../authoringIntent'

export const SEMANTICS_LINE = 'How unknown bars are treated is decided by the server when you save.'

const POSITION_WORDS = Object.freeze({ aboveBar: 'above the bar', belowBar: 'below the bar', inBar: 'on the bar' })
const SHAPE_WORDS = Object.freeze({ circle: 'circle', square: 'square', arrowUp: 'up-arrow', arrowDown: 'down-arrow' })

/** A plot's `$input` reference → that input's default (the colour the member chose). */
function resolveRef(def, v) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v
  const spec = (def.inputs || []).find((s) => s && s.key === v.slice(1))
  return spec ? spec.default : v
}

/** One-line presentation per output, plus the document's paints and placement. */
export function presentationLines(def) {
  const out = []
  const plots = (def.plots || []).filter((p) => p && p.style !== 'hlines')
  for (const p of plots) {
    const colour = resolveRef(def, p.color)
    const width = resolveRef(def, p.width)
    const label = p.label || p.key
    if (p.hidden) { out.push(`${label}: hidden (still computed)`); continue }
    if (p.style === 'markers' && p.marker) {
      const where = POSITION_WORDS[p.marker.position] || p.marker.position || 'on the bar'
      out.push(`${label}: ${SHAPE_WORDS[p.marker.shape] || p.marker.shape} marker ${where} where it is true, colour ${colour}`
        + (p.marker.text ? `, labelled "${p.marker.text}"` : ''))
    } else {
      out.push(`${label}: ${p.style || 'line'}, colour ${colour}, width ${width}`
        + (p.colorMode && p.colorUp ? ` (coloured ${p.colorUp} / ${p.colorDown} by ${String(p.colorMode).slice(7)})` : ''))
    }
  }
  for (const paint of def.paints || []) {
    if (!paint) continue
    const key = typeof paint.colorMode === 'string' && paint.colorMode.startsWith('column:') ? paint.colorMode.slice(7) : null
    const own = key && paint.colorDown === NO_PAINT && typeof paint.colorUp === 'string'
    const what = paint.kind === 'barcolor' ? 'candles painted' : 'background shaded'
    if (own) out.push(`${what} ${paint.colorUp} where ${key} is true (nothing where it is false or unknown)`)
    else out.push(`an imported ${paint.kind} paint${key ? ` reading ${key}` : ''} (kept as imported)`)
  }
  out.push(...vocabularyLines(def))
  out.push(def.placement && def.placement.target === 'price' ? 'drawn on the price chart' : 'drawn in its own pane')
  return out
}

// ─── ⭐ P3 — line style, fills and levels ─────────────────────────────────────
// Kept in one helper, additive to the lines above, so the wording of each is
// decided in one place and read off the RESULTING definition only.

const LINE_STYLE_WORDS = Object.freeze({ dashed: 'dashed', dotted: 'dotted', largeDashed: 'long-dashed' })
const LINE_DRAWN = Object.freeze(['line', 'stepline', 'area', 'baseline'])

/** Deterministic presentation lines for a plot's line style, a band between two
 *  plots, and the definition's horizontal levels. */
export function vocabularyLines(def) {
  const out = []
  const plots = (def && def.plots) || []
  const labelOf = (key) => {
    const p = plots.find((x) => x && x.key === key)
    return (p && (p.label || p.key)) || key
  }
  for (const p of plots) {
    if (!p || p.style === 'hlines') continue
    const label = p.label || p.key
    if (!p.hidden && LINE_STYLE_WORDS[p.lineStyle] && LINE_DRAWN.includes(p.style || 'line')) {
      out.push(`${label}: drawn ${LINE_STYLE_WORDS[p.lineStyle]}`)
    }
    if (p.fill && typeof p.fill.with === 'string') {
      const colour = typeof p.fillColor === 'string' ? `, colour ${p.fillColor}` : ''
      const opacity = Number.isFinite(p.fillOpacity) ? `, ${Math.round(p.fillOpacity * 100)}% opaque` : ''
      const how = p.fill.colorMode ? ' (its colour follows an imported rule)' : (colour || opacity ? '' : ' in its own colour')
      out.push(`area between ${label} and ${labelOf(p.fill.with)} shaded${how}${colour}${opacity}`)
    }
  }
  const guide = plots.find((p) => p && p.style === 'hlines' && Array.isArray(p.levels) && p.levels.length)
  if (guide) {
    out.push(`horizontal ${guide.levels.length === 1 ? 'line' : 'lines'} at ${guide.levels.join(', ')}`)
  }
  return out
}

/**
 * @param {object|null} def the resulting definition
 * @param {object} [state] the authoring state (intent, requests, assumptions, questions)
 * @param {object} [gateCtx] the chart context for the shared gate
 */
export function readback(def, state = {}, gateCtx = {}) {
  if (!def) {
    const questions = (state.questions || []).map((q) => `Question: ${q.text}`)
    return Object.freeze({ lines: ['No indicator yet.', ...questions], name: null, outputs: [], presentation: [],
      intent: null, alerts: [], infoValues: [], assumptions: [], questions, needsAck: [], status: 'refused' })
  }
  const scope = declaredInputs(def)
  const intent = state.intent || null
  const rb = intentReadback(def, intent ? intent.intent : INTENTS.PLOT,
    { ctx: gateCtx, requestedKey: intent ? intent.output : null })
  const outputs = rb.outputs.map((o) => {
    const tree = outputTreeOf(def, o.key)
    let sentence = null
    let mode = null
    try { sentence = sentenceFor(tree, scope) } catch { sentence = null }
    try { mode = lintRepaint(tree, { inputs: scope }).mode } catch { mode = 'repaints' }
    return { key: o.key, label: o.label, type: o.type, words: o.words, sentence, lane: o.lane,
      status: o.verdict.status, reason: o.verdict.reason || null, mode }
  })
  const outputLines = outputs.map((o) => {
    let line = `${o.label} (${o.key}) — ${o.words}: ${o.sentence || 'no read-back'}`
    if (o.status === STATUS.REFUSED) line += ` — cannot be used this way here: ${o.reason}`
    return line
  })
  const presentation = presentationLines(def)
  const intentLine = intent && intent.intent !== INTENTS.PLOT
    ? `${intent.intent === INTENTS.SIGNAL ? 'Signal' : 'Value'}: ${intent.output || rb.selectedKey}`
    : null
  const req = state.requests || {}
  const alerts = (req.alerts || []).map((a) => `Alert when ${a.plotKey} ${String(policyLabel(a.triggerPolicy) || a.triggerPolicy).toLowerCase()}`)
  const infoValues = (req.infoValues || []).map((v) => `Chart header shows the latest value of ${v.plotKey}${v.format === 'yesno' ? ' as Yes/No' : ''}`)
  const assumptions = (state.assumptions || []).map((a) => (a.label !== undefined
    ? `Assumed ${a.label} = ${a.value}${a.output ? ` (${a.output})` : ''}`
    : (a.source === 'engine' ? `Default: ${a.text}${a.output ? ` (${a.output})` : ''}` : `Assistant assumed: "${a.text}"`)))
  const questions = (state.questions || []).map((q) => `Question: ${q.text}`)
  const needsAck = outputs.filter((o) => o.mode === 'preview-repaints').map((o) => o.key)
  const lines = [
    `Name: ${(def.meta && def.meta.name) || ''}`,
    ...outputLines,
    ...presentation.map((l) => `Look: ${l}`),
    ...(intentLine ? [intentLine] : []),
    ...alerts,
    ...infoValues,
    ...assumptions,
    ...needsAck.map((k) => `${k} reads a bar ahead and needs your acknowledgement before saving`),
    SEMANTICS_LINE,
    ...questions,
  ]
  return Object.freeze({ lines, name: (def.meta && def.meta.name) || '', outputs, presentation, intent: intentLine,
    alerts, infoValues, assumptions, questions, needsAck, status: rb.status })
}
