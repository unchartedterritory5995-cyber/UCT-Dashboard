// ── NLM-1 D1 · REGISTRY-DERIVED CAPABILITY INDEX ─────────────────────────────────────────────────────────────
//
// A lexical index GENERATED from the canonical capability manifest (manifestFor: the same list the model is shown):
// each routing group is one document made of its capabilities' names (camelCase split), summaries, argument names
// and enum values, the group's own title, and — for the indicators group — the indicator catalog's names (the
// registry's addable rows, the member's own saved ones included). A capability that ships tomorrow is routable by
// its own words the day it registers; nothing here is hand-written per group.
//
// On top: the curated TRADER VOCABULARY (vocabulary.json, data, reviewed) — "studies", "oscillator", "pane",
// "levels", "s/r", "quad" … → the groups they point at.
//
// Scoring is BM25 over the group documents plus the vocabulary's direct weights. Pure and deterministic: no model
// call, no network, no state beyond a memo keyed on the manifest's names and the catalog's names.

import { GROUPS, groupOfAction } from '../routing'
import { addableRows } from '../capabilities/indicatorEdits'
import { isReservedWord } from '../nl/tickers'
import vocabulary from './vocabulary.json'

export const INDEX_VERSION = 1

// ── text → tokens ──────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(('a an the to of on in for and or my me i it its this that these those is are be was were with please can could would ' +
  'should will you u your just from at by as do does did so if then than into onto up out about any some one ones also too now ' +
  'want need like get got make let lets us we our them they their there here what which who how when where why all each every ' +
  'not no yes ok okay hey thanks thank pls').split(' '))

export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3)
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2)
  if (/(?:ss|us|is)$/.test(w)) return w
  if (/(?:sh|ch|x|s)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s')) return w.slice(0, -1)
  return w
}
const splitCamel = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
export function tokens(text) {
  const words = String(text || '').toLowerCase().replace(/×/g, 'x').match(/[a-z0-9]+/g) || []
  return words.filter(w => !STOP.has(w)).map(stem)
}

// ── the vocabulary: phrase patterns, compiled once ─────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
function compileTerm(term) {
  // "copy * indicators": an inner * is ONE word; "ema*": a trailing * is any word ending
  const parts = term.trim().split(/\s+/).map((p, i, all) => {
    if (p === '*') return '\\S+'
    const trail = p.endsWith('*') && i === all.length - 1
    const body = esc(trail ? p.slice(0, -1) : p)
    return trail ? `${body}\\S*` : body
  })
  return new RegExp(`(?:^|[^a-z0-9%/])${parts.join('\\s+')}(?=$|[^a-z0-9])`)
}
let TERMS = null
export function vocabularyTerms() {
  if (!TERMS) TERMS = Object.entries(vocabulary.terms).map(([term, groups]) => ({ term, re: compileTerm(term), groups }))
  return TERMS
}
export const RELATED = vocabulary.related
export const VOCAB_CAP = 1.5

/** The vocabulary's direct group weights for a message: { groupId: weight } (the max over the terms that matched). */
export function vocabularyHits(text) {
  const q = ` ${String(text || '').toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ')} `
  const out = {}
  const matched = []
  for (const t of vocabularyTerms()) {
    if (!t.re.test(q)) continue
    matched.push(t.term)
    // several terms naming one group add up (capped at VOCAB_CAP): "find stocks with …" is more screener than "stocks"
    for (const [g, w] of Object.entries(t.groups)) out[g] = Math.min(VOCAB_CAP, (out[g] || 0) + w)
  }
  // D1.1 TYPO TOLERANCE: a word one edit (or one swap) away from a single-word term of 5+ letters reads as that term,
  // at FUZZY_W of its weight — "swtich", "chnage", "bolinger", "rsii" — when no term matched the word exactly
  const words = new Set(q.match(/[a-z]{5,}/g) || [])
  for (const w of words) {
    if (singleTerms().has(w)) continue
    for (const [term, groups] of singleTerms()) {
      if (Math.abs(term.length - w.length) > 1 || !oneEdit(w, term)) continue
      matched.push(`~${term}`)
      for (const [g, wt] of Object.entries(groups)) out[g] = Math.min(VOCAB_CAP, (out[g] || 0) + wt * FUZZY_W)
      break
    }
  }
  return { groups: out, terms: matched }
}
export const FUZZY_W = 0.8
let SINGLE = null
function singleTerms() {
  if (!SINGLE) SINGLE = new Map(Object.entries(vocabulary.terms).filter(([t]) => /^[a-z]{5,}\*?$/.test(t)).map(([t, g]) => [t.replace('*', ''), g]))
  return SINGLE
}
/** At most one insertion, deletion, substitution or adjacent swap between a and b. */
export function oneEdit(a, b) {
  if (a === b) return true
  if (a.length === b.length) {
    const d = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter(i => i >= 0)
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]])
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (s === l.slice(0, i) + l.slice(i + 1)) return true
  return false
}

