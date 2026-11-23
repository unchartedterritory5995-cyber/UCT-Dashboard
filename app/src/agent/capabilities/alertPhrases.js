// ── ALERTS (C1 / C2 / C3 family): the GENERAL reader of a member's alert wording — no model call ─────────────────
//
// The instant path for the whole Alerts family, written as phrase CLASSES rather than sentences. One grammar is shared
// by every alert the product has, because a trader says them the same way:
//
//   LEAD      the ask: "alert me", "ping me", "notify me", "let me know", "tell me", "set (up) an alert", "mark", …
//   WHEN      "when", "if", "once", "as soon as", … — or "on" / "for" ("set an alert on NVDA above 150")
//   SUBJECT   what is watched: a TICKER ("AAPL", "$TSLA", "the AMD chart"), the CHART itself ("it", "this one", "price"),
//             or an INDICATOR on a chart ("RSI", "the 9 ema", "NVDA's macd signal line") — `indicatorPhrases.subjectOf`
//   MOTION    which side: above ("goes above", "breaks out over", "rises to", "reclaims") or below ("drops below",
//             "loses", "falls to"); "crosses" marks a CROSS for an indicator (the product's own cross_above / cross_below)
//   TARGET    a price level ("150", "$212.50"), another moving average ("the 20", "its 50 sma"), or a DRAWING on the chart
//             ("this trendline", "the 0.618 fib level")
//   TAIL      "to the upside" / "to the downside", "on the weekly", "on this chart", "at a fixed level", …
//
// …and the book's own sentences: "what alerts do I have on TSLA", "which alerts went off today", "why hasn't my RSI alert
// fired", "delete my NVDA alert", "pause my RSI alert", "turn off my NVDA alerts".
//
// ⛔ READ ONLY. Every reader returns ONE existing capability's args (alert.*, indicatorAlert.*, drawing.setAlert) — the
// same args a model plan carries — so the request goes through the same check → proposal (create and delete are always
// confirm-gated) → the product's own writer → read-back → Undo where the product has one. Nothing here writes, and nothing
// decides whether a level is allowed: the capability's check does (a level already reached, a duplicate, a range).
// ⛔ ONE READING, NEVER A GUESS. A reader returns null (→ the model, with the spatial / deixis safety net) whenever the
// words could mean something else:
//   • no side said ("alert me when AAPL hits 200") — the product needs above or below, and the model asks with choices;
//   • a chart that is not certain: "it" / "this" on a board of several charts is resolved only for the chart the member
//     CLICKED and named as such ("this chart", "this one"), never a position, an ordinal or the conversation's subject;
//   • an indicator, a drawing or an alert that is not exactly ONE thing on the board / in the book;
//   • a lower-case word as a ticker unless a chart on the board shows it ("nvda" on the NVDA chart).

import { getTargetKind } from '../capabilities'
import { subjectOf } from './indicatorPhrases'
import { indicatorsOn } from './indicators'
import { parseTimeframe } from './timeframeWords'
import { alertKindFor } from '../../components/chart/drawingAlertAnchors'

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const NATIVE = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lc = (s) => String(s ?? '').toLowerCase().replace(/[’‘]/g, '\'').replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim()

