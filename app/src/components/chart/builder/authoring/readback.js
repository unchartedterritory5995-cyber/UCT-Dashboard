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
//
// ⭐ P3 UX — A TRADER'S VOICE, AND STILL ONLY THE DEFINITION'S WORDS. What changed
// is the voice, not the source: no internal output keys unless two outputs share
// a label (the key is then the only way to tell them apart); colour names where
// the hex is an exact palette colour (else the hex); a comparison read as
// "true when … is above …" (EXACT — see `conditionWords`); and the unknown-bar
// rule said as what the member will see, only where it shows (an output that
// compares something). `sentence.js` is untouched: its exact sentence stays on
// `outputs[i].sentence`, and is the line whenever `conditionWords` declines.

import { sentenceFor } from '../../engine/ast/sentence'
import { TABLE } from '../../engine/ast/parse'
import { declaredInputs, lintRepaint } from '../../engine/ast/lint'
import { outputTreeOf } from '../../engine/outputType'
import { STATUS } from '../../engine/evaluability'
import { policyLabel, numericAlertWords } from '../../engine/triggerPolicy'
import { symTickersOf } from '../../engine/otherSymbols'
import { calcTimeframeLabel } from '../../engine/instanceTimeframe'
import { helpersOfDefinition, plotColorRule, plotFillRule } from './colorRules'
import { stampSemantics, semanticsOf, SEMANTICS_UNKNOWN_PROPAGATES } from '../../engine/definitionSemantics'
import { INTENTS, intentReadback, NO_PAINT } from '../authoringIntent'
import { untruncatedLabel } from '../../engine/labelText'

/** Rule A of `definitionSemantics.js`, said as what the member sees, for the
 *  semantics the store's rule gives this save (`stampSemantics` mirrors
 *  `decide_semantics`; the preview draws under the same prediction). */
export const SEMANTICS_LINE = 'Until there is enough history to compute it, a comparison is left blank (unknown) rather than counted as false.'
export const SEMANTICS_LINE_LEGACY = 'Until there is enough history to compute it, a comparison counts as false (this indicator keeps its original rule).'

const POSITION_WORDS = Object.freeze({ aboveBar: 'above the bar', belowBar: 'below the bar', inBar: 'on the bar' })
const SHAPE_WORDS = Object.freeze({ circle: 'circle', square: 'square', arrowUp: 'up-arrow', arrowDown: 'down-arrow' })
const STYLE_WORDS = Object.freeze({ line: 'line', stepline: 'step line', histogram: 'histogram', area: 'area', baseline: 'baseline', columns: 'columns' })

/** EXACT hex → the palette name a member would use. A hex not listed is shown as
 *  the hex: a guessed name ("goldish") is a claim nobody can check. */
const COLOUR_NAMES = Object.freeze({
  '#FFD700': 'gold', '#C9A84C': 'UCT gold', '#FFFFFF': 'white', '#000000': 'black',
  '#FF0000': 'red', '#F23645': 'red', '#EF5350': 'red', '#FF5252': 'red',
  '#00FF00': 'bright green', '#089981': 'green', '#4CAF50': 'green', '#22AB94': 'green', '#26A69A': 'teal',
  '#0000FF': 'blue', '#2962FF': 'blue', '#2196F3': 'blue',
  '#FFA500': 'orange', '#FF9800': 'orange', '#FFFF00': 'yellow', '#FFEB3B': 'yellow',
  '#800080': 'purple', '#9C27B0': 'purple', '#808080': 'grey', '#787B86': 'grey',
  '#00FFFF': 'cyan', '#00BCD4': 'cyan', '#FFC0CB': 'pink', '#E91E63': 'pink',
  // ⭐ ROLLOUT — EXACT standard names for colours the model picks (P3R: "#D4AF37" for
  // "gold" is CSS/print metallic gold). Exact matches only: an unlisted colour stays
  // its hex, never a nearest guess.
  '#D4AF37': 'gold', '#DAA520': 'goldenrod', '#FFC107': 'amber', '#C0C0C0': 'silver',
  '#8B0000': 'dark red', '#006400': 'dark green', '#008000': 'green', '#00C853': 'green',
  '#FF1744': 'red', '#D50000': 'red', '#FF00FF': 'magenta', '#AA00FF': 'purple',
  '#FF6D00': 'orange', '#ADD8E6': 'light blue', '#90EE90': 'light green', '#A9A9A9': 'dark grey',
})

