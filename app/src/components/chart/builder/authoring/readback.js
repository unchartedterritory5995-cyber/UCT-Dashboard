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

// ⭐ BATCH 2 — the shipped sentence writer, with exact-identity functions said by name.
import { describeTree as sentenceFor, conditionWords, RELATION_WORDS } from './expansionWords'

export { conditionWords }
import { TABLE } from '../../engine/ast/parse'
import { declaredInputs, lintRepaint } from '../../engine/ast/lint'
import { outputTreeOf } from '../../engine/outputType'
import { collapseExpansions } from '../../engine/ast/callExpansions'
import { libraryOutputOf, libraryParts, namedByTitle, settingsWords } from './checkedLibrary'
import { STATUS } from '../../engine/evaluability'
import { policyLabel, numericAlertWords } from '../../engine/triggerPolicy'
import { symTickersOf } from '../../engine/otherSymbols'
import { calcTimeframeLabel } from '../../engine/instanceTimeframe'
import { helpersOfDefinition, plotColorRule, plotFillRule, paintStatesOf } from './colorRules'
import { tableSpecOfDefinition, tableLines } from './tables'
import { stampSemantics, semanticsOf, SEMANTICS_UNKNOWN_PROPAGATES } from '../../engine/definitionSemantics'
import { INTENTS, intentReadback, NO_PAINT } from '../authoringIntent'
import { untruncatedLabel } from '../../engine/labelText'
import { repaintWarningItems } from './repaintWarning'
import COLOUR_WORDS from './colourWords.json'

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
// The names live in `colourWords.json`, the ONE authority this read-back shares with the
// assistant's instructions: the value it is told to write for "green" is a value this map
// reads back as "green". Measured 2026-11-14: with no shared map a requested green came back
// teal (#26A69A), and this read-back said so honestly.
const COLOUR_NAMES = Object.freeze({ ...COLOUR_WORDS.names })

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
  // ⭐ 2026-10-29 — AND WITH SEVERAL OUTPUTS, plot 1's stored label is still that chip cut
  // of the definition's name, whose FIRST PART names plot 1 ("RSI 14 above 70 · RSI 14"
  // cuts to "RSI 14", which is the second output's label too). So plot 1 reads back as the
  // name's first part — the whole name up to its " · " separator — again display only.
  const firstPart = () => String((def && def.meta && def.meta.name) || '').split(' · ')[0].trim()
  const shown = (p, i) => (plots.length === 1 ? untruncatedLabel(def, p.label)
    : (i === 0 && untruncatedLabel(def, p.label) !== p.label && firstPart()) || p.label) || p.key
  const counts = new Map()
  plots.forEach((p, i) => { const l = shown(p, i); counts.set(l, (counts.get(l) || 0) + 1) })
  return (key) => {
    const i = plots.findIndex((x) => x.key === key)
    const label = i >= 0 ? shown(plots[i], i) : key
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
        + (p.marker.text ? `, labelled "${p.marker.text}"` : '')
        // ⭐ BATCH 2 — a size other than the chart's normal one is said
        + (Number.isFinite(p.marker.size) && p.marker.size !== 1 ? `, size ${p.marker.size}` : ''))
    } else {
      const style = STYLE_WORDS[p.style || 'line'] || p.style
      out.push(`${label}: ${colour} ${style}, width ${width}${colorRuleWords(plotColorRule(def, p, helpers), nameOf)}`)
    }
  }
  // ⭐ BATCH 2 — candles / background coloured by state (`colorStates.js`)
  const stateKeys = new Set()
  for (const ps of paintStatesOf(def, helpers)) {
    stateKeys.add(ps.channel)
    out.push(`${ps.channel === 'barcolor' ? 'candles painted' : 'background shaded'} by state: ${statesWords(ps)}`)
  }
  for (const paint of def.paints || []) {
    if (!paint) continue
    if (stateKeys.has(paint.kind) && Array.isArray(paint.colorPalette)) continue
    const key = typeof paint.colorMode === 'string' && paint.colorMode.startsWith('column:') ? paint.colorMode.slice(7) : null
    const own = key && paint.colorDown === NO_PAINT && typeof paint.colorUp === 'string'
    if (own && paint.kind === 'barcolor') out.push(`candles painted ${colourWords(paint.colorUp)} where ${nameOf(key)} is true (normal colour otherwise)`)
    else if (own) out.push(`background shaded ${colourWords(paint.colorUp)} where ${nameOf(key)} is true (no shading otherwise)`)
    else out.push(`an imported ${paint.kind === 'barcolor' ? 'candle colouring' : 'background colouring'}${key ? ` reading ${nameOf(key)}` : ''} (kept as imported)`)
  }
  out.push(...vocabularyLines(def))
  // ⭐ OVERNIGHT D — the chart table, cell by cell
  out.push(...tableLines(tableSpecOfDefinition(def), nameOf))
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
  if (rule.rule === 'states') return ` (coloured by state: ${statesWords(rule)})`
  return ' (its colour follows an imported rule)'
}