// ── the index ──────────────────────────────────────────────────────────────────────────────────────────────────
const W_TITLE = 2
const W_NAME = 2
const W_SUMMARY = 1
// how much a token TELLS, by the field it came from: a capability's name, its group's title, its argument words and the
// catalog's names are what it IS; summary prose ("show the real matches") is incidental — half the evidence
const F_SUMMARY = 0.5
const W_ARG = 1
const W_CATALOG = 1.5
const K1 = 1.2
const B = 0.5

function catalogNames() {
  // each addable row: its name, its id (camelCase split) and its settings line ("period, maType ema|sma…")
  try { return addableRows().map(r => [r.name, splitCamel(r.defId), typeof r.settings === 'string' ? r.settings : JSON.stringify(r.settings || '')].join(' ').trim()).filter(Boolean) } catch { return [] }
}

function argWords(schema) {
  const out = []
  const props = schema?.properties || {}
  for (const [k, v] of Object.entries(props)) {
    out.push(splitCamel(k).replace(/_/g, ' '))
    for (const e of v?.enum || v?.items?.enum || []) if (typeof e === 'string') out.push(splitCamel(e).replace(/[_-]/g, ' '))
  }
  return out.join(' ')
}

let MEMO = { key: null, index: null }

/**
 * The index for a manifest: { docs: Map<group, Map<token, weightedTf>>, len: Map<group, n>, avg, idf: Map<token, idf>, groups: [ids] }.
 * Memoised on the manifest's names + the catalog's names (both change only when the registry / the member's catalog does).
 */
export function buildIndex(manifest) {
  const cat = catalogNames()
  const key = manifest.map(c => c.name).join('|') + '#' + cat.join('|')
  if (MEMO.key === key) return MEMO.index
  const docs = new Map()
  const field = new Map()
  const add = (g, text, w, f = 1) => {
    if (!g) return
    const d = docs.get(g) || new Map()
    const fw = field.get(g) || new Map()
    for (const t of tokens(text)) { d.set(t, (d.get(t) || 0) + w); fw.set(t, Math.max(fw.get(t) || 0, f)) }
    docs.set(g, d); field.set(g, fw)
  }
  for (const c of manifest) {
    const g = groupOfAction(c.name)
    add(g, splitCamel(String(c.name).replace(/\./g, ' ')), W_NAME)
    add(g, c.summary || '', W_SUMMARY, F_SUMMARY)
    add(g, argWords(c.args), W_ARG)
  }
  for (const g of GROUPS) if (docs.has(g.id)) add(g.id, g.title, W_TITLE)
  if (docs.has('indicators')) for (const n of cat) add('indicators', n, W_CATALOG)
  // AUDIT #1027 (held-out list v2, C1-065): a `wordsOnly` group (routing.js) is chosen by its OWN words (v1's regexes), never
  // by a score. It stays a document (inspectable), but it is not SCORED and takes no part in the corpus statistics. Counted,
  // it only raised every other term's IDF (N + 1) and moved the average length, which lifted an unrelated group past STRONG
  // on a chart request and dropped the chart group from that request.
  const wordsOnly = new Set(GROUPS.filter(g => g.wordsOnly).map(g => g.id))
  const scored = [...docs.keys()].filter(g => !wordsOnly.has(g))
  const len = new Map([...docs].map(([g, d]) => [g, [...d.values()].reduce((a, b) => a + b, 0)]))
  const avg = scored.reduce((a, g) => a + len.get(g), 0) / Math.max(1, scored.length)
  const df = new Map()
  for (const g of scored) for (const t of docs.get(g).keys()) df.set(t, (df.get(t) || 0) + 1)
  const N = scored.length
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + (N - n + 0.5) / (n + 0.5))]))
  const index = { docs, field, len, avg, idf, groups: scored }
  MEMO = { key, index }
  return index
}