/** A colour value → its palette name, else the value exactly as stored. */
export function colourWords(v) {
  if (typeof v !== 'string') return String(v)
  let hex = v.trim().toUpperCase()
  if (/^#[0-9A-F]{8}$/.test(hex) && hex.endsWith('FF')) hex = hex.slice(0, 7)
  return COLOUR_NAMES[hex] || v
}

/** A function name is capitalised exactly when the manifest's own read-back
 *  phrase spells it that way ("the {1}-bar RSI of {0}") — derived from the
 *  table, never a hand list of indicators. */
function fnWord(w) {
  const fns = (TABLE && TABLE.functions) || {}
  const spec = Object.prototype.hasOwnProperty.call(fns, w) ? fns[w] : null
  const up = w.toUpperCase()
  return spec && typeof spec.sentence === 'string' && spec.sentence.split(/[^A-Za-z]+/).includes(up) ? up : w
}
const CONSTANT_WORDS = Object.freeze({ '*': 'multiplier', '/': 'divisor', '+': 'offset', '-': 'offset' })

/** An engine slot label (`rsi period`, `threshold of >`, `constant in *`) in a
 *  member's words. A re-spelling only: the slot itself is untouched. */
export function slotWords(label) {
  let s = String(label == null ? '' : label)
  let tail = ''
  if (s.endsWith(' (negated)')) { tail = ' (negated)'; s = s.slice(0, -tail.length) }
  if (s.startsWith('threshold of ')) s = 'threshold'
  else if (s.startsWith('constant in ')) s = CONSTANT_WORDS[s.slice('constant in '.length)] || 'number'
  else s = s.replace(/^([a-z]+)(?= )/, fnWord)
  return s + tail
}

/** A plot's `$input` reference → that input's default (the colour the member chose). */
function resolveRef(def, v) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v
  const spec = (def.inputs || []).find((s) => s && s.key === v.slice(1))
  return spec ? spec.default : v
}

/** key → the member-facing name of that output: its label, plus the key only
 *  when two outputs share that label. */
export function outputNamer(def) {
  const plots = (def && Array.isArray(def.plots) ? def.plots : []).filter((p) => p && p.style !== 'hlines')
  // ⭐ P3S — in a ONE-output definition the label is the definition's name cut to
  // a 12-character chip ("TC2000" of "TC2000 XAVGC21"); it reads back as the whole
  // name, exactly as the legend shows it. With several outputs the first label
  // names that output, not the definition, so it is shown as stored. Display
  // only: no stored label is touched.
  const shown = (p) => (plots.length === 1 ? untruncatedLabel(def, p.label) : p.label) || p.key
  const counts = new Map()
  for (const p of plots) { const l = shown(p); counts.set(l, (counts.get(l) || 0) + 1) }
  return (key) => {
    const p = plots.find((x) => x.key === key)
    const label = p ? shown(p) : key
    return counts.get(label) > 1 ? `${label} (${key})` : label
  }
}

/** One-line presentation per output, plus the document's paints and placement. */
export function presentationLines(def) {
  const out = []
  const nameOf = outputNamer(def)
  const helpers = helpersOfDefinition(def)
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is described through its
  // owner's line ("coloured green while it rises"), never as an output of its own.
  const plots = (def.plots || []).filter((p) => p && p.style !== 'hlines' && !helpers.has(p.key))
  for (const p of plots) {
    const colour = colourWords(resolveRef(def, p.color))
    const width = resolveRef(def, p.width)
    const label = nameOf(p.key)
    if (p.hidden) { out.push(`${label}: hidden (still calculated)`); continue }
    if (p.style === 'markers' && p.marker) {
      const where = POSITION_WORDS[p.marker.position] || p.marker.position || 'on the bar'
      out.push(`${label}: ${colour} ${SHAPE_WORDS[p.marker.shape] || p.marker.shape} ${where} where it is true`
        + (p.marker.text ? `, labelled "${p.marker.text}"` : ''))
    } else {
      const style = STYLE_WORDS[p.style || 'line'] || p.style
      out.push(`${label}: ${colour} ${style}, width ${width}${colorRuleWords(plotColorRule(def, p, helpers), nameOf)}`)
    }
  }
  for (const paint of def.paints || []) {
    if (!paint) continue
    const key = typeof paint.colorMode === 'string' && paint.colorMode.startsWith('column:') ? paint.colorMode.slice(7) : null
    const own = key && paint.colorDown === NO_PAINT && typeof paint.colorUp === 'string'
    if (own && paint.kind === 'barcolor') out.push(`candles painted ${colourWords(paint.colorUp)} where ${nameOf(key)} is true (normal colour otherwise)`)
    else if (own) out.push(`background shaded ${colourWords(paint.colorUp)} where ${nameOf(key)} is true (no shading otherwise)`)
    else out.push(`an imported ${paint.kind === 'barcolor' ? 'candle colouring' : 'background colouring'}${key ? ` reading ${nameOf(key)}` : ''} (kept as imported)`)
  }
  out.push(...vocabularyLines(def))
  out.push(def.placement && def.placement.target === 'price' ? 'drawn on the price chart' : 'drawn in its own pane')
  return out
}

