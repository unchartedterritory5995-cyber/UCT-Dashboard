// ── NLM-1 D1 · REGISTRY-DERIVED CAPABILITY INDEX ─────────────────────────────────────────────────────────────
//
// A lexical index GENERATED from the canonical capability manifest (manifestFor: the same list the model is shown):
// each routing group is one document made of its capabilities' names (camelCase split), summaries, argument names
// and enum values, the group's own title, and — for the indicators group — the indicator catalog's names (the
// registry's addable rows, the member's own saved ones included). A capability that ships tomorrow is routable by
// its own words the day it registers; nothing here is hand-written per group.
//
// Beside the group documents, each CAPABILITY is a document of its own (capabilityFields: its name, summary, the examples
// quoted in its summary and hints, enum values and argument names at any depth, coerce words, hints). A group's document
// dilutes one specific action; a capability's does not, so "flag this name" finds watchlist.setFlag in a 17-action group.
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

export const INDEX_VERSION = 2

// ── text → tokens ──────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(('a an the to of on in for and or my me i it its this that these those is are be was were with please can could would ' +
  'should will you u your just from at by as do does did so if then than into onto up out about any some one ones also too now ' +
  'want need like get got make let lets us we our them they their there here what which who how when where why all each every ' +
  'not no yes ok okay hey thanks thank pls').split(' '))

// Words the suffix rules below would fold into a different word: "news" is not "new", "settings" is not the verb "set".
const WHOLE = new Map([['news', 'news'], ['setting', 'setting'], ['settings', 'setting']])
const VOWEL = /[aeiouy]/
/** One root for a word's forms: flag / flags / flagged / flagging, save / saves / saved / saving, line / lines. */
export function stem(word) {
  let w = word.replace(/(col|fav|neighb)our/, '$1or')
  if (WHOLE.has(w)) return WHOLE.get(w)
  if (w.length <= 3 || /\d/.test(w)) return w
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y'
  else if (/(?:ss|us|is)$/.test(w)) return w
  else if (/(?:sh|ch|x|s)es$/.test(w)) w = w.slice(0, -2)
  else if (w.endsWith('s')) w = w.slice(0, -1)
  for (const suffix of ['ing', 'ed']) {
    const root = w.slice(0, -suffix.length)
    if (!w.endsWith(suffix) || root.length < 3 || !VOWEL.test(root) || /e$/.test(root)) continue
    w = root.replace(/([bdgmnprt])\1$/, '$1')
    break
  }
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w
}
const splitCamel = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
export function tokens(text) {
  const words = String(text || '').toLowerCase().replace(/×/g, 'x').match(/[a-z0-9]+/g) || []
  return words.filter(w => !STOP.has(w)).map(stem)
}
// A capability's description says "EVERY indicator", "ALL charts", and that is what tells it from its one-at-a-time
// sibling: at capability level the quantifiers count, as one word
const QUANTIFIER = /^(?:all|every|each|everything)$/
export function capabilityTokens(text) {
  const words = String(text || '').toLowerCase().replace(/×/g, 'x').match(/[a-z0-9]+/g) || []
  return words.filter(w => QUANTIFIER.test(w) || !STOP.has(w)).map(w => (QUANTIFIER.test(w) ? 'all' : stem(w)))
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

const idWords = (s) => splitCamel(s).replace(/[._-]/g, ' ')
function argWords(schema) {
  const out = []
  const props = schema?.properties || {}
  for (const [k, v] of Object.entries(props)) {
    out.push(splitCamel(k).replace(/_/g, ' '))
    for (const e of v?.enum || v?.items?.enum || []) if (typeof e === 'string') out.push(splitCamel(e).replace(/[_-]/g, ' '))
  }
  return out.join(' ')
}

/** Every argument name and enum value of a schema, at any depth: { names, values }, as words. */
function schemaWords(schema, into = { names: [], values: [] }) {
  if (!schema || typeof schema !== 'object') return into
  for (const e of schema.enum || []) if (typeof e === 'string') into.values.push(idWords(e))
  for (const [k, v] of Object.entries(schema.properties || {})) { into.names.push(idWords(k)); schemaWords(v, into) }
  for (const v of [schema.items, ...(schema.anyOf || [])]) schemaWords(v, into)
  return into
}

// ── capability documents: what ONE capability says about itself ────────────────────────────────────────────────
// A word that identifies one capability identifies its group, whatever the group's size. How much a field TELLS: the
// name is what the capability IS; a quoted example ("keep only these", "hide the grid") is a member's own wording; the
// summary describes it; enum values and argument names are what it takes; a hint is mostly instructions to the model.
const CAP_FIELD = Object.freeze({ NAME: 3, QUOTED: 2, ENUM: 1.5, CATALOG: 1.5, SUMMARY: 1, ARG: 0.75, COERCE: 0.75, HINT: 0.25 })
const QUOTED = /["“]([^"“”]{3,80})["”]/g
const ACTION_NAME = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z.]*\b/g       // a pointer to ANOTHER capability is not evidence for this one
const CAP_K1 = 1.2
const CAP_B = 0.4