/** ⭐ BATCH 2 — "#00e676 when above zero and rising, …; #9e9e9e otherwise". */
export function statesWords(read) {
  const parts = read.states.map((st) => `${colourWords(st.color)} when ${st.words || 'its condition holds'}`)
  return parts.join(', ') + (read.otherwise ? `; ${colourWords(read.otherwise)} otherwise`
    : '; its normal colour otherwise')
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
    // ⭐ ROW 42 — the authored "break where it has no value" (`plots[].sparse`) is
    // said, because it changes the picture: a line held for N bars after an event
    // draws as separate pieces, never one level run across the chart.
    if (!p.hidden && p.sparse === true && LINE_DRAWN.includes(p.style || 'line')) {
      out.push(`${label}: breaks where it has no value`)
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

// ⭐ BATCH 2 — moved to `expansionWords.js` (the colour-state read-back needs the same
// words and `colorRules.js` cannot import this module); ONE copy, re-exported here.
/** Does a tree compare anything? (Where rule A of the semantics shows.) */
function comparesAnything(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'op' && RELATION_WORDS[node.name]) return true
  return Array.isArray(node.args) && node.args.some(comparesAnything)
}

/** The output's own line, after its name: "true when …" for a comparison
 *  condition, else the type in plain words and the exact sentence. */
// ⭐ 2026-11-18 — A CHECKED LIBRARY INDICATOR SAYS WHAT IT IS, not its formula in words. Read in the
// live window, KAMA said: "the running value that starts at close and becomes (the running value so
// far plus ((((((the absolute value of ...". An output that IS a library output (`checkedLibrary.js`)
// says the entry's own phrase and its settings; the formula in words stays on the output
// (`formulaWords`) for the window to show on request, and the Formula tab holds the formula itself.
const sameName = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
function libraryPhrase(part, name) {
  const inBrackets = [sameName(name, part.entry.name) ? null : part.entry.name, settingsWords(part) || null].filter(Boolean).join(', ')
  return `${part.output.says}${inBrackets ? ` (${inBrackets})` : ''}`
}

/** Said when a title still names a library indicator whose formula the definition no longer holds. */
export const noLongerChecked = (name) => `No longer UCT's checked formula for ${name}: the formula was edited.`

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
      intent: null, alerts: [], infoValues: [], assumptions: [], questions, needsAck: [], ack: [], status: 'refused' })
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
    let forward = null
    try { sentence = sentenceFor(tree, scope) } catch { sentence = null }
    // ⭐ S6 — the reach is kept with the mode: the repaint warning names its window (`repaintWarning.js`).
    try { const lint = lintRepaint(tree, { inputs: scope }); mode = lint.mode; forward = lint.forward } catch { mode = 'repaints' }
    if (comparesAnything(tree)) compares = true
    const base = { key: o.key, label: o.label, type: o.type, words: o.words, sentence }
    const name = nameOf(o.key)
    let part = null
    try { part = libraryOutputOf(collapseExpansions(tree), Object.keys(scope)) } catch { part = null }
    const words = phraseOf(base, tree, scope)
    return { ...base, name, phrase: part ? libraryPhrase(part, name) : words, lane: o.lane,
      status: o.verdict.status, reason: o.verdict.reason || null, mode, forward,
      ...(part ? { library: { id: part.entry.id, name: part.entry.name, version: part.entry.version }, formulaWords: words } : {}),
      ...(o.verdict.pending ? { pending: true } : {}) }
  })
  // a title that still names a library indicator none of whose formulas is here any more
  const claimed = namedByTitle(def.meta && def.meta.name)
  const editedAway = claimed && !outputs.some((o) => o.library && o.library.id === claimed.id)
    && !rb.outputs.some((o) => {
      try { return libraryParts(collapseExpansions(outputTreeOf(def, o.key)), Object.keys(scope)).some((p) => p.entry.id === claimed.id) } catch { return false }
    })
  const editedLine = editedAway ? noLongerChecked(claimed.name) : null
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
    // ⭐ OVERNIGHT C — WHAT A CHART BAR SHOWS (`mtfProjection.js`, COMPLETED semantics):
    // the last higher-timeframe period that had CLOSED before the bar's own period began.
    // Said, because "inside day" on a 5-minute chart then reads YESTERDAY's answer.
    ? `Calculated on the ${calcTimeframeLabel(req.calculationTimeframe)} timeframe (the whole indicator), drawn on this chart — each chart bar shows the last COMPLETED ${calcTimeframeLabel(req.calculationTimeframe)} value, never the one still forming`
    : null
  // ⭐ OVERNIGHT E — the member's own settings: what each is now, and where it is set.
  // A default of 0 is the honest "not set yet" (UCT never assumes an account size).
  // ⛔ NOT the plot STYLE inputs (a colour / width a plot names as `$key` — the
  // Builder's chrome): those are presentation, not the member's own figures.
  const chromeKeys = new Set((def.plots || []).flatMap((p) => [p && p.color, p && p.width])
    .filter((v) => typeof v === 'string' && v.startsWith('$')).map((v) => v.slice(1)))
  const settingLines = (def.inputs || []).filter((x) => x && !chromeKeys.has(x.key)
    && !['color', 'lineWidth'].includes(x.key) && (x.type === 'float' || x.type === 'int'))
    .map((x) => `Setting "${x.label || x.key}" = ${x.default}${x.default === 0 ? ' (not set yet)' : ''} — change it in the indicator's settings`)
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
    // ⭐ 2026-11-18: a note the DOOR wrote is a statement (what was built, what was used), printed
    // as it stands. It read: The UCT Agent assumed: "Built to UCT's checked formula ...".
    : (a.source === 'engine' ? `Default: ${a.text}${on(a.output)}`
      : (a.source === 'uct' ? a.text : `The UCT Agent assumed: "${a.text}"`))))
  const questions = (state.questions || []).map((q) => `Question: ${q.text}`)
  const needsAck = outputs.filter((o) => o.mode === 'preview-repaints').map((o) => o.key)
  // ⭐ PHASE 5 — a FORMING-period read repaints for a reason a member can name.
  const formingOf = (key) => readsTfLive(outputTreeOf(def, key))
  // ⭐ S6 — ONE warning per output, from the measured window (`repaintWarning.js`); every
  // surface that asks for the acknowledgement reads these same items.
  const ack = repaintWarningItems(outputs, needsAck, formingOf)
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
    ...(editedLine ? [editedLine] : []),
    ...outputLines,
    ...presentation.map((l) => `Look: ${l}`),
    ...(symLine ? [symLine] : []),
    ...(calcLine ? [calcLine] : []),
    ...settingLines,
    ...(intentLine ? [intentLine] : []),
    ...alerts,
    ...infoValues,
    ...assumptions,
    ...ack.map((a) => a.sentence),
    ...(semanticsLine ? [semanticsLine] : []),
    ...(ruleUnknownLine ? [ruleUnknownLine] : []),
    ...questions,
  ]
  return Object.freeze({ lines, name: (def.meta && def.meta.name) || '', outputs, presentation, intent: intentLine,
    alerts, infoValues, assumptions, questions, needsAck, ack, status: rb.status,
    ...(calcLine ? { calculationTimeframe: calcLine } : {}), ...(symLine ? { otherSymbols: symLine } : {}) })
}

/** Does a tree read a FORMING higher-timeframe period (`tf_live`)? */
function readsTfLive(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'tf_live') return true
  return Array.isArray(node.args) && node.args.some(readsTfLive)
}