/** ⭐ PHASE 5 — a per-bar colour rule in a trader's words (EXACT: the rule as drawn;
 *  ⚰️ a sign rule used to read "coloured green / red by )"). */
export function colorRuleWords(rule, nameOf) {
  if (!rule) return ''
  const up = rule.up ? colourWords(rule.up) : ''
  const down = rule.down ? colourWords(rule.down) : ''
  if (rule.rule === 'sign') return ` (coloured ${up} at or above zero, ${down} below)`
  if (rule.rule === 'rising') return ` (coloured ${up} while it rises, ${down} otherwise)`
  if (rule.rule === 'condition') return ` (coloured ${up} where ${nameOf(rule.when)} is true, ${down} otherwise)`
  return ' (its colour follows an imported rule)'
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
  // ⭐ ROLLOUT — the SAME member-facing name every other readback line uses (a
  // one-output definition's 12-character chip label read "TC2000: drawn dashed").
  const labelOf = outputNamer(def)
  const helpers = helpersOfDefinition(def)
  for (const p of plots) {
    if (!p || p.style === 'hlines' || helpers.has(p.key)) continue
    const label = labelOf(p.key)
    if (!p.hidden && LINE_STYLE_WORDS[p.lineStyle] && LINE_DRAWN.includes(p.style || 'line')) {
      out.push(`${label}: drawn ${LINE_STYLE_WORDS[p.lineStyle]}`)
    }
    if (p.fill && typeof p.fill.with === 'string') {
      const colour = typeof p.fillColor === 'string' ? `, colour ${colourWords(p.fillColor)}` : ''
      const opacity = Number.isFinite(p.fillOpacity) ? `, ${Math.round(p.fillOpacity * 100)}% opaque` : ''
      const fr = plotFillRule(def, p, helpers) || {}
      // ⭐ PHASE 5 — a conditional cloud, said as the two colours and where each shows.
      const how = fr.colorAbove && fr.when
        ? ` ${colourWords(fr.colorAbove)} where ${labelOf(fr.when)} is true, ${colourWords(fr.colorBelow)} where false`
        : fr.colorAbove
          ? ` ${colourWords(fr.colorAbove)} where ${label} is above ${labelOf(p.fill.with)}, ${colourWords(fr.colorBelow)} where below`
          : fr.imported ? ' (its colour follows an imported rule)' : (colour || opacity ? '' : ' in its own colour')
      out.push(`area between ${label} and ${labelOf(p.fill.with)} shaded${how}${fr.colorAbove ? '' : colour}${opacity}`)
    }
  }
  const guide = plots.find((p) => p && p.style === 'hlines' && Array.isArray(p.levels) && p.levels.length)
  if (guide) {
    out.push(`horizontal ${guide.levels.length === 1 ? 'line' : 'lines'} at ${guide.levels.join(', ')}`)
  }
  return out
}

const RELATION_WORDS = Object.freeze({
  '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below', '==': 'equals', '!=': 'does not equal',
})
const isLogical = (n) => !!n && n.type === 'op' && (n.name === '&&' || n.name === '||')
const isTruthOp = (n) => !!n && n.type === 'op' && (!!RELATION_WORDS[n.name] || isLogical(n) || n.name === '!')

