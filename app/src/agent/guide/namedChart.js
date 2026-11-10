// ── UCT Agent PRODUCT GUIDE: the chart a request names ──────────────────────────────────────────────────────
//
// "how would I add bollinger bands to the NVDA chart?", "how do I change the timeframe on the left chart?". A walkthrough
// takes its chart from the words first, the clicked chart second.
//
// ⛔ ONLY A REFERENCE TO A CHART COUNTS. How-to sentences are full of words that look like one: "the right-click menu", "the
// price scale to the left", "the bottom pane", "hide all indicators" (with ALL on the board). So a position needs chart, cell
// or one after it, a word needs "the … chart" around it, and a bare ticker needs capitals and a preposition.
//
// ⛔ A CHART THE WORDS NAME AND THE BOARD DOES NOT HOLD IS SAID, never swapped for another: walking the wrong chart looks
// exactly like walking the right one. Nothing here is a phrase rule: it only reads which chart, once a walkthrough is chosen.
// ⭐ ONE CHART IS THE EXCEPTION: there is nothing to choose, so it walks there, and says so when the words named another.

import { ordinalChart, relativeChart, negatedPointer, saysOtherChart } from '../deixis'
import { readIndicator } from './slots'

const POSITION = /\b(?:the\s+)?((?:top|bottom|upper|lower)[- ]?(?:left|right)|left|right|top|bottom|upper|lower)(?:[- ]hand)?(?:[- ]side)?\s+(?:chart|cell|one)\b/i
const TF_CHART = /\b(?:the|my|this|that)\s+(\d{1,3}[- ]?(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|days?|weeks?|months?)|[1]?[dwm]|hourly|daily|weekly|monthly|day|week|month)\s+chart\b/i
// "the TSLA chart", "my nvda chart", "the BRK.B chart", "the Nvidia chart": "how can I chart" has no "the" and is not one, and
// nor is a chart's own feature ("the UCT chart theme")
const WORD_CHART = /\b(?:the|my|this|that)\s+([a-z0-9][a-z0-9.-]*)\s+chart\b(?!\s+(?:themes?|templates?|settings?|types?|grid|tabs?))/gi
const BARE_TICKER = /\b(?:to|on|for|in)\s+(?:the\s+)?([A-Z][A-Z.-]{0,6})\b(?!\s+charts?\b)/g
// "add rsi to nvda": the same place, typed in lowercase. Three letters or more, and only ever a question
const BARE_LOWER = /\b(?:to|on|for|in)\s+(?:the\s+)?([a-z][a-z.-]{2,6})\b(?!\s+charts?\b)/g
// a length of time, as a member says it or as a range button reads: unless a chart here is on it, it is the range buttons'
const SPAN = /^\d+[- ]?(?:days?|weeks?|months?)$|^(?:3|6|12)M$/i
// what comes between "the" and "chart" without naming one, by class. Add a class or a word here: never a sentence
const NOT_A_NAME = new Set([
  // how it is drawn
  'line lines bar bars candle candles candlestick candlesticks hollow hlc ohlc ha heikin ashi heikin-ashi area mountain baseline renko kagi step',
  // its scale
  'log logarithmic linear arithmetic arith percent percentage pct inverted invert auto semi-log',
  // its session
  'intraday premarket pre-market postmarket post-market extended regular rth eth overnight hours session after-hours afterhours live realtime historical replay',
  // which one, without saying which
  'default original standard normal usual clean blank empty saved shared main primary secondary whole entire full current active selected focused clicked linked same other another next previous new old big small large wide narrow favourite favorite only one actual real',
  // the product's own words
  'uct multi grid price stock ticker symbol volume breadth market time timeframe trading own drawing indicator watchlist news dark light fullscreen full-screen',
  // keys and files: "set it to ALT", "export to CSV"
  'key keys file files alt ctrl shift esc enter tab pdf csv png',
  // words of a market or a sentence that are also tickers: "on ALL my charts", "set alerts for EOD"
  'all any low high now open close here am pm et est eod etf eps ipo usd us ai',
  // an exchange, a clock or a report in capitals: "switch to NYSE", "set it to UTC", "show me CPI on the calendar"
  'nyse nasdaq amex otc utc gmt cst pst mst fomc cpi ppi pce gdp',
  // an order or a place: an ordinal and a position are read on their own
  'first second third fourth fifth sixth last middle center centre left right top bottom upper lower',
].join(' ').split(' '))
const isNotAName = (word) => { const w = word.toLowerCase(); return NOT_A_NAME.has(w) || NOT_A_NAME.has(w.replace(/s$/, '')) }
// could this word be a chart's name at all? Tickers have letters; a timeframe or an indicator between "the" and "chart" is neither
const couldName = (word) => /[a-z]/i.test(word) && !isNotAName(word) && !tfCode(word) && !readIndicator(word)
// ⛔ a bare word carries no "chart" to say it means one, so only a ticker's shape counts: capitals, up to five letters, perhaps
// dotted (BRK.B). "switch to Renko" and "on MONDAY" are not that shape. One letter alone is a key or a scale more often than not
const TICKER_SHAPE = /^[A-Z]{2,5}(?:\.[A-Z]{1,2})?$/
const bareName = (word) => TICKER_SHAPE.test(word) && couldName(word)
const listOf = (charts) => charts.map(c => c.label).join(', ')

