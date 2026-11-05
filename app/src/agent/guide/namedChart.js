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

import { ordinalChart } from '../deixis'
import { readIndicator } from './slots'

const POSITION = /\b(?:the\s+)?((?:top|bottom|upper|lower)[- ]?(?:left|right)|left|right|top|bottom|upper|lower)(?:[- ]hand)?(?:[- ]side)?\s+(?:chart|cell|one)\b/i
const TF_CHART = /\b(?:the|my)\s+(\d{1,3}[- ]?(?:m|min|mins|minute|minutes|h|hr|hour|hours)|1h|hourly|daily|weekly|monthly)\s+chart\b/i
// "the TSLA chart", "my nvda chart", "the BRK.B chart", "the Nvidia chart": "how can I chart" has no "the" and is not one, and
// nor is a chart's own feature ("the UCT chart theme")
const WORD_CHART = /\b(?:the|my)\s+([a-z0-9][a-z0-9.-]*)\s+chart\b(?!\s+(?:themes?|templates?|settings?|types?|grid|tabs?))/gi
const BARE_TICKER = /\b(?:to|on|for|in)\s+(?:the\s+)?([A-Z][A-Z.-]{0,6})\b(?!\s+charts?\b)/g
// what comes between "the" and "chart" without naming one
const NOT_A_NAME = new Set(`uct price main whole entire current selected active other same big small new old next previous multi
  line bar bars candle candlestick area hollow baseline heikin stock ticker symbol linked focused clicked empty live own grid
  first second third fourth fifth sixth last middle center centre left right top bottom upper lower`.split(/\s+/))
const listOf = (charts) => charts.map(c => c.label).join(', ')

const TF_WORDS = { hourly: '60', '1h': '60', daily: 'D', weekly: 'W', monthly: 'M' }
function tfCode(word) {
  const w = word.toLowerCase().replace('-', ' ')
  if (TF_WORDS[w]) return TF_WORDS[w]
  const m = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/.exec(w)
  return m ? String(/^h/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1])) : null
}
const sameSymbol = (c, word) => String(c.symbol || '').toUpperCase() === word.toUpperCase()
const atPosition = (c, word) => {
  const parts = word.toLowerCase().replace('upper', 'top').replace('lower', 'bottom').match(/top|bottom|left|right/g) || []
  return !!c.position && parts.every(p => c.position.split('-').includes(p))
}

/** → { chart } | { say } | null (the words name no chart: the clicked one stands). */
export function namedChart(words, charts = []) {
  const s = String(words || '')
  if (!s || charts.length === 0) return null
  const names = new Set()
  const ord = ordinalChart(s, charts)
  if (ord && /chart/i.test(ord.match[0])) {
    if (ord.ask) return { say: `${ord.ask.text} ${listOf(charts)}.` }
    names.add(ord.ref)
  }
  const pos = POSITION.exec(s)
  if (pos && charts.length > 1) {
    const hits = charts.filter(c => atPosition(c, pos[1]))
    if (hits.length !== 1) return { say: `I can’t tell which chart is the ${pos[1].toLowerCase()} one here. Your charts are: ${listOf(charts)}.` }
    names.add(hits[0].ref)
  }
  const tf = TF_CHART.exec(s)
  if (tf) {
    const code = tfCode(tf[1])
    const hits = charts.filter(c => String(c.tf) === code)
    if (hits.length > 1) return { say: `More than one chart fits ${tf[1]}. Which one do you mean: ${listOf(hits)}?` }
    if (!hits.length) return { say: `No chart on this board is on ${tf[1]}, so I can’t show that on it. Your charts are: ${listOf(charts)}.` }
    names.add(hits[0].ref)
  }
  for (const m of s.matchAll(WORD_CHART)) {
    const word = m[1]
    if (NOT_A_NAME.has(word.toLowerCase()) || tfCode(word) || readIndicator(word)) continue
    const hits = charts.filter(c => sameSymbol(c, word))
    if (hits.length > 1) return { say: `More than one chart shows ${word.toUpperCase()}. Which one do you mean: ${listOf(hits)}?` }
    if (!hits.length) {
      return { say: word === word.toUpperCase()
        ? `There’s no ${word} chart on this board, so I can’t show that on it. Your charts are: ${listOf(charts)}.`
        : `I can’t match “${word}” to a chart on this board. Your charts are: ${listOf(charts)}. Ask again with its ticker or its position.` }
    }
    names.add(hits[0].ref)
  }
  for (const m of s.matchAll(BARE_TICKER)) {
    const hits = charts.filter(c => sameSymbol(c, m[1]))
    if (hits.length === 1) names.add(hits[0].ref)
  }
  if (names.size > 1) return { say: `You named more than one chart. Ask about one of them: ${listOf(charts.filter(c => names.has(c.ref)))}.` }
  return names.size ? { chart: charts.find(c => names.has(c.ref)) } : null
}

/** Do these words name a chart at all (so they must reach `namedChart`)? */
export const namesAChart = (words, charts = []) => !!namedChart(words, charts)
