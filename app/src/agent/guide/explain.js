// ── UCT Agent PRODUCT GUIDE: EXPLAIN — teach, never change anything ─────────────────────────────────────────
//
// "What does ADR mean?", "Explain RSI", "What's the difference between a chart indicator and a condition?"
// Answered from what UCT itself says, in this order:
//   1. the INDICATOR CATALOG — every built-in indicator's own name, short name, tags and description
//      (components/chart/indicatorCatalog → nativeRegistry). "ADR" is ADR %'s tag; "RSI" is its short name.
//   2. a few UCT CONCEPTS that are not an indicator (below) — each worded from the product's own behaviour,
//      with the file that behaviour lives in named beside it.
//   3. a guide FEATURE's own `explain` (registry.js) — "what is a layout?"
//   4. ⭐ PHASE 3: a CHART SETTING's own row in the product's descriptor table (components/chart/chartSettingsDescriptors —
//      its label, where it is in Chart Settings, its values, the prerequisite the dialog enforces, and whether the Agent
//      may change it) — "what does the bar-close countdown setting do?". And, with Chart Settings OPEN, "explain these
//      settings" lists the open tab's own rows (read from the dialog: its selected tab). Nothing is added to what the
//      table says — a setting it does not describe is not explained here.
// Anything else returns null: the model answers it (general trading knowledge), as before. Nothing here is ever a
// change to the workspace — the guide.explain capability is a query.
//
// INSTANT vs MODEL (owner decision 2026-10-29). A SIMPLE question whose words name exactly one catalog indicator (or
// two, compared), one of an indicator's own types ("an EMA" — the Moving Average's Type), a UCT concept or a guide
// feature is answered on the instant path (`local`), in the catalog's own words — there is no separate glossary.
// Anything more ("what is RSI telling me about NVDA?", "the best RSI setting for swing trades", a term the catalog
// does not name exactly once) returns null or stays the model's.

import { catalogRows } from '../../components/chart/indicatorCatalog'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { GUIDE_FEATURES } from './registry'
import { CHART_SETTING_DESCRIPTORS } from '../../components/chart/chartSettingsDescriptors'

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
    id: 'link-colours', title: 'Link colours', local: true,
    words: [/\blink(ed)? (colou?rs?|groups?)\b/, /\bcolou?r (dot|link|group)s?\b/],
    // pages/charts/WidgetHost (the colour-link dot) — widgets in one group share a symbol
    text: 'The coloured dot on a widget’s header is its link group. Widgets in the same colour share a symbol — click a ticker in a linked watchlist and every chart in that colour changes with it. “Not linked” keeps a widget on its own symbol.',
  },
]

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
// "the rsi", "an adr", "rsi indicator" → "rsi"
const core = (s) => norm(s).replace(/^(?:a|an|the|my|this|that)\s+/, '').replace(/\s+(?:indicator|study|line|mean|means|stand for|stands for|measure|measures|show|shows|do|does)$/, '').trim()

// the catalog's own enum options of a row ("EMA" is one of the Moving Average's Types) → { label, setting } | null
function optionOf(row, w) {
  for (const i of row.inputs || []) {
    const o = i?.type === 'enum' ? (i.options || []).find(x => norm(x.label) === w || String(x.value).toLowerCase() === w) : null
    if (o) return { label: o.label, setting: i.label || i.key }
  }
  return null
}

// the one catalog row the words NAME: its name, short name or id first ("atr" is ATR, not SuperTrend's "atr" tag),
// then its tags — never a guess between several
function indicatorRow(words) {
  const w = core(words)
  if (!w || w.length > 40) return null
  let rows = []
  try { rows = catalogRows(nativeRegistry).filter(r => r.description && !r.userDefined) } catch { rows = [] }
  const named = rows.filter(r => norm(r.name) === w || norm(r.shortName) === w || String(r.id).toLowerCase() === w)
  if (named.length) return named.length === 1 ? { row: named[0], option: null } : null
  const tagged = rows.filter(r => (r.tags || []).some(t => norm(t) === w))
  return tagged.length === 1 ? { row: tagged[0], option: optionOf(tagged[0], w) } : null
}

// ── ⭐ PHASE 3: chart settings, from the product's descriptor table ──
const described = () => CHART_SETTING_DESCRIPTORS.filter(d => d.agent !== 'internal' && d.label && d.ui)
const optLabel = (d, v) => (Array.isArray(v) ? String(v[1] ?? v[0]) : typeof v === 'object' && v ? String(v.label ?? v.val) : String(v))
function valuesOf(d) {
  if (d.type === 'bool') return 'It is on or off.'
  if (d.type === 'color') return 'It takes a colour.'
  if (d.type === 'enum' && Array.isArray(d.options) && d.options.length) return `Options: ${d.options.map(v => optLabel(d, v)).join(', ')}.`
  return ''
}
function canChange(d) {
  if (d.agent === 'eligible' || String(d.agent || '').startsWith('specialized:')) return 'I can change it for you — just say the new value.'
  if (String(d.agent || '').startsWith('owned:')) return 'It belongs to the indicator settings — change it there, or ask me about the indicator.'
  return 'I can tell you where it is, but I can’t change this one for you yet.'
}
// the ONE setting the words name: its label, or one of its own `words` — never a guess between several
export function settingRow(words) {
  const w = core(words).replace(/\s+(?:settings?|options?|toggle|switch|control)$/, '').replace(/^(?:the\s+)/, '')
  if (!w || w.length > 60) return null
  const rows = described()
  const hits = rows.filter(d => norm(d.label) === w || (d.words || []).some(x => norm(x) === w))
  return hits.length === 1 ? hits[0] : null
}
const settingText = (d) => [`${d.label} — ${d.ui}.`, valuesOf(d), d.requires?.why || '', canChange(d)].filter(Boolean).join(' ')

