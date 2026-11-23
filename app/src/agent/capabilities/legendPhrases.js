// ── CHART LEGEND family: the GENERAL readers of a member's legend / status-line / header wording — no model call ───────
//
// The instant path for the on-chart legend, written as phrase CLASSES (verb × place × field), never sentences. Each reader
// takes the canonical clause (`fastPath.canon`) and returns ONE existing capability's args, or null (→ the model, as
// before). Three places, each with the product's own catalog of what it can print:
//
//   LEGEND     the on-chart OHLC legend ("legend", "status line", "OHLC legend", "data legend") — its MODE
//              (Chart Settings → Header & legend → Legend: always | hold | off, `header.legendMode`)
//   BAR INFO   which readings of the candle the legend strip prints (`header.barInfo`, BAR_INFO_FIELDS: date, O/H/L/C,
//              net change, % change). The place words are the legend's own plus "bar info" / "OHLC strip" / "readout".
//   INFO ROW   the stats beside the ticker (`header.fields`, the Chart Settings stat picker's catalog: HEADER_STATS)
//
// ⛔ READ ONLY. Nothing here writes or decides whether a value is allowed: the args go through chart.setSetting's own
// check → the product's writer (ChartSettingsModal's setHeader / withBarInfoField / headerStatTogglePatch) → receipt →
// exact Undo, exactly as a model plan does.
// ⛔ ONE READING. A field word that fits two fields ("change", "chg"), names an indicator ("rsi" — "show the rsi value in
// the header" is the Indicators-owned info value, C1-100), or names Volume in the legend (a PLOT, not a bar reading:
// barInfoFields.js) is not read here; the model hears it.

import { BAR_INFO_FIELDS } from '../../components/chart/barInfoFields'
import { HEADER_STATS } from '../../components/chart/headerStatCatalog'
import { subjectOf } from './indicatorPhrases'

const lc = (s) => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ')
const norm = (s) => lc(s).replace(/[^a-z0-9%$]+/g, ' ').replace(/\s+/g, ' ').trim()
const DET = '(?:the |my |this |that |a |an )?'

// ── PLACES ──
// the legend itself (its mode and its fields)
const LEGEND = '(?:(?:chart|ohlc|ohlcv|price|data|bar|candle|candlestick) )?(?:legend|status line)'
// where the bar's readings print: the legend's words, and the strip's own names
const BARINFO = `(?:${LEGEND}(?: strip| readout| box)?|bar info(?: strip| readout)?|bar readout|bar data|ohlc (?:strip|readout|values strip|bar)|(?:candle|price) readout|readout)`
// the stats beside the ticker
const INFOROW = '(?:(?:chart )?header(?: stats?| row| strip| bar| info| line)?|info row|info bar|stats? (?:row|strip|bar|line)|stats (?:beside|next to|by) the (?:ticker|symbol))'