/** "widget.showScan" → what it IS ("widget Scan") and its verb ("show"); a one-word action ("drawing.lock") IS its verb. */
function nameWords(name) {
  const words = idWords(name).split(' ')
  return words.length > 2 ? { object: [words[0], ...words.slice(2)].join(' '), verb: words[1] } : { object: words.join(' '), verb: '' }
}

function capabilityFields(c, catalog) {
  const prose = [c.summary, c.hints, c.shape].filter(Boolean).join(' ').replace(ACTION_NAME, ' ')
  const { names, values } = schemaWords(c.args)
  const { object, verb } = nameWords(c.name)
  const fields = [
    [object, CAP_FIELD.NAME],
    [verb, CAP_FIELD.SUMMARY],
    [String(c.summary || '').replace(ACTION_NAME, ' '), CAP_FIELD.SUMMARY],
    [[...prose.matchAll(QUOTED)].map(m => m[1]).join(' '), CAP_FIELD.QUOTED],
    [values.join(' '), CAP_FIELD.ENUM],
    [names.join(' '), CAP_FIELD.ARG],
    [Object.values(c.coerce || {}).flatMap(Object.keys).join(' '), CAP_FIELD.COERCE],
    [[c.hints, c.shape].filter(Boolean).join(' ').replace(ACTION_NAME, ' '), CAP_FIELD.HINT],
  ]
  if (c.name === 'indicator.add') fields.push([catalog.join(' '), CAP_FIELD.CATALOG])
  return fields
}

function capabilityPostings(manifest, catalog) {
  const docs = new Map()
  for (const c of manifest) {
    const d = new Map()
    for (const [text, w] of capabilityFields(c, catalog)) for (const t of capabilityTokens(text)) d.set(t, (d.get(t) || 0) + w)
    docs.set(c.name, d)
  }
  const len = new Map([...docs].map(([n, d]) => [n, [...d.values()].reduce((a, b) => a + b, 0)]))
  const avg = [...len.values()].reduce((a, b) => a + b, 0) / Math.max(1, len.size)
  const postings = new Map()
  for (const [name, d] of docs) {
    const norm = CAP_K1 * (1 - CAP_B + CAP_B * (len.get(name) / avg))
    for (const [t, tf] of d) {
      if (!postings.has(t)) postings.set(t, [])
      postings.get(t).push([name, (tf * (CAP_K1 + 1)) / (tf + norm)])
    }
  }
  const N = docs.size
  const idf = new Map([...postings].map(([t, list]) => [t, Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5))]))
  return { postings, idf }
}

/**
 * What a word MEANS to the registry when the registry has no such token: "unflag" → flag, "recolor" → color, "gridlines"
 * → grid + line, "pre market" → premarket. Only ever resolves onto tokens the capabilities themselves use.
 */
export function resolveTokens(index, qTokens) {
  const known = (t) => index.capIdf.has(t)
  const out = []
  qTokens.forEach((t, i) => {
    const next = qTokens[i + 1]
    if (next && known(stem(t + next))) out.push(stem(t + next))
    if (known(t)) { out.push(t); return }
    const bare = t.replace(/^(?:un|re)/, '')
    if (bare !== t && bare.length >= 3 && known(stem(bare))) { out.push(stem(bare)); return }
    for (let at = 3; at <= t.length - 3; at++) {
      const [a, b] = [stem(t.slice(0, at)), stem(t.slice(at))]
      if (known(a) && known(b)) { out.push(a, b); return }
    }
    out.push(t)
  })
  return [...new Set(out)]
}

/** BM25 of each capability for query tokens: [[name, score], …], best first. Reads only the postings of the query's tokens. */
export function capabilityScores(index, qTokens, weights = null) {
  const scores = new Map()
  for (const t of new Set(qTokens)) {
    const list = index.capPostings.get(t)
    if (!list) continue
    const w = (weights?.get(t) ?? 1) * index.capIdf.get(t)
    for (const [name, tf] of list) scores.set(name, (scores.get(name) || 0) + w * tf)
  }
  return [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

let MEMO = { key: null, index: null }

/**
 * The index for a manifest: { docs: Map<group, Map<token, weightedTf>>, len: Map<group, n>, avg, idf: Map<token, idf>, groups: [ids],
 * capPostings: Map<token, [[capability, tf]]>, capIdf: Map<token, idf> }.
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
  const len = new Map([...docs].map(([g, d]) => [g, [...d.values()].reduce((a, b) => a + b, 0)]))
  const avg = [...len.values()].reduce((a, b) => a + b, 0) / Math.max(1, len.size)
  const df = new Map()
  for (const d of docs.values()) for (const t of d.keys()) df.set(t, (df.get(t) || 0) + 1)
  const N = docs.size
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + (N - n + 0.5) / (n + 0.5))]))
  const { postings: capPostings, idf: capIdf } = capabilityPostings(manifest, cat)
  const index = { docs, field, len, avg, idf, groups: [...docs.keys()], capPostings, capIdf }
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