/**
 * A yes/no tree built ONLY from comparisons of numbers joined by and / or / not,
 * said as the condition it is ("the 14-bar RSI of close is above 70 and …");
 * null for anything else, which then keeps `sentence.js`'s exact sentence. The
 * operands are `sentence.js`'s own phrases — this adds relation and join words.
 *
 * EXACT: a comparison is 1 or 0 (or, under semantics 2, unknown — never 1), and
 * over such values `&&` / `||` / `!` are 1 exactly when the plain logic words are
 * true. So "true when P" is the bar set the engine marks 1. What an UNKNOWN bar
 * shows is the semantics line's job, not this sentence's.
 */
export function conditionWords(node, scope) {
  if (!node || node.type !== 'op' || !Array.isArray(node.args)) return null
  if (RELATION_WORDS[node.name] && node.args.length === 2) {
    if (node.args.some(isTruthOp)) return null // a yes/no compared as a number: keep the exact sentence
    return `${sentenceFor(node.args[0], scope)} ${RELATION_WORDS[node.name]} ${sentenceFor(node.args[1], scope)}`
  }
  if (isLogical(node) && node.args.length === 2) {
    const parts = []
    for (const c of node.args) {
      const p = conditionWords(c, scope)
      if (p === null) return null
      parts.push(isLogical(c) && c.name !== node.name ? `(${p})` : p)
    }
    return parts.join(node.name === '&&' ? ' and ' : ' or ')
  }
  if (node.name === '!' && node.args.length === 1) {
    const p = conditionWords(node.args[0], scope)
    return p === null ? null : `not (${p})`
  }
  return null
}

/** Does a tree compare anything? (Where rule A of the semantics shows.) */
function comparesAnything(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'op' && RELATION_WORDS[node.name]) return true
  return Array.isArray(node.args) && node.args.some(comparesAnything)
}

/** The output's own line, after its name: "true when …" for a comparison
 *  condition, else the type in plain words and the exact sentence. */
function phraseOf(o, tree, scope) {
  let cw = null
  try { cw = o.type === 'condition' ? conditionWords(tree, scope) : null } catch { cw = null }
  if (cw) return `true when ${cw}`
  return `${o.words}: ${o.sentence || 'UCT cannot put this formula into words yet'}`
}