// ── LEGEND MODE (C1-064) ──
const OFF_WORD = '(?:off|hidden|hide|never|none|nothing|no legend)'
const ALWAYS_WORD = '(?:always(?: on| visible| shown| show)?|on|visible|shown|show(?:ing)?|permanent|pinned)'
const HOLD_WORD = '(?:(?:press(?:[- ](?:and[- ])?| to )|click(?:[- ](?:and[- ])?| to )|tap(?:[- ](?:and[- ])?| to ))?hold(?: to (?:show|peek|see))?|on hold|hold mode|peek(?: on hold)?|press to peek|show on hold|long[- ]press)'
const HOLD_WHEN = '(?:when|while|if|only when|only while) (?:i |you )?(?:press[- ](?:and[- ])?hold|click[- ](?:and[- ])?hold|tap[- ](?:and[- ])?hold|long[- ]press|hold(?: down)?|press(?: down)?|keep (?:the mouse |my finger )?(?:pressed|down))(?: (?:on|down on) the chart| the mouse(?: button)?| down)?'
const MODE_RULES = [
  // hold — first: "show the legend only when I hold" would otherwise read as plain "show the legend"
  [new RegExp(`^(?:only )?(?:show|display|reveal|see) ${DET}${LEGEND} (?:only )?${HOLD_WHEN}$`), 'hold'],
  [new RegExp(`^(?:hide|clean up|keep) ${DET}${LEGEND}(?: hidden| off| away)? (?:until|unless) (?:i |you )?(?:press[- ](?:and[- ])?hold|hold(?: down)?|press)(?: on the chart)?$`), 'hold'],
  [new RegExp(`^(?:set|switch|change|make|put|turn) ${DET}${LEGEND}(?: mode)? (?:to |on |into )?(?:a |the )?${HOLD_WORD}(?: mode)?$`), 'hold'],
  [new RegExp(`^${DET}${LEGEND}(?: mode)? (?:to |on )?${HOLD_WORD}(?: mode| only)?$`), 'hold'],
  [new RegExp(`^(?:peek at|peek) ${DET}${LEGEND} (?:on|when i) (?:press(?:[- ](?:and[- ])?hold)?|hold)$`), 'hold'],
  // always
  [new RegExp(`^(?:always show|always display|keep showing|always keep) ${DET}${LEGEND}(?: on| visible| up)?$`), 'always'],
  // ("… all the time" / "at all times" never reach here: the fast path reads "all" as every chart — fastPath ALL_RE)
  [new RegExp(`^(?:keep|leave) ${DET}${LEGEND} (?:on|visible|showing|shown|up|open)(?: always| permanently)?$`), 'always'],
  [new RegExp(`^(?:show|display) ${DET}${LEGEND} (?:always|permanently)$`), 'always'],
  [new RegExp(`^(?:set|switch|change|make|put|turn) ${DET}${LEGEND}(?: mode)? (?:to )?(?:always(?: on| visible| shown| show)?|visible|shown|permanent|pinned)$`), 'always'],
  [new RegExp(`^(?:show|unhide|turn on|switch on|enable|bring back|restore|display|reveal)(?: back)? ${DET}${LEGEND}(?: again| back)?$`), 'always'],
  [new RegExp(`^(?:turn|switch|put) ${DET}${LEGEND} (?:back )?on(?: again)?$`), 'always'],
  [new RegExp(`^${DET}${LEGEND} (?:back )?(?:always on|on)$`), 'always'],
  // off
  [new RegExp(`^(?:hide|remove|turn off|switch off|disable|kill|close|clear|lose|ditch|drop) ${DET}${LEGEND}(?: completely| entirely| altogether| for good)?$`), 'off'],
  [new RegExp(`^(?:turn|switch) ${DET}${LEGEND} off(?: completely)?$`), 'off'],
  [new RegExp(`^(?:don'?t|do not|never|stop) (?:show|showing|display|displaying) ${DET}${LEGEND}(?: anymore| any more| at all)?$`), 'off'],
  [new RegExp(`^(?:no|without(?: a| the)?) ${LEGEND}$`), 'off'],
  [new RegExp(`^(?:set|switch|change|make|put|turn) ${DET}${LEGEND}(?: mode)? (?:to )?${OFF_WORD}$`), 'off'],
  [new RegExp(`^${DET}${LEGEND} off$`), 'off'],
]
// ALWAYS_WORD is kept for the generated tests (the place words and value words they combine)
export const LEGEND_MODE_WORDS = Object.freeze({ legend: LEGEND, always: ALWAYS_WORD, hold: HOLD_WORD, off: OFF_WORD })

/** "only show the legend when I hold", "always show the status line", "hide the ohlc legend" → header.legendMode. */
export function legendModeOfWords(lower) {
  const s = lc(lower).replace(/[.!?]+$/, '')
  for (const [re, value] of MODE_RULES) if (re.test(s)) return { setting: 'header.legendMode', value }
  return null
}