const TF_WORDS = { hourly: '60', daily: 'D', day: 'D', weekly: 'W', week: 'W', monthly: 'M', month: 'M' }
// the product's own labels too: 1D, 1W, and 1M for a month while 1m is a minute (ChartTfBar), so 1M keeps its case
function tfCode(word) {
  const raw = String(word)
  if (/^1?M$/.test(raw)) return 'M'
  if (/^(?:3|6|12)M$/.test(raw)) return raw
  if (/^1?d$/i.test(raw)) return 'D'
  if (/^1?w$/i.test(raw)) return 'W'
  const w = raw.toLowerCase().replace('-', ' ')
  if (TF_WORDS[w]) return TF_WORDS[w]
  const long = /^(\d+)\s*(day|week|month)s?$/.exec(w)
  if (long) return `${long[1] === '1' ? '' : long[1]}${long[2][0].toUpperCase()}`
  const m = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(w)
  return m ? String(/^h/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1])) : null
}
// HA, D, LINE: a word in capitals that a chart here really shows is that ticker, whatever else the word can mean
const onBoard = (word, charts) => word === word.toUpperCase() && charts.some(c => sameSymbol(c, word))
const chartTf = (c) => String(c.tf).replace(/^1([DWM])$/i, '$1').toUpperCase()
const sameSymbol = (c, word) => String(c.symbol || '').toUpperCase() === word.toUpperCase()
const atPosition = (c, word) => {
  const parts = word.toLowerCase().replace('upper', 'top').replace('lower', 'bottom').match(/top|bottom|left|right/g) || []
  return !!c.position && parts.every(p => c.position.split('-').includes(p))
}

// ⛔ the same test as a refusal on a bigger board: a word that survives the classes above names a chart. A timeframe, a position
// and a chart type are about the chart that is here. The note is true whatever the word was, and it only ever adds a sentence
function namesAnother(s, only) {
  const ord = ordinalChart(s, [only])
  if (ord?.ask && /chart/i.test(ord.match[0]) && !/middle|cent(?:er|re)/i.test(ord.match[0])) return true
  const other = (word) => !sameSymbol(only, word) && couldName(word)
  for (const m of s.matchAll(WORD_CHART)) if (other(m[1])) return true
  for (const m of s.matchAll(BARE_TICKER)) if (!sameSymbol(only, m[1]) && bareName(m[1])) return true
  return false
}
const absent = (word, charts) => `There’s no ${word} chart on this board, so I can’t show that on it. Your charts are: ${listOf(charts)}.`
const onlyNote = (c) => `This board only has ${c.symbol || 'one chart'}, so I’ll show it there.`

