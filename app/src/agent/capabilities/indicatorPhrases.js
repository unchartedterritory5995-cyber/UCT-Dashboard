// ── INDICATORS (C2 family): the GENERAL readers of a member's indicator wording — no model call ─────────────
//
// The instant path for the Indicators family, written as phrase CLASSES rather than sentences. Each reader takes the
// canonical clause (`fastPath.canon`) and returns ONE capability's args, or null (→ the model, exactly as before).
// Every reader is built from the same parts:
//
//   SUBJECT   the indicator, resolved from the catalog the member sees (`addableRows`): its id or name ("rsi",
//             "relative strength index"), the name typed without spaces ("rs line", "stoch rsi", "super trend"), or a
//             moving average by its length ("the 20", "the 20 ema", "50-day sma" → "#20" / "#20:ema"). Never a guess:
//             words that name no catalog indicator, or name two, are not read here.
//   SETTING   one declared input of that indicator, matched by its OWN label or key ("fast", "%K period", "std dev",
//             "cross markers") — `inputsOfDef`, never a key invented here.
//   VALUE     a colour (`colorValueOf`), a width, a line / plot style, a place, a pane position, a size, or a setting's
//             value converted by the input's declared type (int / float / enum option / on-off).
//
// ⛔ READ ONLY. Nothing here plans, writes or decides whether a value is allowed: the args go through the same
// capability check → Indicators' `agentMutations` plan → apply → persist → confirm → exact Undo as a model plan.
// ⛔ ONE READING. A reader returns null whenever the words could mean something else (a chart colour, a chart
// timeframe, a saved definition), so the fast path's "exactly one capability" rule still holds.

import { addableRows, defIdOfWords, inputsOfDef, targetOf, indicatorEditsKind } from './indicatorEdits'
import { normalizeColor } from './chart'

