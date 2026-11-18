// ── INDICATOR VALUE IN THE HEADER (Charts execution family, C1-100 / C2-041) ────────────────────────────────────────
//
// An indicator line's latest value shown in (or taken out of) the chart's header, exactly as the legend chip's
// "Value in header" row does (legend/chipMenu.js → StockChart handleChipInfoValue / handleInfoValueRemove). Marker: the
// action id 'headerValue.set'.
//
// ⛔ ONE WRITER, THE PRODUCT'S: `engine/infoValues.js` — `addInfoValue` / `removeInfoValue` with the definition lookup and
// `infoValueResolve.infoValueOutputExists`, the same arguments the chip passes. What is stored is a REFERENCE
// `{instanceId, plotKey, format:'auto'}` under `cs.header.infoValues` and nothing else: no formula, no label, no type, and the
// indicator itself (its instance, inputs, style) is never touched. The writer's own refusals (not on the chart, not a value
// line — a guide like RSI's 70 / 30 bands — or the 12-value cap) are said, never worked around.
//
// Which indicator: the indicator kind's own resolver (indicatorEdits.targetOf — an id, a legend name, "#20:ema", the only one
// of that kind); two that match ask, by their legend names. Which line: the only value line the definition declares, or the
// one named (its key or legend label); an indicator with several lines (MACD, VWAP bands) ASKS with the real choices — never a
// guess. Taking a value out names the indicator, or "every value" (also clears a broken one whose indicator was deleted).
//
// State is the chart's settings (the chart kind): ONE onOptsChange through the ChartWidget adapter, read back exactly
// (chartKind.landed), field-scoped exact Undo of `header`. Targeting is the chart kind's (the clicked chart, a named one,
// every chart, exceptions); a plan where one chart lacks the indicator is refused whole, so nothing is half-done.

import { registerCapability } from '../capabilities'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { addInfoValue, removeInfoValue, infoValuesOf, infoValueAddRefusal, hasInfoValue, liveInstanceOf, MAX_INFO_VALUES } from '../../components/chart/engine/infoValues'
import { infoValueOutputExists } from '../../components/chart/engine/infoValueResolve'
import { REASONS } from '../../components/chart/builder/agentMutations'
import { targetOf, refusalSentence, indicatorRowsOf, defIdOfWords, settingsOfWords } from './indicatorEdits'

export const HEADER_VALUE_ACTION = 'headerValue.set'
const onCharts = (ctx) => ctx.surface === 'charts'
const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }
const lc = (s) => String(s ?? '').trim().toLowerCase()
const defOf = (id) => { try { return nativeRegistry.getDefinition(id) } catch { return null } }
const chartWord = (st) => (st?.symbol ? `the ${st.symbol} chart` : 'this chart')
const ALL_WORDS = /^(?:all|every|everything|each|both|any|all of them|all lines|every line|all values|every value)$/

/** The value lines an instance's definition declares (the chip menu offers the row only on these). */
export function valueLinesOf(defId) {
  const def = defOf(defId)
  const plots = def && Array.isArray(def.plots) ? def.plots : []
  return plots.filter(p => p && typeof p.key === 'string' && infoValueOutputExists(def, p.key)).map(p => ({ key: p.key, label: String(p.label || p.title || p.key) }))
}
const rowOf = (st, id) => indicatorRowsOf(st.cs).find(r => r.instanceId === id) || null
const nameOf = (st, id) => rowOf(st, id)?.name || liveInstanceOf(st.cs, id)?.defId || 'that indicator'
const lineWord = (lines, key) => (lines.length > 1 ? ` ${(lines.find(l => l.key === key) || { label: key }).label}` : '')
const orList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0] || '')

