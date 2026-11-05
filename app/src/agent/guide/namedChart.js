// ── UCT Agent PRODUCT GUIDE: the chart a request names ──────────────────────────────────────────────────────
//
// "how would I add bollinger bands to the NVDA chart?", "how do I change the timeframe on the left chart?". A walkthrough
// takes its chart from the words first, the clicked chart second. The words are read by the same deixis the planner uses
// (agent/deixis.js), so "the second chart", a position, a symbol and "the 5 minute chart" mean what they mean everywhere.
//
// ⛔ A CHART THE WORDS NAME AND THE BOARD DOES NOT HOLD IS SAID, never swapped for another: walking the wrong chart looks
// exactly like walking the right one. Nothing here is a phrase rule: it only reads which chart, once a walkthrough is chosen.

import { chartQualifier, chartsNamedBy, ordinalChart } from '../deixis'

const POSITION = /\b((?:top|bottom|upper|lower)[- ]?(?:left|right)|left|right|top|bottom|upper|lower)(?: hand)?(?:[- ]side)? (?:chart|cell|one)\b/i
// "the TSLA chart", but not a chart's own feature ("the UCT chart theme") or a study ("the RSI chart template")
const TICKER_CHART = /\b(?:the\s+)?(?!UCT\b)([A-Z]{1,5})\s+chart\b(?!\s+(?:themes?|templates?|settings?|types?))/
const listOf = (charts) => charts.map(c => c.label).join(', ')

/** → { chart } | { say } | null (the words name no chart: the clicked one stands). */
export function namedChart(words, charts = []) {
  const s = String(words || '')
  if (!s || charts.length === 0) return null
  const ord = ordinalChart(s, charts)
  if (ord?.ask) return { say: `${ord.ask.text} ${listOf(charts)}.` }
  const named = chartsNamedBy(s, charts)
  if (named.size === 1) return { chart: charts.find(c => named.has(c.ref)) }
  if (named.size > 1) return { say: `You named more than one chart. Ask about one of them: ${listOf(charts.filter(c => named.has(c.ref)))}.` }
  const q = chartQualifier(s, charts)
  if (q?.hits.length === 1) return { chart: q.hits[0] }
  if (q?.hits.length > 1) return { say: `More than one chart fits ${q.word}. Which one do you mean: ${listOf(q.hits)}?` }
  const pos = POSITION.exec(s)
  if (pos && charts.length > 1) return { say: `I can’t tell which chart is the ${pos[1].toLowerCase()} one here. Your charts are: ${listOf(charts)}.` }
  const tick = TICKER_CHART.exec(s)
  if (tick && charts.length > 0) return { say: `There’s no ${tick[1]} chart on this board, so I can’t show that on it. Your charts are: ${listOf(charts)}.` }
  return null
}

/** Do these words name a chart at all (so they must reach `namedChart`)? */
export const namesAChart = (words, charts = []) => !!namedChart(words, charts)