// ── the grammar's parts ──
const LEAD = String.raw`(?:(?:please\s+)?(?:alert|ping|notify|tell|text|warn|message|buzz|email|remind|wake)\s+me|let\s+me\s+know|give\s+me\s+(?:an?\s+)?(?:alert|heads\s+up|ping|shout)|(?:set|create|add|make|put|place|drop|setup|start)(?:\s+up)?\s+(?:me\s+)?(?:an?\s+|my\s+)?(?:new\s+)?(?:price\s+)?alert|i\s+(?:want|need)\s+(?:an?\s+)?(?:price\s+)?alert|mark|flag|alert)`
const WHEN = String.raw`(?:when(?:ever)?|if|once|as\s+soon\s+as|the\s+(?:moment|second|minute)|in\s+case)`
const UP_V = 'goes|go|going|gets|get|getting|moves|move|moving|trades|trade|trading|rises|rise|rising|climbs|climb|climbing|runs|run|running|pushes|push|pushing|breaks|break|breaking|pops|pop|popping|rallies|rally|rallying|jumps|jump|jumping|is|closes|close|closing|ticks|tick|spikes|spike|surges|surge|stays|stay|holds|hold|prints|print|gaps|gap|crosses|cross|crossing|crossed|heads|head|trades'
const DOWN_V = 'goes|go|going|gets|get|getting|moves|move|moving|trades|trade|trading|drops|drop|dropping|falls|fall|falling|dips|dip|dipping|sinks|sink|sinking|slides|slide|sliding|slips|slip|slipping|breaks|break|breaking|is|closes|close|closing|ticks|tick|tanks|tank|plunges|plunge|dumps|dump|crashes|crash|stays|stay|holds|hold|prints|print|gaps|gap|crosses|cross|crossing|crossed|heads|head|declines|decline'
const PART = String.raw`(?:\s+(?:back|up|out|down|right|straight))?`
const UP_TO = String.raw`(?:rises|rise|climbs|climb|rallies|rally|runs(?:\s+up)?|run(?:\s+up)?|pushes|push|jumps|jump|gets(?:\s+up)?|get(?:\s+up)?|goes\s+up|go\s+up|moves\s+up|move\s+up|bounces|bounce|recovers|recover)\s+(?:back\s+)?to`
const DOWN_TO = String.raw`(?:falls|fall|drops|drop|dips|dip|sinks|sink|slides|slide|declines|decline|pulls\s+back|pull\s+back|comes(?:\s+back)?\s+down|come(?:\s+back)?\s+down|goes\s+down|go\s+down|moves\s+down|move\s+down|sells\s+off|sell\s+off)\s+(?:back\s+)?to`
const MOTION_RE = new RegExp(String.raw`^(?:(${UP_V})${PART}\s+(?:above|over)|(${DOWN_V})${PART}\s+(?:below|under|beneath)|(${UP_TO})|(${DOWN_TO})|(reclaims|reclaim|tops|top|clears|clear|breaks\s+out\s+(?:above|over|of))|(loses|lose|breaks\s+down\s+(?:below|under|through)?|undercuts|undercut))\s+`)
/** "goes above 200 …" → { dir, cross, rest } or null. A bare "crosses / hits / reaches 200" names no side (→ null, or a tail says it). */
function motionOf(s) {
  const m = MOTION_RE.exec(s + ' ')
  if (m) {
    const verb = m[1] || m[2] || ''
    const dir = m[1] || m[3] || m[5] ? 'above' : 'below'
    return { dir, cross: /^cross/.test(verb), rest: s.slice(m[0].length).trim() }
  }
  // "crosses 200 to the upside", "crosses the 20 to the downside": the side is in the tail
  const c = /^(?:cross(?:es|ing|ed)?|breaks|break|moves|move)\s+(?:through\s+)?(.+?)\s+(to the upside|to the downside|on the way up|on the way down|from below|from above|going up|going down|higher|lower)$/.exec(s)
  if (c) return { dir: /upside|way up|from below|going up|higher/.test(c[2]) ? 'above' : 'below', cross: /^cross/.test(s), rest: c[1].trim() }
  return null
}
const SIDE_TAIL = /\s+(to the upside|to the downside|on the way up|on the way down|from below|from above)$/
const sideOfTail = (w) => (/upside|way up|from below/.test(w) ? 'above' : 'below')
const LEVEL_RE = /^\$?(\d{1,3}(?:,\d{3})+|\d{1,7})(\.\d{1,4})?(?:\s*(?:dollars|bucks|usd|a share|per share))?$/
/** "150", "$212.50", "1,250" → the number; never a percent, a size or a length ("5%", "10k", "the 200 day"). */
function levelOf(w) {
  const m = LEVEL_RE.exec(String(w || '').trim())
  if (!m) return null
  const n = Number(`${m[1].replace(/,/g, '')}${m[2] || ''}`)
  return Number.isFinite(n) && n > 0 ? n : null
}
/** An INDICATOR level: zero and below zero too ("MACD crosses above 0", "Williams %R below -80", "crosses zero"); the
 *  indicator's own declared range is the capability's check, never this reader's. */
