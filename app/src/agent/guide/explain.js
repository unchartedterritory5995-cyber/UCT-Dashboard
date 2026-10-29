// ── UCT Agent PRODUCT GUIDE: EXPLAIN — teach, never change anything ─────────────────────────────────────────
//
// "What does ADR mean?", "Explain RSI", "What's the difference between a chart indicator and a condition?"
// Answered from what UCT itself says, in this order:
//   1. the INDICATOR CATALOG — every built-in indicator's own name, short name, tags and description
//      (components/chart/indicatorCatalog → nativeRegistry). "ADR" is ADR %'s tag; "RSI" is its short name.
//   2. a few UCT CONCEPTS that are not an indicator (below) — each worded from the product's own behaviour,
//      with the file that behaviour lives in named beside it.
//   3. a guide FEATURE's own `explain` (registry.js) — "what is a layout?"
// Anything else returns null: the model answers it (general trading knowledge), as before. Nothing here is ever a
// change to the workspace — the guide.explain capability is a query.
//
// INSTANT vs MODEL. Only UCT's OWN meanings (`local`: a UCT concept, a guide feature) are answered on the instant path.
// A general trading term ("what is an EMA?", "what is rsi") stays the model's, as the sealed NL corpus records
// (talk-01, talk-07; agentCore "all-or-nothing") — the model can still call guide.explain for UCT's catalog wording.

import { catalogRows } from '../../components/chart/indicatorCatalog'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { GUIDE_FEATURES } from './registry'

// UCT concepts — each sentence states what the product does (source in the trailing comment)
export const CONCEPTS = [
  {
    id: 'indicator-vs-condition', title: 'Chart indicator vs condition', local: true,
    words: [/\bindicators?\b.*\bconditions?\b|\bconditions?\b.*\bindicators?\b/],
    // components/chart/builder/BuilderSheet.jsx (SIGNAL presentation: a marker / candle / background where it is true)
    text: 'An indicator draws VALUES on the chart — a line or histogram such as RSI or a 20 EMA. A condition is a true/false rule built from values like those — “close crosses above the 20 EMA” — made in Create Indicator; instead of a line, UCT marks the bars where it is true (a marker, or a candle or background colour).',
  },
  {
    id: 'condition', title: 'Condition', local: true,
    words: [/^(?:a |the )?conditions?$/],
    text: 'A condition is a true/false rule — “close crosses above the 20 EMA”, “RSI below 30” — built in Create Indicator. UCT marks the bars where it is true with a marker, or a candle or background colour, instead of drawing a line.',
  },
  {
    id: 'ema-vs-sma', title: 'EMA vs SMA',
    words: [/\bema\b.*\bsma\b|\bsma\b.*\bema\b/, /\bexponential\b.*\bsimple\b|\bsimple\b.*\bexponential\b/],
    // components/chart/chartDefaults.js (the default EMA 9 / EMA 20 / SMA 50 / SMA 200)
    text: 'Both average the closes over a length. An SMA weights every bar in that length equally; an EMA weights the most recent bars more, so it turns sooner. UCT’s default charts draw the 9 and 20 as EMAs and the 50 and 200 as SMAs.',
  },
  {
    id: 'link-colours', title: 'Link colours', local: true,
    words: [/\blink(ed)? (colou?rs?|groups?)\b/, /\bcolou?r (dot|link|group)s?\b/],
    // pages/charts/WidgetHost (the colour-link dot) — widgets in one group share a symbol
    text: 'The coloured dot on a widget’s header is its link group. Widgets in the same colour share a symbol — click a ticker in a linked watchlist and every chart in that colour changes with it. “Not linked” keeps a widget on its own symbol.',
  },
]

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
// "the rsi", "an adr", "rsi indicator" → "rsi"
const core = (s) => norm(s).replace(/^(?:a|an|the|my|this|that)\s+/, '').replace(/\s+(?:indicator|study|line|mean|means|stand for|stands for|measure|measures|show|shows|do|does)$/, '').trim()

function indicatorRow(words) {
  const w = core(words)
  if (!w || w.length > 40) return null
  let rows = []
  try { rows = catalogRows(nativeRegistry) } catch { rows = [] }
  const hits = rows.filter(r => r.description && (
    norm(r.name) === w || norm(r.shortName) === w || String(r.id).toLowerCase() === w || (r.tags || []).some(t => norm(t) === w)))
  return hits.length === 1 ? hits[0] : null
}

/** An explanation of what the words name, from UCT's own sources → { id, kind, title, text } | null. */
export function explainTopic(words) {
  const w = norm(words)
  if (!w) return null
  const concept = CONCEPTS.find(c => c.words.some(re => re.test(w)))
  if (concept) return { id: concept.id, kind: 'concept', title: concept.title, text: concept.text, local: concept.local === true }
  // "rsi vs macd": both, from the catalog, when each names exactly one indicator
  const pair = / and /.test(w) ? w.split(/ and /) : null
  if (pair && pair.length === 2) {
    const [a, b] = pair.map(indicatorRow)
    if (a && b && a.id !== b.id) return { id: `indicators:${a.id}+${b.id}`, kind: 'indicator', title: `${a.shortName || a.name} vs ${b.shortName || b.name}`, text: `${a.shortName || a.name}: ${a.description} ${b.shortName || b.name}: ${b.description}` }
  }
  const row = indicatorRow(w)
  if (row) {
    const where = row.target === 'price' ? 'It draws on the price chart.' : 'It draws in its own pane below price.'
    const name = row.shortName && row.shortName !== row.name ? `${row.shortName} (${row.name})` : row.name
    return { id: `indicator:${row.id}`, kind: 'indicator', title: name, text: `${name} — ${row.description.replace(/\.$/, '')}. ${where} Say “add ${row.shortName || row.name}” to put it on this chart.` }
  }
  const c = core(w)
  const f = GUIDE_FEATURES.find(x => norm(x.title) === w || (x.terms || []).includes(c))
  if (f) return { id: `feature:${f.id}`, kind: 'feature', title: f.title, text: f.explain, local: true }
  return null
}

// ── the words that ask for an explanation ──
const DIFF = /^(?:what(?:'s| is| are)|whats) the difference(?:s)? between (.+?) and (.+)$|^(.+?) vs\.? (.+)$|^(?:how is|how's) (.+?) different (?:from|than) (.+)$/
const WHAT = /^(?:what(?:'s| is| are| does| do)|whats|explain|define|describe|tell me about|what do you mean by|what's meant by|meaning of|what's the meaning of|what is the meaning of)\s+(.+?)(?:\s+(?:mean|means|stand for|stands for|measure|measures|show|shows|do|does|tell me|tell you))?$/
/** The member is asking what something IS → the words to explain, or null. */
export function explainWords(raw) {
  const q = norm(raw).replace(/^(?:can you |could you |please |hey |so |ok |okay )+/, '')
  if (!q || q.length > 160) return null
  const d = DIFF.exec(q)
  if (d) return `${d[1] || d[3] || d[5]} and ${d[2] || d[4] || d[6]}`
  const m = WHAT.exec(q)
  return m ? m[1] : null
}