/** → { chart, note? } | { say } | null (the words name no chart: the clicked one stands). `sel`: the clicked chart's ref. */
export function namedChart(words, charts = [], sel = null) {
  const s = String(words || '')
  if (!s || !charts.length) return null
  // one chart: nothing to choose between, and nothing to refuse
  if (charts.length === 1) return namesAnother(s, charts[0]) ? { chart: charts[0], note: onlyNote(charts[0]) } : null
  const names = new Set()
  // ⭐ AUDIT T1 (2026-11-07): a chart named RELATIVE to the clicked one ("the chart below this one"), or the click NEGATED ("every
  // chart except this one"). Read by deixis.js's own detector, the one execution uses: ONE authority over which chart the words
  // mean (agentGuideRelational.test.jsx proves they agree). The click is the anchor there, never the chart meant.
  const clicked = sel ? charts.find(c => c.ref === sel) : null
  const others = clicked ? charts.filter(c => c !== clicked) : charts
  const rel = relativeChart(s, charts, sel)
  if (rel) {
    const where = rel.match[0].trim()
    if (rel.negated) return { say: `A walkthrough shows one chart at a time, and you asked to leave out the chart ${where}. Which one do you mean: ${listOf(charts.filter(c => !rel.excluded.includes(c)))}?` }
    if (rel.alsoClick) return { say: `You named this chart and the one ${where}. Which one do you mean: ${listOf(charts)}?` }
    if (!clicked) return { say: `Which chart is it relative to? Click that chart first, or ask about one by name: ${listOf(charts)}.` }
    if (!rel.hits.length) return { say: `There’s no chart ${where} here. Your charts are: ${listOf(charts)}.` }
    if (rel.hits.length > 1) return { say: `More than one chart is ${where}. Which one do you mean: ${listOf(rel.hits)}?` }
    names.add(rel.hits[0].ref)
  } else if (saysOtherChart(s)) {
    // "the other chart": one chart only on a board of two (the one not clicked); with more, it fits several — asked
    if (charts.length === 2 && clicked) names.add(others[0].ref)
    else return { say: `Which other chart do you mean: ${listOf(others)}?` }
  } else if (negatedPointer(s)) {
    // never the click: the walkthrough is about one chart, and the member left this one out. Exactly one left → that one
    if (clicked && others.length === 1) names.add(others[0].ref)
    else return { say: `A walkthrough shows one chart at a time, and you left out the one you clicked. Which one do you mean: ${listOf(others)}?` }
  }
  const ord = ordinalChart(s, charts)
  if (ord && /chart/i.test(ord.match[0])) {
    if (ord.ask) return { say: `${ord.ask.text} ${listOf(charts)}.` }
    names.add(ord.ref)
  }
  const pos = POSITION.exec(s)
  if (pos) {
    const hits = charts.filter(c => atPosition(c, pos[1]))
    if (hits.length !== 1) return { say: `I can’t tell which chart is the ${pos[1].toLowerCase()} one here. Your charts are: ${listOf(charts)}.` }
    names.add(hits[0].ref)
  }
  const tf = TF_CHART.exec(s)
  const code = tf && !onBoard(tf[1], charts) ? tfCode(tf[1]) : null
  // 3M is three months on a board that reads it so, and three minutes on one that reads 3
  const hits = code ? charts.filter(c => [code.toUpperCase(), /^(\d+)M$/.exec(code)?.[1]].includes(chartTf(c))) : []
  if (code && (hits.length || !SPAN.test(tf[1]))) {
    if (hits.length > 1) return { say: `More than one chart fits ${tf[1]}. Which one do you mean: ${listOf(hits)}?` }
    if (!hits.length) return { say: `No chart on this board is on ${tf[1]}, so I can’t show that on it. Your charts are: ${listOf(charts)}.` }
    names.add(hits[0].ref)
  }
  for (const m of s.matchAll(WORD_CHART)) {
    const word = m[1]
    if (!onBoard(word, charts) && !couldName(word)) continue
    const hits = charts.filter(c => sameSymbol(c, word))
    if (hits.length > 1) return { say: `More than one chart shows ${word.toUpperCase()}. Which one do you mean: ${listOf(hits)}?` }
    if (!hits.length) {
      return { say: word === word.toUpperCase()
        ? absent(word, charts)
        : `I can’t match “${word}” to a chart on this board. Your charts are: ${listOf(charts)}. Ask again with its ticker or its position.` }
    }
    names.add(hits[0].ref)
  }
  for (const m of s.matchAll(BARE_TICKER)) {
    const hits = charts.filter(c => sameSymbol(c, m[1]))
    if (hits.length === 1) names.add(hits[0].ref)
  }
  // nothing on this board answers: a bare name is said too, never walked on the clicked chart
  if (!names.size) {
    for (const m of s.matchAll(BARE_TICKER)) {
      if (!charts.some(c => sameSymbol(c, m[1])) && bareName(m[1])) return { say: absent(m[1], charts) }
    }
    for (const m of s.matchAll(BARE_LOWER)) {
      const hit = charts.find(c => sameSymbol(c, m[1]))
      if (hit && couldName(m[1])) return { say: `Did you mean the ${String(hit.symbol).toUpperCase()} chart?` }
    }
  }
  if (names.size > 1) return { say: `You named more than one chart. Ask about one of them: ${listOf(charts.filter(c => names.has(c.ref)))}.` }
  return names.size ? { chart: charts.find(c => names.has(c.ref)) } : null
}

/** Do these words name a chart at all (so they must reach `namedChart`)? */
export const namesAChart = (words, charts = [], sel = null) => !!namedChart(words, charts, sel)