// ── FIELDS ──
// every field word a member uses for a bar reading → its BAR_INFO_FIELDS id ("change" / "chg" alone fit two: not here)
const BAR_SYNONYMS = {
  date: ['date', 'the date', 'bar date', 'time', 'bar time', 'timestamp', 'date stamp', 'time stamp'],
  open: ['open', 'open price', 'opening price', 'the open', 'opens', 'o'],
  high: ['high', 'high price', 'the high', 'highs', 'bar high', 'h'],
  low: ['low', 'low price', 'the low', 'lows', 'bar low', 'l'],
  close: ['close', 'close price', 'closing price', 'the close', 'last', 'last price', 'closes', 'c'],
  change: ['net change', 'net chg', 'point change', 'points change', 'dollar change', '$ change', '$change', 'change in dollars', 'price change', 'change in points'],
  changePct: ['percent change', '% change', '%change', '% chg', '%chg', 'pct change', 'pct chg', 'percentage change', 'change percent', 'change %', 'change in percent', 'percent', 'percentage', 'chg %'],
}
const BAR_WORD = new Map()
for (const f of BAR_INFO_FIELDS) {
  // (the id "change" is also the bare word, which fits Net Chg and % Chg alike: only the label and the synonyms name it)
  for (const w of [...(f.id === 'change' ? [] : [f.id]), f.label, ...(BAR_SYNONYMS[f.id] || [])]) BAR_WORD.set(norm(w), f.id)
}
/** A bar-info field's id from the member's word for it, or null (unknown, or a word that fits two). */
export function barInfoFieldOf(words) {
  const w = norm(String(words || '').replace(/^(?:the|its|my) /, ''))
  if (!w) return null
  return BAR_WORD.get(w) || BAR_WORD.get(w.replace(/ (?:value|values|price|reading|number|figure)s?$/, '')) || null
}

// every word the Chart Settings stat picker shows for a stat (its key, label, short label), plus the words traders use
const STAT_SYNONYMS = {
  mcap: ['market cap', 'mkt cap', 'market capitalization', 'marketcap', 'cap'], earn: ['earnings', 'next earnings', 'earnings date', 'next earnings date', 'the earnings date'],
  rvol: ['relative volume', 'rel vol', 'rel volume'], dolvol: ['dollar volume', '$ volume', 'dollar vol', '$vol'], name: ['company name', 'company', 'the company name', 'name'],
  ipoDate: ['ipo', 'ipo date', 'listing date'], chg: ['percent change', '% change', 'pct change', 'percentage change'], dchg: ['dollar change', '$ change', 'point change'],
  vol: ['volume', 'todays volume', 'today\'s volume', 'day volume'], price: ['price', 'last price', 'current price'], adr: ['adr', 'adr %', 'average daily range'],
  dcr: ['dcr', 'closing range', 'daily closing range'], float: ['float', 'the float', 'share float'], shortf: ['short float', 'short % of float', 'short percent of float'],
  shortr: ['days to cover', 'short ratio'], h52: ['% from 52 week high', 'distance from the 52 week high', '52 week high distance'], l52: ['% from 52 week low'],
  avgvol: ['average volume', 'avg volume', 'avg vol'], avgdv: ['average dollar volume', 'avg dollar volume', 'avg $ volume'], rsrank: ['rs rank', 'rs rating', 'relative strength rank'],
  consensus: ['analyst consensus', 'analyst rating'], ptup: ['price target upside', 'target upside', 'upside to target'], pe: ['pe', 'p e', 'pe ratio', 'p/e ratio', 'price to earnings'],
  pefwd: ['forward pe', 'forward p e', 'forward p/e'], ps: ['price to sales', 'p s', 'ps ratio'], divy: ['dividend yield', 'dividend', 'yield'], beta: ['beta'],
  sector: ['sector'], industry: ['industry', 'group', 'industry group'], theme: ['theme', 'uct theme'], ytd: ['ytd', 'ytd %', 'year to date', 'ytd performance'],
  perf5d: ['5 day change', '5d change', 'weekly change', '5 day performance'], perf30d: ['30 day change', '30d change', 'monthly change', '30 day performance'],
  perf60d: ['60 day change', '60d change'], perf90d: ['90 day change', '90d change'], dte: ['days to earnings', 'days until earnings'], gap: ['gap', 'gap %', 'the gap'],
}
const STAT_WORD = new Map()
const STAT_CLASH = new Set()
const addStatWord = (w, key) => {
  const n = norm(w)
  if (!n) return
  if (STAT_WORD.has(n) && STAT_WORD.get(n) !== key) STAT_CLASH.add(n)
  else STAT_WORD.set(n, key)
}
for (const s of HEADER_STATS) {
  addStatWord(s.key, s.key); addStatWord(s.label, s.key); if (s.short && s.short !== s.label) addStatWord(s.short, s.key)
}
for (const [key, words] of Object.entries(STAT_SYNONYMS)) if (HEADER_STATS.some(s => s.key === key)) for (const w of words) addStatWord(w, key)
for (const w of STAT_CLASH) STAT_WORD.delete(w)
/** A header stat's key from the member's word for it, or null (unknown, two stats, or an indicator's name). */
export function infoRowStatOf(words) {
  const raw = String(words || '').replace(/^(?:the|its|my) /, '')
  const w = norm(raw)
  if (!w) return null
  const key = STAT_WORD.get(w) || STAT_WORD.get(w.replace(/ (?:stat|field|number|figure|value)s?$/, '')) || null
  if (!key) return null
  // "rsi" / "rs line" name an indicator too: "show the rsi in the header" may be its value (the Indicators-owned info value)
  const bare = raw.replace(/ (?:stat|field|number|figure|value|reading)s?$/i, '')
  let ind = null
  try { ind = subjectOf(raw) || subjectOf(bare) } catch { ind = null }
  return ind ? null : key
}