function indicatorLevelOf(w) {
  const t = String(w || '').trim().replace(/^zero$/, '0').replace(/^the zero line$/, '0')
  const neg = /^(?:-|minus\s+|negative\s+)/.exec(t)
  const m = /^(\d{1,7})(\.\d{1,4})?$/.exec(neg ? t.slice(neg[0].length) : t)
  if (!m) return null
  const n = Number(`${m[1]}${m[2] || ''}`) * (neg ? -1 : 1)
  return Number.isFinite(n) ? n : null
}
const TF_TAIL = /\s+(?:on|using|with)\s+(?:the\s+)?(daily|weekly|monthly|hourly|\d{1,2}\s*(?:minute|min|hour)s?|\d{1,2}m|\d{1,2}h|1\s*day|1\s*week)(?:\s+(?:chart|charts|bars|candles|timeframe|time frame|close|closes))?$/
const CHART_TAIL = /\s+(?:on|for|in)\s+(?:this|my|the|our)\s+(?:(\$?[a-z][a-z0-9.-]{0,9})\s+)?(?:active\s+|current\s+|selected\s+|main\s+)?chart$/
const FOLLOW_TAIL = /,?\s+(?:but\s+|and\s+|just\s+)?(?:at\s+(?:a\s+|the\s+)?(?:fixed|static|set)\s+(?:level|price)|(?:as\s+a\s+)?fixed(?:\s+level)?|(?:that\s+|which\s+)?(?:doesn'?t|does\s+not|won'?t|shouldn'?t|should\s+not|not\s+to|don'?t)\s+(?:follow|move\s+with|track)(?:\s+(?:the|this|that|it|its))?(?:\s+(?:line|drawing|trendline|level))?|without\s+following(?:\s+(?:the|this|that|it))?(?:\s+(?:line|drawing))?|(?:and\s+)?not\s+following(?:\s+(?:the|this|that|it))?(?:\s+(?:line|drawing))?|at\s+(?:the|its|this|that)\s+(?:line'?s\s+)?(?:current|present)\s+(?:level|price))$/
const tfOf = (w) => parseTimeframe(String(w).replace(/^1\s*day$/, 'daily').replace(/^1\s*week$/, 'weekly').replace(/(\d)\s*min(?:ute)?s?$/, '$1 minute').replace(/(\d)\s*hours?$/, '$1 hour'), NATIVE)

// chart words the instant path never resolves on a board of several charts (the model + the spatial net do)
const CHART_WORDS = /\b(?:left|right|top|bottom|upper|lower|middle|center|first|second|third|fourth|fifth|last|other|next|previous|beside|above it|below it|row|column|cell|chart\s*\d|\d(?:st|nd|rd|th)\s+chart)\b/
// the CLICKED chart, said as such — read from the member's own words (the fast path's canon folds "this chart" into "the chart")
const CLICK_RAW = /\b(?:this\s+(?:chart|one|stock|ticker|name|symbol)|the\s+(?:selected|clicked|highlighted|focused)\s+(?:chart|one|stock))\b/i
const DEICTIC = /^(?:it|its price|it's price|this|this one|this stock|this ticker|this name|this symbol|this chart|that|that one|that stock|the stock|the ticker|the name|the chart|the symbol|price|the price|this price|share price|the share price|the selected chart|the clicked chart|the active chart|the current chart|the highlighted chart|the selected one|the stock price|the chart's price)$/
const NOT_TICKER = new Set(['it', 'this', 'that', 'price', 'the', 'stock', 'market', 'chart', 'line', 'level', 'one', 'alert', 'me', 'my', 'is', 'a', 'an', 'volume', 'spy?'])

// read through the target kinds (drawings.js / indicatorAlerts.js publish them), never imported: those modules import this one
const lastTouchedDrawing = () => { try { return getTargetKind('drawing')?.lastTouched?.() || null } catch { return null } }
const alertPlotsOf = (inst) => { try { return getTargetKind('indicatorAlertLibrary')?.plotsOf?.(inst) ?? null } catch { return null } }
const crossPlotOf = (inst) => { try { const k = getTargetKind('indicatorAlertLibrary'); return k?.crossPlotOf ? k.crossPlotOf(inst) : null } catch { return null } }
const chartsOf = (host) => { try { return host?.charts?.list?.() || [] } catch { return [] } }
const selectedOf = (host) => { try { return host?.charts?.selected?.() || null } catch { return null } }
/** The chart the member's words point at, or null (never a guess): one chart on the board; on several, the CLICKED chart
 *  named as such ("this chart", "this one") in the whole sentence, with no other chart word. */
function pointedChart(host, { whole, text, raw }) {
  const charts = chartsOf(host)
  if (charts.length === 1) return charts[0]
  if (charts.length < 2 || !whole || CHART_WORDS.test(text)) return null
  if (!CLICK_RAW.test(raw)) return null
  const sel = selectedOf(host)
  return sel ? charts.find(c => c.ref === sel) || null : null
}
/** A ticker the member typed: upper case, or with a `$`, or a lower-case word a chart on the board shows. */
function tickerOf(word, raw, host) {
  const w = String(word || '').trim().replace(/'s$/, '')
  const bare = w.replace(/^\$/, '')
  if (!bare || NOT_TICKER.has(bare.toLowerCase())) return null
  const up = bare.toUpperCase()
  if (!TICKER.test(up)) return null
  // an indicator's name is never a ticker here ("rsi", "macd", "vwap"): it is the other half of the family
  if (subjectOf(bare.toLowerCase())) return null
  const typedUpper = new RegExp(`(^|[^A-Za-z0-9])\\$?${esc(up)}(?![A-Za-z0-9])`).test(String(raw || ''))
  if (w.startsWith('$') || typedUpper) return up
  return chartsOf(host).some(c => String(c.symbol || '').toUpperCase() === up) ? up : null
}
/** SUBJECT of a price alert → { sym } | null. */
function priceSubject(words, ctx) {
  const s = lc(words).replace(/^(?:the\s+)?price\s+of\s+/, '').replace(/\s+(?:stock|shares|share price|price)$/, '').replace(/^the\s+(.+)\s+chart$/, '$1').trim()
  if (!s) return null
  if (DEICTIC.test(lc(words))) {
    const c = pointedChart(ctx.host, ctx)
    return c?.symbol ? { sym: String(c.symbol).toUpperCase() } : null
  }
  const t = tickerOf(s, ctx.raw, ctx.host)
  return t ? { sym: t } : null
}

// ── the sentence → its parts ──
/** "LEAD WHEN SUBJECT MOTION TARGET TAIL" → { subject, dir, cross, target, tf, chartWord, fixed } or null. */
function parseCreate(lower) {
  let s = lc(lower)
  const lead = new RegExp(`^${LEAD}\\s+`).exec(s + ' ')
  if (!lead) return null
  s = s.slice(lead[0].length).trim()
  let fixed = false, tf = null, chartWord = null, side = null
  for (let i = 0; i < 4; i++) {
    const f = FOLLOW_TAIL.exec(s); if (f) { fixed = true; s = s.slice(0, f.index).trim(); continue }
    const t = TF_TAIL.exec(s); if (t && !tf) { tf = tfOf(t[1]); if (!tf) return null; s = s.slice(0, t.index).trim(); continue }
    const c = CHART_TAIL.exec(s); if (c && chartWord == null) { chartWord = c[1] || ''; s = s.slice(0, c.index).trim(); continue }
    const d = SIDE_TAIL.exec(s); if (d && !side && !/\b(?:cross(?:es|ing|ed)?|breaks?|moves?)\s+(?:through\s+)?\S+$/.test(s.slice(0, d.index))) { side = sideOfTail(d[1]); s = s.slice(0, d.index).trim(); continue }
    break
  }
  // shape 1: "… when NVDA goes above 150"
  const w = new RegExp(`^(?:${WHEN}\\s+)(.+)$`).exec(s)
  if (w) {
    const body = w[1]
    const words = body.split(' ')
    for (let k = 1; k < Math.min(words.length, 7); k++) {
      const mo = motionOf(words.slice(k).join(' '))
      if (mo) return { subject: words.slice(0, k).join(' '), dir: side && side !== mo.dir ? null : mo.dir, cross: mo.cross, target: mo.rest, tf, chartWord, fixed }
    }
    return null
  }
  // shape 2: "… on NVDA above 150", "… for NVDA at 150 to the upside", "… on the 9 ema crossing above the 20"
  const o = /^(?:on|for|at)\s+(.+)$/.exec(s)
  if (o) {
    const words = o[1].split(' ')
    for (let k = 1; k < Math.min(words.length, 7); k++) {
      const tail = words.slice(k).join(' ')
      const d = /^(?:at\s+)?(above|over|below|under)\s+(.+)$/.exec(tail)
      if (d) return { subject: words.slice(0, k).join(' '), dir: /above|over/.test(d[1]) ? 'above' : 'below', cross: false, target: d[2], tf, chartWord, fixed }
      const a = /^at\s+(.+)$/.exec(tail)
      if (a && side) return { subject: words.slice(0, k).join(' '), dir: side, cross: false, target: a[1], tf, chartWord, fixed }
      const mo = motionOf(tail)
      if (mo) return { subject: words.slice(0, k).join(' '), dir: mo.dir, cross: mo.cross, target: mo.rest, tf, chartWord, fixed }
    }
    return null
  }
  // shape 3 (no subject: the chart): "set an alert above 210", "alert me at 210 to the upside"
  const bare = /^(?:at\s+)?(above|over|below|under)\s+(.+)$/.exec(s) || (side ? /^at\s+()(.+)$/.exec(s) : null)
  if (bare) return { subject: '', dir: bare[1] ? (/above|over/.test(bare[1]) ? 'above' : 'below') : side, cross: false, target: bare[2], tf, chartWord, fixed }
  return null
}
/** "set an RSI alert above 70", "add a NVDA alert at 150 to the upside" — the subject before the word alert. */
function parseSubjectFirst(lower) {
  const s0 = lc(lower)
  const m = /^(?:please\s+)?(?:set|create|add|make|put|place|setup|start)(?:\s+up)?\s+(?:me\s+)?(?:an?\s+|my\s+)?(?:new\s+)?(.+?)\s+(?:price\s+)?alert\s+(.+)$/.exec(s0)
  if (!m || /\b(?:alert|when|if)\b/.test(m[1]) || /^(?:an?|my|the|new)$/.test(m[1])) return null
  let rest = m[2], side = null, tf = null
  const t = TF_TAIL.exec(rest); if (t) { tf = tfOf(t[1]); if (!tf) return null; rest = rest.slice(0, t.index).trim() }
  const d0 = SIDE_TAIL.exec(rest); if (d0) { side = sideOfTail(d0[1]); rest = rest.slice(0, d0.index).trim() }
  const d = /^(?:at\s+|for\s+)?(above|over|below|under)\s+(.+)$/.exec(rest)
  if (d) return { subject: m[1], dir: /above|over/.test(d[1]) ? 'above' : 'below', cross: false, target: d[2], tf, chartWord: null, fixed: false }
  const a = /^(?:at|for)\s+(.+)$/.exec(rest)
  if (a && side) return { subject: m[1], dir: side, cross: false, target: a[1], tf, chartWord: null, fixed: false }
  const mo = /^(?:when|if)\s+/.test(rest) ? null : motionOf(rest.replace(/^(?:for\s+)?(?:a\s+)?/, ''))
  return mo ? { subject: m[1], dir: mo.dir, cross: mo.cross, target: mo.rest, tf, chartWord: null, fixed: false } : null
}

// ── INDICATOR SUBJECT ──
const ART = /^(?:the|my|its|their|this|that)\s+/
/** "NVDA's weekly macd signal line" → { sym, tfWord, words } (the indicator words still to resolve). */
function indicatorSubjectParts(words, ctx) {
  let s = lc(words).replace(ART, '')
  let sym = null, tf = null
  const own = /^(\$?[a-z][a-z0-9.-]{0,9})(?:'s|s')\s+(.+)$/.exec(s)
  if (own) { sym = tickerOf(own[1], ctx.raw, ctx.host); if (!sym) return null; s = own[2].replace(ART, '') }
  else {
    const lead = /^(\$?[a-z][a-z0-9.-]{0,9})\s+(.+)$/.exec(s)
    const t = lead && !subjectOf(lead[1]) ? tickerOf(lead[1], ctx.raw, ctx.host) : null
    if (t && subjectOf(lead[2].split(' ')[0]) != null) { sym = t; s = lead[2] }
  }
  const tfw = /^(daily|weekly|monthly|hourly|\d{1,2}\s*(?:minute|hour))\s+(.+)$/.exec(s)
  if (tfw) { tf = tfOf(tfw[1]); if (!tf) return null; s = tfw[2] }
  const on = /^(.+?)\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9})$/.exec(s)
  if (on && !sym) { const t = tickerOf(on[2], ctx.raw, ctx.host); if (t) { sym = t; s = on[1] } }
  return { sym, tf, words: s }
}
/** The instance the words name on ONE chart (its own catalog defId, or a moving average by its length), or null. */
function instanceOn(chart, subject) {
  const insts = indicatorsOn(chart?.cs).filter(i => !i.setting)
  let hits
  const ma = /^#(\d+)(?::(\w+))?$/.exec(subject || '')
  if (ma) {
    hits = insts.filter(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === Number(ma[1])
      && (!ma[2] || ma[2] === 'ma' || String(i.inputs?.maType || 'sma').toLowerCase() === ma[2]))
  } else hits = insts.filter(i => i.defId === subject)
  return hits.length === 1 ? hits[0] : null
}
/** The leading run of words that names an indicator: { subject, rest } ("macd signal line" → macd + "signal line"). */
function indicatorWords(words) {
  const parts = lc(words).replace(ART, '').split(' ').filter(Boolean)
  for (let k = parts.length; k >= 1; k--) {
    const subject = subjectOf(parts.slice(0, k).join(' '))
    if (!subject) continue
    // the SHORTEST lead naming that same indicator: "macd signal line" is MACD + "signal" (its line), while "9 ema" stays
    // "#9:ema" (the shorter "9" names a different subject, any 9 average)
    let j = k
    while (j > 1 && subjectOf(parts.slice(0, j - 1).join(' ')) === subject) j--
    return { subject, rest: parts.slice(j).join(' ').replace(/\b(?:line|lines|value|reading|indicator|plot)\b/g, '').replace(/\s+/g, ' ').trim() }
  }
  return null
}
/** The ONE chart an indicator alert is for: a named symbol on exactly one chart, the only chart that has that indicator,
 *  the clicked chart said as such, or the only chart. null when that is not certain. */
function indicatorChart(host, subject, { sym, chartWord, whole, text, raw }) {
  const charts = chartsOf(host)
  if (!charts.length) return null
  if (charts.length > 1 && CHART_WORDS.test(text)) return null
  const named = sym || (chartWord ? tickerOf(chartWord, raw, host) : null)
  if (named) {
    const by = charts.filter(c => String(c.symbol || '').toUpperCase() === named)
    return by.length === 1 ? by[0] : null
  }
  if (charts.length === 1) return charts[0]
  if (!whole) return null
  const having = charts.filter(c => instanceOn(c, subject))
  if (having.length === 1) return having[0]
  if (/\bthis\s+chart\b/i.test(raw)) {
    const sel = selectedOf(host)
    return sel ? charts.find(c => c.ref === sel) || null : null
  }
  return null
}
/** The plot the rest words name on an instance's catalog plots: null = the instance's only plot; undefined = not certain. */
function plotOf(inst, rest) {
  const plots = alertPlotsOf(inst)
  // the catalog isn't read yet: no line words = the capability's own reading (its check asks when there are several lines)
  if (!plots) return rest ? undefined : null
  const own = plots.filter(p => !p.cross)
  if (!rest) return own.length === 1 ? null : undefined
  const ws = rest.split(' ')
  const hits = own.filter(p => ws.every(w => `${p.value} ${p.label}`.toLowerCase().split(/[\s.%()_-]+/).some(x => x === w || x.startsWith(w))))
  return hits.length === 1 ? hits[0].value : undefined
}
/** "the 20", "its 50 sma", "the 20 ema line" → the moving-average subject ("#20" / "#20:ema"), or null. */
function maTargetOf(w) {
  const s = lc(w).replace(/^(?:the|its|their|my|a)\s+/, '').replace(/\s+(?:line|average|moving average)$/, '').replace(/\b(\d+)[- ]?(?:day|d|period|bar)\b/, '$1').trim()
  const m = /^(\d{1,4})(?:\s*(ema|sma|ma|dma|wma|hma))?$/.exec(s) || /^(ema|sma)\s*(\d{1,4})$/.exec(s)
  if (!m) return null
  const [n, t] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
  return t && t !== 'ma' && t !== 'dma' ? `#${n}:${t}` : `#${n}`
}

// ── DRAWING TARGET ──
const DRAWING_NOUN = /^(?:(?:this|that|the|my|our)\s+)?(?:(\d*\.?\d+%?)\s+(?:fib(?:onacci)?\s+)?(?:level|line)?\s*(?:of|on)\s+(?:this|that|the|my)\s+)?(trend ?line|trendline|line|ray|horizontal line|horizontal ray|hline|level line|price line|extended line|fib(?:onacci)?(?: retracement| extension)?|fib)(?:\s+(?:level\s+)?(\d*\.?\d+%?)(?:\s+level)?)?(?:\s+i\s+(?:drew|just drew|made|added))?$/
const NOUN_TYPES = {
  trendline: ['trendline'], 'trend line': ['trendline'], ray: ['ray', 'hray'], line: ['horizontal', 'trendline', 'ray', 'hray', 'extended'],
  'horizontal line': ['horizontal'], 'horizontal ray': ['hray'], hline: ['horizontal'], 'level line': ['horizontal'], 'price line': ['horizontal'],
  'extended line': ['extended'], fib: ['fib', 'fibext'], fibonacci: ['fib', 'fibext'], 'fib retracement': ['fib'], 'fibonacci retracement': ['fib'],
  'fib extension': ['fibext'], 'fibonacci extension': ['fibext'],
}
const fibNumber = (w) => { if (!w) return null; const n = Number(String(w).replace('%', '')); return Number.isFinite(n) ? n : null }
/** "this trendline", "the 0.618 level of the fib", "that fib 61.8" → { types, level } or null. */
function drawingTarget(w) {
  const m = DRAWING_NOUN.exec(lc(w))
  if (!m) return null
  const types = NOUN_TYPES[m[2]]
  if (!types) return null
  const level = fibNumber(m[1] || m[3])
  if (level != null && !types.some(t => t === 'fib' || t === 'fibext')) return null
  return { types, level }
}
/** The ONE drawing the words point at: the one the Agent last drew or changed (the context's `recent`) if it is that kind,
 *  else the only drawing of that kind on a one-chart board. → { entry, drawing } or null. */
function pointedDrawing(host, target) {
  const src = getTargetKind('drawing')
  let entries = []
  try { entries = src?.list(host) || [] } catch { entries = [] }
  const ok = (d) => d && target.types.includes(d.type) && !!alertKindFor(d.type) && !d.hidden
  const last = lastTouchedDrawing()
  if (last) {
    const e = entries.find(x => x.ref === last.sym)
    const d = e?.drawings?.find(x => x.id === last.id)
    if (ok(d)) return { entry: e, drawing: d }
    if (d) return null                                            // "this trendline" right after drawing a ray: asked
  }
  if (chartsOf(host).length !== 1 || entries.length !== 1) return null
  const hits = (entries[0].drawings || []).filter(ok)
  return hits.length === 1 ? { entry: entries[0], drawing: hits[0] } : null
}

// ── the CREATE readers ──
function readCreate(ctx) {
  const p = parseCreate(ctx.lower) || parseSubjectFirst(ctx.lower)
  if (!p || !p.dir) return null
  // a DRAWING target: "alert me if it breaks below this trendline" (C1-115 / C1-116 / C1-117)
  const dt = drawingTarget(p.target)
  if (dt) {
    if (p.tf) return null
    if (p.subject && !DEICTIC.test(lc(p.subject)) && !priceSubject(p.subject, ctx)) return null
    const hit = pointedDrawing(ctx.host, dt)
    if (!hit) return null
    // a named ticker must be the drawing's own symbol ("alert me when NVDA breaks below that trendline")
    const named = p.subject && !DEICTIC.test(lc(p.subject)) ? priceSubject(p.subject, ctx)?.sym : null
    if (named && named !== String(hit.entry.symbol || '').toUpperCase()) return null
    const isFib = hit.drawing.type === 'fib' || hit.drawing.type === 'fibext'
    if (isFib !== (dt.level != null)) return null                  // a fib needs its level; a line has none
    return { action: 'drawing.setAlert', args: { drawing: hit.drawing.id, direction: p.dir, level: dt.level, follow: p.fixed ? false : null, __target: hit.entry.ref } }
  }
  if (p.fixed) return null
  // an INDICATOR subject: "ping me if RSI drops below 30 on the daily" (C2-089 / C2-090 / C2-091 / C2-093)
  const ip = p.subject ? indicatorSubjectParts(p.subject, ctx) : null
  const iw = ip ? indicatorWords(ip.words) : null
  if (iw) {
    const chart = indicatorChart(ctx.host, iw.subject, { sym: ip.sym, chartWord: p.chartWord, whole: ctx.whole, text: ctx.text, raw: ctx.raw })
    const inst = chart ? instanceOn(chart, iw.subject) : null
    if (!inst) return null
    const tf = ip.tf && p.tf && ip.tf !== p.tf ? undefined : (ip.tf || p.tf || null)
    if (tf === undefined) return null
    const otherMa = maTargetOf(p.target)
    const level = indicatorLevelOf(p.target)
    if (otherMa && level == null) {
      // a moving-average CROSS: the second average on the SAME chart; "crosses above / over the 20" (cross_above)
      const other = instanceOn(chart, otherMa)
      if (!other || other.instanceId === inst.instanceId || inst.defId !== 'movingAverage') return null
      const cross = crossPlotOf(inst)
      if (cross === undefined) return null
      return { action: 'indicatorAlert.create', args: { instance: inst.instanceId, plot: cross, condition: p.dir === 'above' ? 'cross_above' : 'cross_below', threshold: null, crossWith: other.instanceId, chart: chart.ref, trigger: null, timeframe: tf, __target: 'indicatorAlerts' } }
    }
    if (level == null) return null
    const plot = plotOf(inst, iw.rest)
    if (plot === undefined) return null
    const condition = p.cross ? (p.dir === 'above' ? 'cross_above' : 'cross_below') : p.dir
    return { action: 'indicatorAlert.create', args: { instance: inst.instanceId, plot, condition, threshold: level, crossWith: null, chart: chart.ref, trigger: null, timeframe: tf, __target: 'indicatorAlerts' } }
  }
  // a PRICE level: "alert me when AAPL crosses above 200" (C1-114 / C3-128 / C3-062 / C3-098)
  if (p.tf) return null
  const level = levelOf(p.target)
  if (level == null) return null
  let sym = null
  if (!p.subject) {
    const c = pointedChart(ctx.host, { ...ctx, whole: false })      // no subject: only the one chart there is
    sym = c?.symbol ? String(c.symbol).toUpperCase() : null
  } else sym = priceSubject(p.subject, ctx)?.sym || null
  if (!sym) return null
  if (p.chartWord != null && p.chartWord !== '') {
    const t = tickerOf(p.chartWord, ctx.raw, ctx.host)
    if (!t || t !== sym) return null                               // "alert me when AAPL … on the NVDA chart": the model
  }
  return { action: 'alert.create', args: { symbol: sym, price: level, direction: p.dir, __target: 'alerts' } }
}

// ── the BOOK readers: list, why-not, delete, pause / resume ──
const ALERT_NOUN = String.raw`(?:price\s+|indicator\s+|line\s+|trendline\s+)?alerts?`
const NOT_BOOK = /\b(?:sounds?|chimes?|e-?mails?|digest|notifications?\s+settings?|discord|push)\b/
/** "my NVDA RSI alert", "the alerts on tsla", "my price alerts" → { sym, kind: 'price'|'indicator'|null, ind } or null. */
function bookRef(words, ctx) {
  let s = lc(words).replace(/^(?:all\s+(?:of\s+)?)?(?:my|the|those|these|that|this|our)\s+/, '').replace(/^all\s+/, '').trim()
  let sym = null, kind = null, ind = null
  const on = /^(.*?)\s*(?:on|for|in)\s+(\$?[a-z][a-z0-9.-]{0,9})$/.exec(s)
  if (on) { sym = tickerOf(on[2], ctx.raw, ctx.host); if (!sym) return null; s = on[1].trim() }
  const m = new RegExp(`^(.*?)\\s*\\b(price|indicator|line|trendline)?\\s*alerts?$`).exec(s)
  if (!m) return null
  if (m[2] === 'price' || m[2] === 'line' || m[2] === 'trendline') kind = 'price'
  if (m[2] === 'indicator') kind = 'indicator'
  const head = m[1].trim()
  if (head) {
    const parts = head.split(' ')
    const t0 = tickerOf(parts[0].replace(/'s$/, ''), ctx.raw, ctx.host)
    if (t0 && !sym) { sym = t0; parts.shift() }
    const rest = parts.join(' ').trim()
    if (rest) {
      ind = subjectOf(rest)
      if (!ind) return null
      if (kind === 'price') return null
      kind = 'indicator'
    }
  }
  return { sym, kind, ind }
}
const priceRows = (ref) => (getTargetKind('alert')?.list() || []).filter(a => (!ref.sym || a.sym === ref.sym))
const indicatorRows = (ref) => (getTargetKind('indicatorAlert')?.list() || []).filter(a => (!ref.sym || a.sym === ref.sym) && (!ref.ind || indMatches(a, ref.ind)))
function indMatches(a, subject) {
  const base = String(a.indicator || '').split('.')[0].toLowerCase()
  const ma = /^#(\d+)/.exec(subject)
  if (ma) return base === 'ma_cross' && a.params && (Number(a.params.fast) === Number(ma[1]) || Number(a.params.slow) === Number(ma[1]))
  return base === String(subject).toLowerCase()
}
const loaded = (name) => { try { return !!getTargetKind(name)?.list && getTargetKind(name).read(null, name === 'alertLibrary' ? 'alerts' : 'indicatorAlerts')?.loaded } catch { return false } }

const SYMW = String.raw`(?!(?:price|indicator|line|trendline|active|triggered|paused|all|of)\b)(\$?[a-z][a-z0-9.-]{0,9})`
const LIST_RE = new RegExp(String.raw`^(?:(?:what|which)\s+(?:(active|triggered|paused)\s+)?(${ALERT_NOUN})\s+(?:do\s+i\s+have|have\s+i\s+(?:got|set)|are\s+(?:set|active|on|there|live|running|waiting|armed))(?:\s+set)?(?:\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9}))?|(?:do\s+i\s+have|have\s+i\s+(?:got|set)|is\s+there|are\s+there)\s+(?:any|an|a)\s+(?:(active|paused)\s+)?(${ALERT_NOUN})(?:\s+set)?\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9})|(?:please\s+)?(?:show|list|give|pull\s+up|bring\s+up|display|open|check)(?:\s+me)?(?:\s+all)?(?:\s+of)?\s+(?:my|the)\s+(?:${SYMW}\s+)?(?:(active|triggered|paused)\s+)?(${ALERT_NOUN})(?:\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9}))?|any\s+(${ALERT_NOUN})\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9})|what\s+are\s+my\s+(?:${SYMW}\s+)?(?:(active|triggered|paused)\s+)?(${ALERT_NOUN})(?:\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9}))?)$`)
const WENT_OFF_RE = /^(?:what|which)\s+(?:of\s+my\s+)?(?:price\s+)?alerts?\s+(?:went\s+off|triggered|fired|hit|got\s+hit|have\s+(?:gone\s+off|triggered|fired))(?:\s+(today|so\s+far\s+today|this\s+morning))?(?:\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9}))?$|^(?:did|have)\s+any\s+(?:of\s+my\s+)?(?:price\s+)?alerts?\s+(?:go\s+off|gone\s+off|trigger(?:ed)?|fire[d]?|hit)(?:\s+(today))?(?:\s+(?:on|for)\s+(\$?[a-z][a-z0-9.-]{0,9}))?$/
const WHY_RE = /^(?:why\s+(?:hasn'?t|has\s+not|didn'?t|did\s+not|isn'?t|is\s+not|won'?t|can'?t|doesn'?t)\s+(?:my|the|that)\s+(.+?)\s*alert\s+(?:fired|fire|firing|triggered|trigger|triggering|gone\s+off|go\s+off|going\s+off|working|work|went\s+off)(?:\s+yet)?|(?:which|what)\s+(?:of\s+my\s+)?(?:indicator\s+)?alerts\s+(?:can'?t|cannot|won'?t|will\s+never)\s+(?:fire|trigger|go\s+off)|(?:are|is)\s+any\s+(?:of\s+my\s+)?(?:indicator\s+)?alerts?\s+(?:broken|stuck|not\s+working|failing)|(?:show|list)(?:\s+me)?\s+(?:my\s+)?(?:indicator\s+)?alerts\s+(?:that\s+)?(?:need(?:ing)?\s+attention|(?:that\s+)?can'?t\s+fire))$/
function readList(ctx) {
  const s = lc(ctx.lower)
  if (NOT_BOOK.test(s)) return null
  const why = WHY_RE.exec(s)
  if (why) {
    // "why hasn't my RSI alert fired" — the indicator book's own diagnosis (C2-100); a price alert has no such state, so a
    // sentence about one is the model's
    let sym = null
    if (why[1]) {
      const ip = indicatorSubjectParts(why[1].replace(/\s+indicator$/, ''), ctx)
      const named = ip && indicatorWords(ip.words)
      if (!named && !/^(?:\$?[a-z][a-z0-9.-]{0,9}\s+)?indicator$/.test(lc(why[1]))) return null
      sym = ip?.sym || null
    }
    return { action: 'indicatorAlert.list', args: { symbol: sym, status: 'attention' } }
  }
  const off = WENT_OFF_RE.exec(s)
  if (off) {
    const today = !!(off[1] || off[3])
    const symW = off[2] || off[4]
    const sym = symW ? tickerOf(symW, ctx.raw, ctx.host) : null
    if (symW && !sym) return null
    return { action: 'alert.list', args: { symbol: sym, status: today ? null : 'triggered', triggered_today: today ? true : null } }
  }
  const m = LIST_RE.exec(s)
  if (!m) return null
  const status = m[1] || m[4] || m[8] || m[14] || null
  const noun = m[2] || m[5] || m[9] || m[11] || m[15] || ''
  const symW = m[3] || m[6] || m[7] || m[10] || m[12] || m[13] || m[16] || null
  const sym = symW ? tickerOf(symW, ctx.raw, ctx.host) : null
  if (symW && !sym) return null
  if (/^indicator/.test(noun) || status === 'paused') {
    if (/^(?:price|line|trendline)/.test(noun)) return null
    return { action: 'indicatorAlert.list', args: { symbol: sym, status: status === 'triggered' ? null : status } }
  }
  if (status === 'paused') return null
  return { action: 'alert.list', args: { symbol: sym, status: status || null, triggered_today: null } }
}

const DELETE_V = /^(?:please\s+)?(?:delete|remove|cancel|clear|kill|trash|drop|scrap|nuke|get\s+rid\s+of)\s+(.+)$/
const OFF_V = /^(?:please\s+)?(?:pause|mute|silence|snooze|disable|deactivate|stop|turn\s+off|switch\s+off|shut\s+off)\s+(.+?)(?:\s+(?:off|for\s+now|for\s+a\s+bit|for\s+a\s+while|temporarily))?$/
const OFF_TAIL = /^(?:please\s+)?(?:turn|switch|shut)\s+(.+?)\s+off(?:\s+for\s+now)?$/
const ON_V = /^(?:please\s+)?(?:resume|unpause|un-?pause|unmute|re-?enable|enable|reactivate|re-?activate|re-?arm|turn\s+(?:back\s+)?on|switch\s+(?:back\s+)?on|restart)\s+(.+?)(?:\s+(?:back\s+on|again))?$/
const ON_TAIL = /^(?:please\s+)?(?:turn|switch)\s+(.+?)\s+(?:back\s+)?on(?:\s+again)?$/
function readBook(ctx) {
  const s = lc(ctx.lower)
  if (NOT_BOOK.test(s) || !/\balerts?\b/.test(s)) return null
  const del = DELETE_V.exec(s)
  const off = del ? null : (OFF_V.exec(s) || OFF_TAIL.exec(s))
  const on = del || off ? null : (ON_V.exec(s) || ON_TAIL.exec(s))
  const hit = del || off || on
  if (!hit) return null
  const plural = /\balerts\b/.test(hit[1]) || /^all\b/.test(hit[1])
  const ref = bookRef(hit[1], ctx)
  if (!ref) return null
  const wantPrice = ref.kind !== 'indicator', wantInd = ref.kind !== 'price'
  if (wantPrice && !loaded('alertLibrary')) return null
  // a book that isn't read yet is never read as empty: the model (which re-reads it) decides
  if (wantInd && ctx.host?.indicatorAlerts && !loaded('indicatorAlertLibrary')) return null
  if (ref.kind === 'indicator' && !ctx.host?.indicatorAlerts) return null
  const prices = wantPrice && !ref.ind ? priceRows(ref) : []
  const inds = wantInd ? indicatorRows(ref) : []
  if (del) {
    // exactly ONE alert across both books, never a pick: two candidates (or a plural) is the model's question with choices
    if (plural || prices.length + inds.length !== 1) return null
    return prices.length
      ? { action: 'alert.delete', args: { __target: prices[0].id } }
      : { action: 'indicatorAlert.delete', args: { __target: inds[0].id } }
  }
  // pause / resume is the INDICATOR alert's switch; a price alert has none (the product: delete only) — said, never emulated
  if (!inds.length && prices.length) {
    return { say: `Price alerts can't be paused or switched ${off ? 'off' : 'on'} in UCT — they go off once, and the only other thing they can do is be deleted (permanently). Nothing changed. Say “delete ${prices.length > 1 ? 'those alerts' : 'that alert'}” if you want ${prices.length > 1 ? 'them' : 'it'} gone.` }
  }
  if (plural || inds.length !== 1 || prices.length) return null
  return { action: 'indicatorAlert.toggle', args: { active: !!on, __target: inds[0].id } }
}

/**
 * The one reading of an alert sentence: { action, args } (args may carry `__target`), { say } (fixed words, no op), or null.
 * `whole`: the reader is seeing the member's WHOLE sentence (fastWhole), not one clause of it.
 */
export function readAlertWords({ raw, lower, host, typed }) {
  // ⛔ WHOLE SENTENCES ONLY: a clause of a longer request ("…, and alert me if it drops below 140") is the model's — the clause
  // splitter has already lifted chart words ("on the top-left chart") off it, so what it points at is no longer known here
  const whole = String(raw || '').trim() === String(typed || raw || '').trim()
  if (!whole) return null
  const ctx = { raw: String(raw || ''), lower: String(lower || ''), host, whole, text: lc(lower) }
  try {
    return readList(ctx) || readBook(ctx) || readCreate(ctx)
  } catch { return null }
}
/** A capability's `fast` for its own share of the reading (and, for `sayer`, the reading's fixed words). */
export function alertFast(name, { sayer = false } = {}) {
  return (fctx) => {
    const r = readAlertWords(fctx)
    if (!r) return null
    if (r.say) return sayer ? { __say: r.say } : null
    if (r.action !== name) return null
    // an indicator alert is planned on the board it was read from (the context build notes the host the same way)
    if (/^indicatorAlert\./.test(name)) { try { getTargetKind('indicatorAlertLibrary')?.noteHost?.(fctx.host) } catch { /* the check refuses a missing instance */ } }
    return { ...r.args }
  }
}