/** "the signal line" / "Signal" / "hist" → the one value line it names, or null. */
function pickLine(lines, output) {
  const w = lc(output).replace(/^(?:the|its|their)\s+/, '').replace(/\s+(?:line|value|reading|plot|output)s?$/, '').trim()
  if (!w) return null
  const exact = lines.filter(l => lc(l.key) === w || lc(l.label) === w)
  if (exact.length === 1) return exact[0]
  const loose = lines.filter(l => lc(l.label).startsWith(w) || lc(l.key).startsWith(w))
  return loose.length === 1 ? loose[0] : null
}

/** Which instance the words mean on this chart: `{id}` or `{why}` (asked / refused in the member's terms). */
function instanceOf(st, instance, show) {
  if (typeof instance !== 'string' || !instance.trim()) return { why: 'Which indicator’s value — for example “show the RSI value in the header”? Nothing was changed.' }
  const t = targetOf({ cs: st.cs, rows: indicatorRowsOf(st.cs) }, instance.trim())
  if (t.ok) return { id: t.instanceId }
  if (t.reason === REASONS.AMBIGUOUS) return { why: `${refusalSentence(t, { chart: chartWord(st) })} Nothing was changed.` }
  const said = String(instance).replace(/^#/, '').replace(/:/, ' ')
  if (show) return { why: `There’s no ${said} on ${chartWord(st)}, so there is no value of it to put in the header. Add it first (for example “add ${said}”). Nothing was changed.` }
  // taking a value out: an indicator that was deleted leaves its header value BROKEN ("unavailable"), never retargeted —
  // it is named, and taken out only when the member says so (infoValues.js: a visible gravestone)
  const broken = infoValuesOf(st.cs).filter(o => o.severed || !liveInstanceOf(st.cs, o.instanceId)).length
  return { why: `There’s no ${said} on ${chartWord(st)}.${broken ? ` The header has ${broken === 1 ? 'one value' : `${broken} values`} whose indicator was removed (shown as unavailable) — say “remove every value from the header” to take ${broken === 1 ? 'it' : 'them'} out.` : ''} Nothing was changed.` }
}

/**
 * The reference(s) the request means, or why there is none. Shared by check, apply and noop so the three never disagree.
 * @returns {{why:string} | {add:{instanceId,plotKey}} | {remove:object[]}}
 */
export function headerValueRequest(st, args = {}) {
  const show = args.show !== false
  if (!st || !st.cs) return { why: 'That chart has no settings to change. Nothing was changed.' }
  const stored = infoValuesOf(st.cs)
  if (!show && args.all === true) return { remove: stored }
  const inst = instanceOf(st, args.instance, show)
  if (inst.why) return { why: inst.why }
  const id = inst.id
  const name = nameOf(st, id)
  const defId = liveInstanceOf(st.cs, id)?.defId
  const lines = valueLinesOf(defId)
  if (!lines.length) return { why: `${name} has no line with a value to show in the header. Nothing was changed.` }
  const wantsAll = ALL_WORDS.test(lc(args.output))
  if (!show) {
    const mine = stored.filter(o => o.instanceId === id)
    if (wantsAll) return { remove: mine }
    if (args.output) {
      const l = pickLine(lines, args.output)
      if (!l) return { why: `${name} has no “${args.output}” line — its lines: ${lines.map(x => x.label).join(', ')}. Nothing was changed.` }
      return { remove: mine.filter(o => o.plotKey === l.key) }
    }
    if (mine.length > 1) {
      return { why: `${name} has ${mine.length} values in the header (${mine.map(o => (lines.find(l => l.key === o.plotKey) || { label: o.plotKey }).label).join(', ')}) — remove which one, or all of them? Nothing was changed.` }
    }
    return { remove: mine }
  }
  if (wantsAll) return { why: `I put one line’s value in the header at a time — which of ${name}’s lines: ${orList(lines.map(l => l.label))}? Nothing was changed.` }
  let line = null
  if (args.output) {
    line = pickLine(lines, args.output)
    if (!line) return { why: `${name} has no “${args.output}” line with a value — which one: ${orList(lines.map(l => l.label))}? Nothing was changed.` }
  } else if (lines.length === 1) line = lines[0]
  else return { why: `${name} draws more than one line — which one’s value should go in the header: ${orList(lines.map(l => l.label))}? Nothing was changed.` }
  const ref = { instanceId: id, plotKey: line.key, format: 'auto' }
  if (hasInfoValue(st.cs, id, line.key)) return { add: ref, already: true, name, lines }
  const why = infoValueAddRefusal(st.cs, ref, defOf, infoValueOutputExists)
  if (why) {
    if (/at most/.test(why)) return { why: `The header holds at most ${MAX_INFO_VALUES} values and ${chartWord(st)} already shows ${MAX_INFO_VALUES} — take one out first. Nothing was changed.` }
    return { why: `I couldn’t put ${name}${lineWord(lines, line.key)} in the header: ${why}. Nothing was changed.` }
  }
  return { add: ref, name, lines }
}

function applyHeaderValue(st, args = {}) {
  const r = headerValueRequest(st, args)
  if (r.why || r.already) return st
  let cs = st.cs
  if (r.add) cs = addInfoValue(cs, r.add, defOf, infoValueOutputExists)
  else for (const ref of r.remove || []) cs = removeInfoValue(cs, { instanceId: ref.instanceId, plotKey: ref.plotKey, severed: !!ref.severed })
  return cs === st.cs ? st : { ...st, cs }
}

const valueName = (st, o) => {
  const inst = liveInstanceOf(st.cs, o.instanceId)
  if (o.severed || !inst) return 'a value whose indicator was removed'
  const lines = valueLinesOf(inst.defId)
  return `${nameOf(st, o.instanceId)}${lineWord(lines, o.plotKey)}`
}
const key = (o) => `${o.instanceId}::${o.plotKey}::${o.severed ? 1 : 0}`

function describeHeaderValue(b, a) {
  const was = infoValuesOf(b.cs), now = infoValuesOf(a.cs)
  const added = now.filter(o => !was.some(w => key(w) === key(o)))
  const gone = was.filter(o => !now.some(n => key(n) === key(o)))
  const parts = []
  if (added.length) parts.push(`Showing ${added.map(o => `${valueName(a, o)}’s latest value`).join(' and ')} in the chart header (the legend’s “Value in header”)`)
  if (gone.length) parts.push(`Took ${gone.length > 2 ? `${gone.length} values` : gone.map(o => `${valueName(b, o)}’s value`).join(' and ')} out of the chart header (the indicator stays on the chart)`)
  return parts.length ? parts.join('; ') : null
}

function noopHeaderValue(st, _a, args = {}) {
  const r = headerValueRequest(st, args)
  if (r.already) return `${r.name}${lineWord(r.lines, r.add.plotKey)}’s value is already in the header of ${chartWord(st)}`
  if (args.show === false && args.all === true) return `There are no indicator values in the header of ${chartWord(st)}`
  if (args.show === false) return `That value isn’t in the header of ${chartWord(st)}`
  return null
}

// ── the member's own obvious words (no model call). They must say HEADER, and the subject must read as an indicator:
// a catalog name ("rsi", "macd", "atr") or a moving average by length ("the 50 sma", "20 ema", "the 21"). The header's
// OTHER rows — the stats beside the ticker (Volume, RVOL, Market Cap…) and the Bar info strip (Open, Close, % Chg…) — are
// chart.setSetting's and never read here. ──
const ON = '(?:show|add|put|pin|display|turn on|enable|stick|place)'
const OFF = '(?:remove|hide|take|drop|turn off|disable|unpin|clear)'
const VAL = "(?:(?:latest|current|last|live) )?(?:value|reading|number|readout)s?"
const HEADER = "(?:the )?(?:chart'?s? )?header(?: (?:bar|row|strip|area))?"
const NOT_INDICATOR = /^(?:volume|vol|dollar volume|rvol|relative volume|price|open|high|low|close|change|% ?change|\$ ?change|market cap|cap|sector|industry|theme|earnings|next earnings|ipo date|company name|name|date|range|adr|ticker|symbol)$/
/** The indicator words → an instance argument targetOf reads, or null when they do not plainly name one. */
export function instanceOfWords(words) {
  const w = lc(words).replace(/^(?:the|my|this|that|an?)\s+/, '').replace(/^(?:latest|current|last|live)\s+/, '').replace(/(?:'s|’s)$/, '').trim()
  if (!w || NOT_INDICATOR.test(w)) return null
  const s = settingsOfWords(w)
  if (s && s.defId === 'movingAverage') {
    const n = s.inputs.find(i => i.key === 'period')?.value
    const t = s.inputs.find(i => i.key === 'maType')?.value
    return Number.isInteger(n) ? (s.assumed ? `#${n}` : `#${n}:${t}`) : null
  }
  if (s && s.defId) return w
  return defIdOfWords(w)
}
function fastHeaderValue(lower) {
  const s = lower.replace(/[.!?]+$/, '').trim()
  if (/[,;&]|\b(?:and|then)\b/.test(s)) return null
  let m = new RegExp(`^${ON} (?:the |my )?(.+?)(?:'s|’s)? ${VAL} (?:in|on|to|into|up in|at the top of) ${HEADER}$`).exec(s)
    || new RegExp(`^${ON} (?:the |my )?(.+?) (?:in|on|to|into) ${HEADER}$`).exec(s)
  if (m) {
    const instance = instanceOfWords(m[1])
    return instance ? { instance, output: null, show: true, all: null } : null
  }
  m = new RegExp(`^${OFF} (?:the |my )?(.+?)(?:'s|’s)? ${VAL} (?:from|off|out of|off of) ${HEADER}$`).exec(s)
    || new RegExp(`^${OFF} (?:the |my )?(.+?) (?:from|off|out of|off of) ${HEADER}$`).exec(s)
  if (m) {
    if (/^(?:all|every|all the|all of the)(?: indicator)?(?: values?)?$/.test(lc(m[1]))) return { instance: null, output: null, show: false, all: true }
    const instance = instanceOfWords(m[1])
    return instance ? { instance, output: null, show: false, all: null } : null
  }
  m = new RegExp(`^${OFF} (?:all|every)(?: of)?(?: the)?(?: indicator)? values? (?:from|off|out of|in) ${HEADER}$`).exec(s)
  if (m) return { instance: null, output: null, show: false, all: true }
  return null
}

let registered = false
export function registerHeaderValueCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...chartCommon,
    name: HEADER_VALUE_ACTION,
    summary: 'Show or remove an indicator line\'s latest value in ONE chart\'s header (the legend chip\'s "Value in header"). Only a reference to an indicator already on that chart is stored; the indicator itself is never changed. Undo restores it exactly.',
    hints: 'target = the chart. instance = the indicator on that chart (its legend name, its id, its kind like "rsi", or "#50:sma" for a moving average by length). output = the line\'s key or label when it draws several (MACD: macd / signal / histogram), else null; "all" with show false removes all of that indicator\'s values. show true = put it in the header, false = take it out. all = true with show false and no instance clears every indicator value in the header (else null). Header stats beside the ticker and Bar info (Volume, RVOL, Open, Close…) are chart.setSetting, never this.',
    args: { type: 'object', properties: {
      instance: { type: ['string', 'null'] },
      output: { type: ['string', 'null'] },
      show: { type: 'boolean' },
      all: { type: ['boolean', 'null'] },
    }, required: ['instance', 'output', 'show', 'all'], additionalProperties: false },
    fast: ({ lower }) => fastHeaderValue(lower),
    fastWhole: true,
    check: (st, args) => headerValueRequest(st, args).why || null,
    apply: applyHeaderValue,
    describe: describeHeaderValue,
    noop: noopHeaderValue,
  })
}