// ── one member of a list, by verb × field × place ──
const ADD_VERB = '(?:show|add|include|display|put|bring back|restore|turn on|enable|stick|place|insert|pin)'
const REM_VERB = '(?:hide|remove|drop|exclude|turn off|disable|take out|leave out|lose|ditch|clear|delete|kill|strip)'
function listMemberOf(lower, place, fieldOf) {
  const s = lc(lower).replace(/[.!?]+$/, '')
  const rules = [
    [new RegExp(`^${ADD_VERB}(?: back)? (.+?) (?:back )?(?:in|to|on|into|onto|inside|up in|up on) ${DET}${place}(?: again| back| too| as well)?$`), true],
    [new RegExp(`^(?:i want|i'?d like|give me|let me see) (.+?) (?:in|on) ${DET}${place}$`), true],
    [new RegExp(`^${DET}${place} should (?:show|include|have|display) (.+)$`), true, 1],
    [new RegExp(`^${REM_VERB} (.+?) (?:from|in|on|off|out of|off of) ${DET}${place}$`), false],
    [new RegExp(`^(?:take|get|pull|keep) (.+?) (?:out of|off|off of|away from) ${DET}${place}$`), false],
    [new RegExp(`^(?:don'?t|do not|stop|no need to|never) (?:show|showing|display|displaying|include|including|put|putting) (.+?) (?:in|on) ${DET}${place}(?: anymore| any more| at all)?$`), false],
    [new RegExp(`^(?:no|without) (.+?) (?:in|on) ${DET}${place}$`), false],
    [new RegExp(`^i (?:don'?t|do not) (?:need|want|care about|use) (.+?) (?:in|on) ${DET}${place}(?: anymore| any more)?$`), false],
  ]
  for (const [re, on] of rules) {
    const m = re.exec(s)
    if (!m) continue
    const id = fieldOf(m[1])
    if (id) return { id, on }
    return null
  }
  return null
}

/** "hide the open in the legend", "show the % change in the bar info", "remove the date from the status line" → header.barInfo. */
export function barInfoOfWords(lower) {
  const r = listMemberOf(lower, BARINFO, barInfoFieldOf)
  return r ? { setting: 'header.barInfo', value: `${r.on ? '+' : '-'}${r.id}` } : null
}
/** "add market cap to the header", "take rvol off the info row", "show the float beside the ticker" → header.fields. */
export function infoRowOfWords(lower) {
  const s = lc(lower)
  // "show the stats beside the ticker" (the place, not a member) and the title's own "day change" are not members here
  const r = listMemberOf(s, INFOROW, infoRowStatOf)
  return r ? { setting: 'header.fields', value: `${r.on ? '+' : '-'}${r.id}` } : null
}

/** chart.setSetting's legend readers, in one call: the mode, a bar-info field, an info-row stat. */
export function legendSettingOfWords(lower) {
  return legendModeOfWords(lower) || barInfoOfWords(lower) || infoRowOfWords(lower)
}

// the generated tests read the place words this module claims
export const LEGEND_PLACES = Object.freeze({ legend: LEGEND, barInfo: BARINFO, infoRow: INFOROW })