const lc = (s) => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, '\'')
const squash = (s) => lc(s).replace(/[\s\-_/.'()]+/g, '')
const ART = /^(?:the|my|that|this|your|our)\s+/
const MA_TYPES = new Set(['ema', 'sma', 'wma', 'hma', 'vwma', 'smma', 'dema', 'tema', 'lsma'])

// ── SUBJECT ──
/** The catalog indicator the words name exactly, ignoring spaces / hyphens ("rs line" → rsLine), when exactly one. */
export function squashedDefId(words) {
  const w = squash(words)
  if (w.length < 3) return null
  let rows = []
  try { rows = addableRows() } catch { rows = [] }
  const hits = rows.filter(r => squash(r.defId) === w || squash(r.name) === w)
  return hits.length === 1 ? hits[0].defId : null
}
/**
 * The indicator a phrase names → the `instance` word the capabilities resolve on each chart (`targetOf`):
 * "#20" / "#20:ema" for a moving average by length, else the catalog defId (exactly one of that kind on a chart, or
 * that chart's own "which one?"). null when the words name no catalog indicator.
 */
export function subjectOf(words) {
  const full = lc(words).replace(ART, '').replace(/'s$/, '').trim()
  if (!full) return null
  // the whole words first ("the rs line" IS an indicator's name), then without a trailing "line" / "indicator"
  const named = defIdOfWords(full) || squashedDefId(full)
  // "the moving average" names a KIND that a chart usually carries several of (EMA 9 / 20, SMA 50 / 200): never one of them here
  if (named === 'movingAverage') return null
  if (named) return named
  const s = full.replace(/\s+(?:line|lines|indicator|study|plot|overlay)$/, '').trim()
  if (!s) return null
  // "the 200 line" is as often a LINE DRAWN at 200 (a price level) as the 200 average: not read as an indicator here
  if (/^\d{1,6}(?:\.\d+)?\s+lines?$/.test(full)) return null
  const n = /^(\d{1,4})(?:[- ]?(?:day|period|bar|length))?(?:[- ]?(ema|sma|wma|hma|vwma|ma|moving average))?$/.exec(s)
  if (n) return n[2] && MA_TYPES.has(n[2]) ? `#${n[1]}:${n[2]}` : `#${n[1]}`
  const t = /^(ema|sma|wma|hma|vwma)[- ]?(\d{1,4})$/.exec(s)
  if (t) return `#${t[2]}:${t[1]}`
  const d = defIdOfWords(s) || squashedDefId(s)
  return d === 'movingAverage' ? null : d
}
/** "macd signal" → { subject: 'macd', rest: 'signal' }: the LONGEST leading run of words that names an indicator. */
function subjectThenRest(words) {
  const parts = lc(words).replace(ART, '').split(/\s+/).filter(Boolean)
  if (/^\d{1,6}(?:\.\d+)?\s+lines?$/.test(parts.join(' '))) return null          // "the 200 line": a price level (subjectOf)
  for (let k = parts.length; k >= 1; k--) {
    const head = parts.slice(0, k).join(' ').replace(/'s$/, '')
    const subject = subjectOf(head)
    if (subject) return { subject, rest: parts.slice(k).join(' ').replace(ART, '').trim() }
  }
  return null
}

// ── colour ──
// A colour WORD only: a name the Agent knows ("green", "dark blue") or a #hex. A bare number is never a colour here
// ("change the 20 to 200" is a length, though "200" is also three hex digits).
function colorValueOf(v) {
  const w = lc(v)
  if (w.startsWith('#')) return normalizeColor(w)
  return /^[0-9a-f]+$/.test(w) ? null : normalizeColor(w)
}
const COLOR_VERB = '(?:make|turn|colou?r|paint|set|change|switch|recolou?r)'
const UP_WORDS = /^(?:up|rising|positive|growing|bullish|green|increasing|above zero)$/
const DOWN_WORDS = /^(?:down|falling|negative|declining|bearish|red|decreasing|below zero)$/
/** The colour at the END of the words ("… to dark blue", "… #ff8800") → { value, before } or null. */
function trailingColor(words) {
  const parts = lc(words).split(/\s+/)
  for (const k of [2, 1]) {
    if (parts.length <= k) continue
    const v = parts.slice(-k).join(' ')
    if (colorValueOf(v)) return { value: v, before: parts.slice(0, -k).join(' ').replace(/\s+(?:to|into|in)$/, '') }
  }
  return null
}
/** "change the 9 ema colour to green", "set the macd signal line to red", "make the macd up bars green". */
export function colorOfWords(lower) {
  const s = lc(lower)
  // "make the macd histogram green when it's rising" / "… bars red when falling"
  let m = new RegExp(`^${COLOR_VERB} (.+?) (?:histogram bars|histogram columns|histogram|hist|bars|columns) (.+?) when (?:it'?s |it is |they'?re |they are )?(rising|falling|up|down|positive|negative|growing|declining|increasing|decreasing)$`).exec(s)
  if (m) {
    const subject = subjectOf(m[1])
    const c = colorValueOf(m[2]) ? m[2] : null
    if (!subject || !c) return null
    return { instance: subject, property: UP_WORDS.test(m[3]) ? 'upColor' : 'downColor', value: c, output: null }
  }
  // "change the colour of the 20 ema to red"
  m = /^(?:make|set|change|switch|turn) (?:the )?colou?r of (.+)$/.exec(s)
  let body = m ? m[1] : null
  if (!body) {
    m = new RegExp(`^${COLOR_VERB} (.+)$`).exec(s)
    body = m ? m[1] : null
  }
  if (!body) return null
  const col = trailingColor(body)
  if (!col) return null
  const words = col.before.replace(/\s+(?:colou?r|colou?rs)$/, '').replace(/'s$/, '')
  const st = subjectThenRest(words)
  if (!st) return null
  let rest = st.rest.replace(/^'s\s*/, '').replace(/\s+(?:line|lines|plot)$/, '').replace(/^(?:line|lines|plot)$/, '').trim()
  // "macd histogram up bars", "macd up colour", "macd rising bars": a histogram's up / down colour
  const sign = /^(?:(?:histogram|hist)\s+)?(\S+(?: zero)?)(?:\s+(?:bars?|columns?|histogram|side))?$/.exec(rest)
  if (sign && (UP_WORDS.test(sign[1]) || DOWN_WORDS.test(sign[1])) && rest !== '') {
    return { instance: st.subject, property: UP_WORDS.test(sign[1]) ? 'upColor' : 'downColor', value: col.value, output: null }
  }
  rest = rest.replace(/^(?:histogram|hist)$/, 'histogram')
  return { instance: st.subject, property: 'color', value: col.value, output: rest || null }
}

// ── line width, line style, plot style ──
const WIDTH_REL = { thicker: 'thicker', bolder: 'thicker', bold: 'thicker', thick: 'thicker', heavier: 'thicker', wider: 'thicker', thinner: 'thinner', thin: 'thinner', lighter: 'thinner', narrower: 'thinner', finer: 'thinner' }
const PLOT_STYLES = '(histogram|line|area|columns?|step ?line|steps|bars|dots|circles|crosses|cross)'
export function lookOfWords(lower) {
  const s = lc(lower)
  // "set the 20 ema line width to 3", "change the rsi thickness to 2"
  let m = /^(?:make|set|change|switch|bump|put) (.+?)(?:'s)?(?: line)? (?:width|thickness|weight)(?: to| at)? (\d{1,2})(?: ?(?:px|pixels?))?$/.exec(s)
  if (m) { const subject = subjectOf(m[1]); return subject ? { instance: subject, property: 'lineWidth', value: Number(m[2]), output: null } : null }
  // "make the 20 ema 3px", "set the rsi to 2 pixels wide"
  m = /^(?:make|set) (.+?) (?:to )?(\d{1,2}) ?(?:px|pixels?)(?: (?:wide|thick))?$/.exec(s)
  if (m) { const subject = subjectOf(m[1]); return subject ? { instance: subject, property: 'lineWidth', value: Number(m[2]), output: null } : null }
  // "make the 50 bolder", "make the rsi line thin", "make the 9 ema a bit thicker"
  m = /^make (.+?)(?: line)? (?:a (?:bit|little|lot|touch) |slightly |much )?(thicker|thinner|bolder|bold|thick|thin|heavier|lighter|wider|narrower|finer)$/.exec(s)
  if (m) { const subject = subjectOf(m[1]); return subject ? { instance: subject, property: 'lineWidth', value: WIDTH_REL[m[2]], output: null } : null }
  // "change the 20 ema line style to dashed", "switch the rsi to a dotted line", "make the 50 solid again"
  m = /^(?:make|set|change|switch|turn) (.+?)(?:'s)?(?: line)?(?: style)? (?:to |into |back to )?(?:an? )?(dashed|dotted|solid|dash|dots)(?: line)?(?: again)?$/.exec(s)
  if (m) {
    const subject = subjectOf(m[1])
    const v = m[2] === 'dash' ? 'dashed' : m[2] === 'dots' ? 'dotted' : m[2]
    if (subject) return { instance: subject, property: 'lineStyle', value: v, output: null }
  }
  // "draw the 20 ema as columns", "change the macd plot style to a line", "switch the rsi to an area"
  m = new RegExp(`^(?:show|display|make|set|change|switch|turn) (.+?)(?:'s)?(?: plot style| plot type| style| plot)? (?:as|to|into)? ?(?:an? )?${PLOT_STYLES}(?: chart| plot| style)?$`).exec(s)
  if (m) {
    const subject = subjectOf(m[1])
    if (!subject) return null
    const v = m[2].replace(/^column$/, 'columns').replace(/^step ?line$|^steps$/, 'step').replace(/^cross$/, 'crosses')
    return { instance: subject, property: 'plotStyle', value: v, output: null }
  }
  return null
}

// ── where it draws (Display in) ──
const OWN_PANE = /^(?:(?:its|their) own (?:pane|panel|window)|(?:an? )?(?:separate|new|different|dedicated|own|lower) (?:pane|panel|window)|own pane|separate pane|a pane of its own|its own)$/
const PRICE_PANE = /^(?:the )?(?:price(?: pane| chart| panel)?|main (?:pane|chart|panel)|candles|candlesticks|price action)$/
const VOLUME_PANE = /^(?:the )?volume(?: pane| panel)?$/
export function placeOfWords(lower) {
  const s = lc(lower)
  // "separate the rsi (into its own pane)", "pop the macd out into its own pane"
  let m = /^(?:separate|detach|split out|pop out|break out) (.+?)(?: (?:in|into|to) (?:its own|a separate|a new|its own separate) (?:pane|panel|window))?$/.exec(s)
  if (m) { const subject = subjectOf(m[1]); return subject ? { instance: subject, place: 'pane' } : null }
  // "merge the 9 ema into the rsi pane", "combine the macd with the rsi"
  m = /^(?:merge|combine) (.+?) (?:into|with) (?:the )?(.+?)(?:'s)?(?: pane| panel| window)?$/.exec(s)
  if (m) {
    const subject = subjectOf(m[1]); const host = subjectOf(m[2])
    return subject && host && subject !== host ? { instance: subject, place: host } : null
  }
  m = /^(?:put|move|place|send|drop|stick|throw|overlay|bring|draw|show) (.+?) (?:back )?(?:on top of|in|into|on|onto|to|over|inside) (.+)$/.exec(s)
  if (!m) return null
  const subject = subjectOf(m[1])
  if (!subject) return null
  const where = m[2].replace(/\s+again$/, '').trim()
  if (OWN_PANE.test(where)) return { instance: subject, place: 'pane' }
  if (PRICE_PANE.test(where)) return { instance: subject, place: 'price' }
  if (VOLUME_PANE.test(where)) return { instance: subject, place: 'volume' }
  // "… into the rsi pane", "… on the macd", "overlay the 9 ema on the rsi"
  const other = /^(?:the |my )?(.+?)(?:'s)?( pane| panel| window)?$/.exec(where)
  const host = other ? subjectOf(other[1]) : null
  // a bare length is a pane only when the words say pane ("… into the 50 pane"): "move the 20 to 50" is a length change
  if (host && /^#\d+$/.test(host) && !other[2]) return null
  // another indicator's pane is read only when the words SAY pane, or overlay / on top of: "put the top 3 in Momentum" is a list
  if (!other?.[2] && !/^(?:overlay|drop)\b|\bon top of\b/.test(s)) return null
  return host && host !== subject ? { instance: subject, place: host } : null
}

// ── pane order and height ──
const paneOf = (w) => {
  const s = lc(w).replace(ART, '').replace(/\s+(?:pane|panel|window)$/, '').trim()
  return /^(?:price|volume)$/.test(s) ? s : subjectOf(s)
}
const SIDE = { above: 'above', over: 'above', below: 'below', under: 'below', beneath: 'below', underneath: 'below' }
export function paneMoveOfWords(lower) {
  const s = lc(lower)
  let m = /^(?:move|put|place|send|bring|drag|shift) (.+?) (?:to|at) the (top|bottom|very top|very bottom)(?: of the (?:chart|panes|stack))?$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), to: m[2].replace('very ', ''), relativeTo: null }
  m = /^(?:make|have|set) (.+?) (?:the )?(top|bottom|first|last|lowest|highest) (?:pane|panel)$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), to: /^(?:top|first|highest)$/.test(m[2]) ? 'top' : 'bottom', relativeTo: null }
  m = /^(?:move|shift|bump|nudge) (.+?) (up|down)(?: (?:one|a|1)(?: (?:pane|spot|place|slot|notch|level))?)?$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), to: m[2], relativeTo: null }
  // (only between panes the words NAME — "put the 9 above the 20" is two lines on the price chart: the conversation reader's)
  m = /^(?:move|put|place|drag|shift) (.+?) (?:so it'?s |to be )?(?:right |directly |just )?(above|below|under|beneath|underneath) (.+)$/.exec(s)
  if (m && paneOf(m[1]) && paneOf(m[3]) && !String(paneOf(m[1])).startsWith('#') && !String(paneOf(m[3])).startsWith('#')) return { pane: paneOf(m[1]), to: SIDE[m[2]], relativeTo: paneOf(m[3]) }
  return null
}
const SIZE_REL = { bigger: 'bigger', taller: 'bigger', larger: 'bigger', higher: 'bigger', smaller: 'smaller', shorter: 'smaller', lower: 'smaller' }
export function paneResizeOfWords(lower) {
  const s = lc(lower)
  // the Volume pane's height is a chart setting of its own (chart.setSetting volume.paneHeightPct): never read here
  if (/^\S+ (?:the )?volume (?:pane|panel|window)\b/.test(s) || /\bvolume (?:pane|panel)(?:'s)? (?:height|size)\b/.test(s)) return null
  // "make the rsi pane 30%", "resize the macd pane to 25 percent", "set the rsi pane height to 40% of the chart"
  let m = /^(?:make|set|resize|change|adjust|size) (.+?) (?:pane|panel|window)(?:'s)?(?: (?:height|size))? (?:to |at )?(\d{1,2})(?: ?%| percent| pct)(?: (?:of the (?:chart|screen|height|window)|tall|high))?$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), size: Number(m[2]) }
  // "make the rsi pane a bit bigger", "make the macd panel shorter"
  m = /^(?:make|set) (.+?) (?:pane|panel|window) (?:a (?:bit|little|lot|touch) |slightly |much )?(bigger|smaller|taller|shorter|larger|higher|lower)$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), size: SIZE_REL[m[2]] }
  // "shrink the rsi pane", "enlarge the macd pane", "expand the rsi panel"
  m = /^(shrink|enlarge|expand|grow|squash|stretch) (.+?) (?:pane|panel|window)$/.exec(s)
  if (m && paneOf(m[2])) return { pane: paneOf(m[2]), size: /^(?:shrink|squash)$/.test(m[1]) ? 'smaller' : 'bigger' }
  // "reset the rsi pane size", "make the macd pane automatic again"
  m = /^(?:reset|auto-?size) (.+?) (?:pane|panel|window)(?:'s)?(?: (?:height|size))?$/.exec(s)
    || /^(?:make|set|put) (.+?) (?:pane|panel|window)(?:'s)?(?: (?:height|size))? (?:back )?(?:to )?(?:auto|automatic|default)(?: (?:height|size))?(?: again)?$/.exec(s)
  if (m && paneOf(m[1])) return { pane: paneOf(m[1]), size: 'auto' }
  return null
}

// ── a second copy on the same chart ──
export function duplicateOfWords(lower) {
  const s = lc(lower)
  const m = /^(?:duplicate|clone) (.+?)(?: (?:here|again))?$/.exec(s)
    || /^(?:make|add|create|put) (?:a|another|one more|a second) (?:copy|duplicate|clone) of (.+?)(?: (?:here|again))?$/.exec(s)
  if (!m) return null
  const subject = subjectOf(m[1])
  return subject ? { instance: subject } : null
}

// ── a named SETTING (any declared input: lengths, multipliers, types, switches) ──
const FILLER = new Set(['length', 'period', 'periods', 'setting', 'settings', 'value', 'input', 'the', 'line', 'bars', 'of', 'parameter', 'param'])
const SYN = { standard: 'std', stdev: 'std dev', stddev: 'std dev', sd: 'std dev', deviation: 'dev', deviations: 'dev', mult: 'multiplier', avg: 'average', smooth: 'smoothing', len: 'length', lookback: 'lookback' }
const tokens = (w) => lc(w).replace(/\([^)]*\)/g, ' ').replace(/[%]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_/]+/)
  .flatMap(t => (SYN[t] ? SYN[t].split(' ') : [t])).filter(t => t && !FILLER.has(t))
const keyTokens = (key) => tokens(String(key).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).filter((t, i) => !(i === 0 && t === 'show'))
const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i])
// a style input is the look family's (indicatorStyle.set): "line width" / "line style" are never read as a setting here
const LOOK_KEYS = new Set(['lineWidth', 'lineStyle', 'opacity'])
/** One declared input of `defId` that the words name by its label or key (exactly one), or null. */
export function settingOf(defId, words) {
  const want = tokens(words)
  const inputs = inputsOfDef(defId).filter(i => !LOOK_KEYS.has(i.key))
  const hits = inputs.filter(i => same(want, tokens(i.label || '')) || same(want, keyTokens(i.key)))
  return hits.length === 1 ? hits[0] : null
}
const ON = /^(?:on|true|yes|enabled?|shown?|visible|1)$/
const OFF = /^(?:off|false|no|disabled?|hidden|hide|none|0)$/
/** The member's value word → the input's own type, or undefined (not a value of it). */
function valueFor(input, raw) {
  const v = lc(raw).replace(/^(?:an? )/, '')
  if (input.type === 'int' || input.type === 'float') {
    const n = Number(v.replace(/%$/, ''))
    return Number.isFinite(n) && /^-?\d+(?:\.\d+)?%?$/.test(v) ? n : undefined
  }
  if (input.type === 'bool') return ON.test(v) ? true : OFF.test(v) ? false : undefined
  if (input.type === 'enum') {
    const opts = (input.options || []).map(o => (o && typeof o === 'object' && 'value' in o ? o : { value: o, label: String(o) }))
    const hit = opts.filter(o => lc(o.value) === v || lc(o.label) === v || squash(o.label) === squash(v))
    return hit.length === 1 ? hit[0].value : undefined
  }
  return undefined
}
const out = (input, value, subject) => (value === undefined ? null : { instance: subject, inputs: [{ key: input.key, value }] })
/** "set the macd fast length to 8", "change the bollinger std dev to 2.5", "turn off the rs rating on the rs line". */
export function settingOfWords(lower) {
  const s = lc(lower)
  // switches: "turn off the cross markers on the rs line", "enable the rating colors for the rs line", "hide the rs new lows on the rs line"
  let m = /^(?:turn|switch|toggle|flip) (on|off) (?:the )?(.+?) (?:on|for|in) (?:the |my )?(.+)$/.exec(s)
    || /^(enable|disable|show|hide|display|remove|add) (?:the )?(.+?) (?:on|for|in|from) (?:the |my )?(.+)$/.exec(s)
  if (m) {
    const subject = subjectOf(m[3])
    if (!subject || subject.startsWith('#')) return null
    const input = settingOf(subject, m[2])
    if (!input || input.type !== 'bool') return null
    return out(input, /^(?:on|enable|show|display|add)$/.test(m[1]), subject)
  }
  // "turn the rs line's cross markers off", "switch off the rs line's rating"
  m = /^(?:turn|switch|toggle|flip) (?:(on|off) )?(?:the )?(.+?)'s (.+?)(?: (on|off))?$/.exec(s)
  if (m && !!m[1] !== !!m[4]) {
    const subject = subjectOf(m[2])
    const input = subject && !subject.startsWith('#') ? settingOf(subject, m[3]) : null
    return input && input.type === 'bool' ? out(input, (m[1] || m[4]) === 'on', subject) : null
  }
  // values: "set the macd fast length to 8", "change the keltner multiplier to 1.5", "make the stoch %k period 5",
  // "set the std dev of the bollinger bands to 2.5", "set the rs line benchmark to qqq"
  m = /^(?:set|change|make|switch|put|bump|adjust|update|move) (?:the |my )?(.+?) (?:to|=|at|into) (.+)$/.exec(s)
    || /^(?:set|make|change) (?:the |my )?(.+?) (\S+)$/.exec(s)
  if (!m) return null
  const left = m[1]
  const value = m[2]
  const of = /^(.+?) (?:of|on|for|in) (?:the |my )?(.+)$/.exec(left)
  const tries = []
  if (of) tries.push({ subject: subjectOf(of[2]), words: of[1] })
  const st = subjectThenRest(left)
  if (st && st.rest) tries.push({ subject: st.subject, words: st.rest.replace(/^'s\s*/, '') })
  for (const t of tries) {
    if (!t.subject || t.subject.startsWith('#') || !t.words) continue
    const input = settingOf(t.subject, t.words)
    if (input) return out(input, valueFor(input, value), t.subject)
  }
  return null
}

// ── show / hide: read only when the board makes it unambiguous ──
/** Is `subject` on some chart in the state `want` (hidden: true = hidden there), and in the other state on none? */
function visibleStateIs(host, subject, hidden, ids = new Set()) {
  let snaps = []
  try { snaps = indicatorEditsKind.list(host) || [] } catch { snaps = [] }
  let match = 0
  let other = 0
  for (const snap of snaps) {
    const st = indicatorEditsKind.stateOf(snap)
    const t = targetOf(st, subject)
    if (!t.ok) continue
    const row = (st.rows || []).find(r => r.instanceId === t.instanceId)
    if (!row) continue
    if (!!row.hidden === hidden) { match++; ids.add(row.instanceId) } else other++
  }
  return match > 0 && other === 0
}
/**
 * "hide the rsi", "unhide the macd", "show the 20 ema again" → indicator.hide / indicator.show, ONLY when the board says which:
 * the indicator is in the opposite state on some chart and already in the asked state on none ("show rsi" on a chart with
 * no RSI may as well mean add it — that goes to the model, as before).
 */
export function visibilityOfWords(lower, visible, host) {
  const s = lc(lower)
  const m = visible
    ? /^(?:unhide|show|reveal|bring back|restore) (.+?)(?: again| back)?$/.exec(s)
    : /^(?:hide) (.+?)(?: for now| for a bit)?$/.exec(s)
  if (!m) return null
  const subject = subjectOf(m[1])
  if (!subject || !host) return null
  const ids = new Set()
  if (!visibleStateIs(host, subject, visible, ids)) return null
  // the same instance everywhere it is (the default SMA 50 is "ovl:2" on every chart) → that exact id, as the conversation's
  // referent reader names it; else the words, resolved again on each chart
  return { instance: ids.size === 1 ? [...ids][0] : subject }
}

// ── LEGEND family (pl-legend): the legend's chords and its menu's definition verbs ──
/**
 * "toggle rsi", "toggle the vwap off" — the chord's own meaning (StockChart.toggleIndicatorById: a shown study hides, a
 * hidden one shows, an absent one is added), read ONLY when the whole board agrees which of the three it is. `want` is the
 * capability asking ('hide' | 'show' | 'add'); a board where the indicator is shown on one chart and hidden or absent on
 * another goes to the model, as before. An explicit "on" / "off" narrows it ("toggle rsi off" never adds or shows).
 */
export function toggleOfWords(lower, want, host) {
  const m = /^(?:toggle|flip) (?:on |off )?(.+?)(?: (on|off))?(?: again)?$/.exec(lc(lower))
  if (!m || !host) return null
  const lead = /^toggle (on|off) /.exec(lc(lower))
  const dir = m[2] || lead?.[1] || null
  const subject = subjectOf(m[1])
  if (!subject) return null
  let snaps = []
  try { snaps = indicatorEditsKind.list(host) || [] } catch { snaps = [] }
  if (!snaps.length) return null
  const states = new Set()
  const ids = new Set()
  for (const snap of snaps) {
    const st = indicatorEditsKind.stateOf(snap)
    const t = targetOf(st, subject)
    if (!t.ok) { states.add(t.reason === 'not-found' || /not.?found/i.test(String(t.reason)) ? 'absent' : 'unclear'); continue }
    const row = (st.rows || []).find(r => r.instanceId === t.instanceId)
    if (!row) { states.add('unclear'); continue }
    states.add(row.hidden ? 'hidden' : 'shown')
    ids.add(row.instanceId)
  }
  if (states.size !== 1) return null
  const [state] = states
  const does = state === 'shown' ? 'hide' : state === 'hidden' ? 'show' : state === 'absent' ? 'add' : null
  if (!does || does !== want) return null
  if (dir === 'off' && does !== 'hide') return null
  if (dir === 'on' && does === 'hide') return null
  if (does === 'add') return subject.startsWith('#') ? null : { defId: subject, inputs: null }
  return { instance: ids.size === 1 ? [...ids][0] : subject }
}

/**
 * "create a custom copy of the rsi", "make my own copy of macd", "save trend strength as my own indicator" → the legend's
 * "Create custom copy" (definition.duplicate {defId}). The word "custom" / "own" / "editable" / "personal" is what makes it
 * a NEW definition — "make a copy of the rsi" is "Duplicate on chart" (duplicateOfWords). A moving average named by its
 * length ("the 20 ema") is a chart's instance, not a definition: not read here.
 */
export function customCopyOfWords(lower) {
  const s = lc(lower)
  const m = /^(?:create|make|save|give me|build) (?:a |an |my |me a |me an )?(?:own |custom |editable |personal |private )+(?:copy|version|clone|fork) of (.+?)(?: (?:that|which) i can edit| to edit| for me)?$/.exec(s)
    || /^(?:make|create) my own (?:copy|version) of (.+)$/.exec(s)
    || /^(?:save|copy|fork|clone) (.+?) (?:as|into) (?:my own|a custom|an editable|my)(?: indicator| copy| formula| version)?$/.exec(s)
    || /^(?:fork|customi[sz]e) (.+?)(?: into my own(?: indicator)?)?$/.exec(s)
  if (!m) return null
  const subject = subjectOf(m[1])
  return subject && !subject.startsWith('#') ? { defId: subject } : null
}

/**
 * "modify trend strength with the uct agent", "open modify on my breakout dots", "open trend strength in create indicator"
 * → the legend's "Modify with the UCT Agent" (indicator.openCreate {defId}), for one of the member's OWN saved formulas
 * (`ownedIds`): a built-in has no Modify (chipMenu.js offers it only for a user definition).
 */
export function modifyOfWords(lower, ownedIds) {
  const s = lc(lower)
  const AGENT = '(?:the )?(?:uct )?(?:agent|intelligence|ai|create indicator|indicator studio|studio|indicator builder)'
  const m = new RegExp(`^(?:modify|edit|change|tweak|rework|improve) (.+?) (?:with|in|using|through) ${AGENT}$`).exec(s)
    || /^open (?:the )?modify (?:on|for) (.+)$/.exec(s)
    || new RegExp(`^open (.+?) in ${AGENT}(?: to (?:modify|edit) it)?$`).exec(s)
  if (!m) return null
  const subject = subjectOf(m[1])
  let owned = []
  try { owned = typeof ownedIds === 'function' ? ownedIds() : [] } catch { owned = [] }
  return subject && owned.includes(subject) ? { request: null, defId: subject } : null
}