// ── ENTITY TYPING: what a value IS → the registry's own argument vocabulary ───────────────────────────────────
// "march 2020" is a `date`, "182.50" a `price`, "AMD" a `symbol`, "orange" a `color`, "65 minute" a `timeframe` —
// the words capabilities NAME their arguments with, so a message that only carries values still finds the
// capabilities that take them. Weighted lower than a word (a date fits replay, breadth and drawings alike).
const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? ?(?:\d{1,2}(?:st|nd|rd|th)?\b|(?:19|20)\d\d\b|low|high|top|bottom)|\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/i
const DATEISH = /\b(?:(?:19|20)\d\d-\d\d-\d\d|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:19|20)\d\d|yesterday|last (?:mon|tues|wednes|thurs|fri)day|(?:mon|tues|wednes|thurs|fri)day)\b/i
const PRICEISH = /(?:\$\d|\b\d+\.\d{1,2}\b|\b(?:at|to|above|below|under|over|hits?|breaks?|gets? to) \$?\d{2,5}\b)/i
const COLORISH = /\b(?:red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y|cyan|magenta|lime|gold|navy|maroon)\b/i
const TFISH = /\b\d+ ?(?:m|min|mins|minute|minutes|h|hr|hour|hours|d|day|w|week)\b/i
export const NOT_TICKER = new Set(['I', 'A', 'UCT', 'ETF', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'ADR', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC', 'OHLC', 'VWAP', 'AVWAP', 'MA', 'MAS', 'VCP', 'EPS', 'COT', 'ADX', 'OBV', 'CCI', 'PE'])
export const ENTITY_W = 0.5
export function entityTokens(raw) {
  const s = String(raw || '')
  const out = []
  if (MONTHS.test(s) || DATEISH.test(s)) out.push('date')
  if (PRICEISH.test(s)) out.push('price')
  if (COLORISH.test(s)) out.push('color')
  if (TFISH.test(s)) out.push('timeframe')
  const ticker = tickerWordsOf(s).length > 0
  if (ticker) out.push('symbol')
  if (PCTMOVE.test(s)) out.push('pctmove')
  // D1.3 composite shapes (a ticker AND …): an information-seeking ask about it ("what's out on X", "what's being said
  // about X", "anything happening with X", "want to read up on X") and a period change ("X 5 day change", "X over the
  // last month", "how has X done this week") — both the stock's data / news, however casually said
  if (ticker && INFO_SEEK.test(s)) out.push('tickerinfo')
  if (ticker && PERIOD_CHANGE.test(s)) out.push('periodchange')
  // D2.1: two or more tickers AND "charts" — new charts for them (the workspace's add, or a grid)
  if (tickerWordsOf(s).length >= 2 && /\bcharts?\b/i.test(s)) out.push('tickercharts')
  return out
}
const INFO_SEEK = /\b(?:what(?:'s|’s| is| are)? (?:out|new|up|happening|going on)|(?:being |people )?(?:said|saying|say|talking|chatter|buzz)|happening|going on|hear(?:d|ing)?|read(?:ing)?(?: up)?|latest|update[sd]?|any word|scoop|story|stories|tell me (?:about|what)|know about|catch up|why (?:is|did|was))\b/i
const PERIOD_CHANGE = /\b\d+[- ]?(?:d|day|days|wk|week|weeks|mo|month|months|yr|year|years)\b|\b(?:this|last|past) (?:week|month|quarter|year)\b|\bytd\b|\byear to date\b|\b(?:change|performance|perf|return|returns)\b|\bhow (?:has|did|is) \S+ (?:done|doing|performed)\b/i
// D1.2: a PERCENT MOVE ("up 5% today", "gained over 3 percent", "movers up 10%", "8%+ gainers") — the shape of a screen
// over today's change (vocabulary.json `entities.pctmove`); never a chart's percent SCALE ("percent scale" has no number)
const MOVE_VERB = '(?:up|down|gain(?:ed|ing|s)?|mov(?:ed|ing|es|ers)?|higher|lower|rall(?:y|ied|ying)|drop(?:ped|ping|s)?|fell|fall(?:ing|en|s)?|jump(?:ed|ing|s)?|surg(?:ed|ing|es)|rip(?:ped|ping|s)?|gainers|losers|runners|decliners|advancers)'
const PCTMOVE = new RegExp(`\\b${MOVE_VERB}\\s+(?:by\\s+|over\\s+|more than\\s+|at least\\s+|above\\s+|>\\s*)?\\d+(?:\\.\\d+)?\\s?(?:%|percent|pct)|\\b\\d+(?:\\.\\d+)?\\s?(?:%|percent|pct)\\+?\\s+(?:or more\\s+)?${MOVE_VERB}`, 'i')
export const ENTITY_GROUPS = vocabulary.entities || {}
/** Ticker-shaped words (upper-case, 1–5 letters, not an indicator / market acronym) — none in a SHOUTED message. */
export function tickerWordsOf(raw) {
  const s = String(raw || '')
  if (!/[a-z]/.test(s) && s.trim().split(/\s+/).length >= 3) return []      // "ADD RSI TO THIS CHART" is shouting, not tickers
  return (s.match(/(?:^|[\s$(,:])\$?([A-Z]{1,5})(?=['’]s\b|[\s,.!?):]|$)/g) || []).map(w => w.trim().replace(/^[(,:]+/, ''))
    .filter(w => !isReservedWord(w)).map(w => w.replace(/^\$/, '')).filter(w => !NOT_TICKER.has(w))
}

/** BM25 of each group for query tokens — `weights` (token → factor, default 1) discounts weak evidence. */
export function lexicalScores(index, qTokens, weights = null) {
  const out = {}
  const uniq = [...new Set(qTokens)]
  for (const g of index.groups) {
    const d = index.docs.get(g)
    const norm = K1 * (1 - B + B * (index.len.get(g) / index.avg))
    let s = 0
    for (const t of uniq) {
      const tf = d.get(t)
      if (!tf) continue
      s += (weights?.get(t) ?? 1) * index.field.get(g).get(t) * index.idf.get(t) * (tf * (K1 + 1)) / (tf + norm)
    }
    if (s > 0) out[g] = s
  }
  return out
}