/**
 * @param {object|null} def the resulting definition
 * @param {object} [state] the authoring state (intent, requests, assumptions, questions, base)
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
  const nameOf = outputNamer(def)
  const rb = intentReadback(def, intent ? intent.intent : INTENTS.PLOT,
    { ctx: gateCtx, requestedKey: intent ? intent.output : null })
  let compares = false
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is not an output the member
  // reads: it is said through its owner's look ("coloured green while it rises").
  const helperKeys = helpersOfDefinition(def)
  const outputs = rb.outputs.filter((o) => !helperKeys.has(o.key)).map((o) => {
    const tree = outputTreeOf(def, o.key)
    let sentence = null
    let mode = null
    try { sentence = sentenceFor(tree, scope) } catch { sentence = null }
    try { mode = lintRepaint(tree, { inputs: scope }).mode } catch { mode = 'repaints' }
    if (comparesAnything(tree)) compares = true
    const base = { key: o.key, label: o.label, type: o.type, words: o.words, sentence }
    return { ...base, name: nameOf(o.key), phrase: phraseOf(base, tree, scope), lane: o.lane,
      status: o.verdict.status, reason: o.verdict.reason || null, mode,
      ...(o.verdict.pending ? { pending: true } : {}) }
  })
  const outputLines = outputs.map((o) => {
    let line = `${o.name} — ${o.phrase}`
    // ⭐ PHASE 5 — a pending refusal (another symbol's bars still loading) is not
    // "cannot be used": the preview draws it once they land.
    if (o.status === STATUS.REFUSED && !o.pending) line += ` — cannot be used this way here: ${o.reason}`
    return line
  })
  const presentation = presentationLines(def)
  const intentLine = intent && intent.intent !== INTENTS.PLOT
    ? `${intent.intent === INTENTS.SIGNAL ? 'Used as a signal' : 'Used as a value'}: ${nameOf(intent.output || rb.selectedKey)}`
    : null
  const req = state.requests || {}
  const alerts = (req.alerts || []).map((a) => (typeof a.condition === 'string'
    // ⭐ PHASE 5 — a numeric alert, and what an unknown bar does.
    ? `Alert when ${nameOf(a.plotKey)} ${numericAlertWords(a.condition, a.threshold)} on a closed bar (a bar with no value never alerts)`
    : `Alert when ${nameOf(a.plotKey)} ${String(policyLabel(a.triggerPolicy) || a.triggerPolicy).toLowerCase()}`))
  // ⭐ PHASE 5 — the whole indicator on a higher timeframe.
  const calcLine = typeof req.calculationTimeframe === 'string'
    ? `Calculated on the ${calcTimeframeLabel(req.calculationTimeframe)} timeframe (the whole indicator), drawn on this chart`
    : null
  // ⭐ PHASE 5 — another symbol, and the alignment rule said as what shows.
  const tickers = symTickersOf(def)
  const symLine = tickers.length
    ? `Reads ${tickers.join(' and ')} bar by bar on the same dates as this chart; a date ${tickers.length > 1 ? 'one of them has' : `${tickers[0]} has`} no bar is left unknown, never filled in`
    : null
  const infoValues = (req.infoValues || []).map((v) => `Chart header shows the latest value of ${nameOf(v.plotKey)}${v.format === 'yesno' ? ' as Yes/No' : ''}`)
  // the output an assumption is about, named only when there is more than one
  const on = (key) => (key && outputs.length > 1 ? ` (on ${nameOf(key)})` : '')
  const assumptions = (state.assumptions || []).map((a) => (a.label !== undefined
    ? `Assumed ${slotWords(a.label)} ${a.value}${on(a.output)}`
    : (a.source === 'engine' ? `Default: ${a.text}${on(a.output)}` : `UCT Intelligence assumed: "${a.text}"`)))
  const questions = (state.questions || []).map((q) => `Question: ${q.text}`)
  const needsAck = outputs.filter((o) => o.mode === 'preview-repaints').map((o) => o.key)
  // ⭐ PHASE 5 — a FORMING-period read repaints for a reason a member can name.
  const formingOf = (key) => readsTfLive(outputTreeOf(def, key))
  const semantics = semanticsOf(stampSemantics(def, { prior: state.base || null }))
  const semanticsLine = compares
    ? (semantics === SEMANTICS_UNKNOWN_PROPAGATES ? SEMANTICS_LINE : SEMANTICS_LINE_LEGACY)
    : null
  // ⭐ PHASE 5 — what a per-bar colour rule / conditional cloud draws on an UNKNOWN bar
  // (`binder.unknownColourRule`: semantics 2 = no rule colour; legacy = the else colour).
  const hasRule = (def.plots || []).some((p) => p && ((typeof p.colorMode === 'string' && p.colorMode !== 'fixed'
    && p.colorMode !== 'sign' && p.colorUp) || (p.fill && p.fill.colorMode && p.fill.colorUp)))
  const ruleUnknownLine = hasRule
    ? (semantics === SEMANTICS_UNKNOWN_PROPAGATES
      ? 'Where a colour rule has no answer yet, the line keeps its own colour and a cloud is left unshaded.'
      : 'Where a colour rule has no answer yet, it takes its second colour (this indicator keeps its original rule).')
    : null
  const lines = [
    `Name: ${(def.meta && def.meta.name) || ''}`,
    ...outputLines,
    ...presentation.map((l) => `Look: ${l}`),
    ...(symLine ? [symLine] : []),
    ...(calcLine ? [calcLine] : []),
    ...(intentLine ? [intentLine] : []),
    ...alerts,
    ...infoValues,
    ...assumptions,
    ...needsAck.map((k) => (formingOf(k)
      ? `${nameOf(k)} reads the period still forming (so far this week or month), so it changes until that period closes — it repaints; confirm below before saving`
      : `${nameOf(k)} reads a bar ahead, so it can change until that bar closes — confirm below before saving`)),
    ...(semanticsLine ? [semanticsLine] : []),
    ...(ruleUnknownLine ? [ruleUnknownLine] : []),
    ...questions,
  ]
  return Object.freeze({ lines, name: (def.meta && def.meta.name) || '', outputs, presentation, intent: intentLine,
    alerts, infoValues, assumptions, questions, needsAck, status: rb.status,
    ...(calcLine ? { calculationTimeframe: calcLine } : {}), ...(symLine ? { otherSymbols: symLine } : {}) })
}

/** Does a tree read a FORMING higher-timeframe period (`tf_live`)? */
function readsTfLive(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'tf_live') return true
  return Array.isArray(node.args) && node.args.some(readsTfLive)
}