/** The Chart Settings tab open on screen right now (its label, "Canvas"), or null. Reads the dialog's own tabs. */
export function openSettingsTab() {
  if (typeof document === 'undefined') return null
  const dlg = document.querySelector('[data-guide="chartSettings"]')
  if (!dlg) return null
  const tab = dlg.querySelector('[role="tab"][aria-selected="true"]')
  return tab ? String(tab.textContent || '').trim() || null : null
}
const THESE = /^(?:these|this|those|the|all the|all these|all of these)\s+(?:chart\s+)?(?:settings?|options?|controls?|tab|toggles?)(?:\s+(?:here|on this tab|in this tab|do|mean))?$/
function settingsOfTab(tab) {
  if (/^indicators$/i.test(tab)) return { say: 'The Indicators tab lists the indicators on this chart — click one to see its own settings, or ask me “what is RSI?” about any of them.' }
  const rows = described().filter(d => new RegExp(`^Chart Settings → ${tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(d.ui))
  if (!rows.length) return null
  // grouped by where they sit in the tab (the descriptor's own path), each with its values
  const groups = new Map()
  for (const d of rows) {
    const where = d.ui.split(' → ')[2] || tab
    if (!groups.has(where)) groups.set(where, [])
    groups.get(where).push(d)
  }
  const lines = [...groups].slice(0, 12).map(([where, ds]) => `${where}: ${ds.slice(0, 6).map(d => d.label).join(', ')}${ds.length > 6 ? `, and ${ds.length - 6} more` : ''}.`)
  return { title: `Chart Settings → ${tab}`, text: `The ${tab} tab: ${lines.join(' ')} Ask me about any one of them (“what is ${rows[0].label.toLowerCase()}?”), or tell me what to change.` }
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
    const [a, b] = pair.map(x => indicatorRow(x)?.row || null)
    if (a && b && a.id !== b.id) return { id: `indicators:${a.id}+${b.id}`, kind: 'indicator', title: `${a.shortName || a.name} vs ${b.shortName || b.name}`, text: `${a.shortName || a.name}: ${a.description} ${b.shortName || b.name}: ${b.description}`, local: true }
  }
  const hit = indicatorRow(w)
  if (hit) {
    const { row, option } = hit
    const where = row.target === 'price' ? 'It draws on the price chart.' : 'It draws in its own pane below price.'
    const name = row.shortName && row.shortName !== row.name ? `${row.shortName} (${row.name})` : row.name
    if (option) {
      // "what is an EMA?" — the catalog names it as one of the Moving Average's types; said as exactly that
      return { id: `indicator:${row.id}:${option.label}`, kind: 'indicator', title: option.label, local: true,
        text: `${option.label} is one of the types of UCT’s ${row.name} indicator, chosen in its “${option.setting}” setting. ${row.name}: ${row.description.replace(/\.$/, '')}. ${where} Choose ${option.label} in that setting when you add ${row.shortName || row.name}.` }
    }
    return { id: `indicator:${row.id}`, kind: 'indicator', title: name, text: `${name} — ${row.description.replace(/\.$/, '')}. ${where} Say “add ${row.shortName || row.name}” to put it on this chart.`, local: true }
  }
  const c = core(w)
  const f = GUIDE_FEATURES.find(x => norm(x.title) === w || (x.terms || []).includes(c))
  if (f) return { id: `feature:${f.id}`, kind: 'feature', title: f.title, text: f.explain, local: true }
  // ⭐ PHASE 3: "these settings" — the Chart Settings tab open on screen; with none open, where to look (one sentence)
  if (THESE.test(w) || /^(?:settings?|options?|controls?|tab)(?: here)?$/.test(c)) {
    const tab = openSettingsTab()
    if (!tab) return { id: 'settings:none-open', kind: 'setting', title: 'Which settings?', local: true,
      text: 'Open the chart’s settings (the gear on its header) and ask me again on the tab you’re looking at — I’ll go through its settings. Or ask about one by name, like “what is the bar-close countdown?”.' }
    const t = settingsOfTab(tab)
    if (t?.say) return { id: `settings-tab:${tab}`, kind: 'setting', title: `Chart Settings → ${tab}`, text: t.say, local: true }
    if (t) return { id: `settings-tab:${tab}`, kind: 'setting', ...t, local: true }
  }
  const s = settingRow(w)
  if (s) return { id: `setting:${s.id}`, kind: 'setting', title: s.label, text: settingText(s), local: true }
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
