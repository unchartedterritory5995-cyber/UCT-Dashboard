// ── UCT Agent NL: the instant-command lexicon + safe typo correction ───────────────────────
//
// Natural Language & Intent Intelligence (N3). The vocabulary is GENERATED from what already exists —
// never a hand-written phrase list:
//   • every registered capability: its name, summary, hints, argument enums, and the source text of
//     its instant phrase (`fast`) — so the words a phrase understands are the words it is spelled with
//   • the fast path's own phrase sources (passed in by fastPath.js)
//   • the indicator catalog (names + ids), and the member's live names: layouts, watchlists, saved
//     screens, templates
// A word is corrected only when exactly ONE vocabulary word is within the edit threshold (nl/match.js)
// and it is not a ticker, number, pronoun or a symbol on the board. Whether a correction is USED is
// decided by fastPath.js: only when the corrected sentence parses into a safe, reversible action.

import { allCapabilityNames, getCapability } from '../capabilities'
import { addableRows } from '../capabilities/indicatorEdits'
import { savedScreensNow } from '../capabilities/screener'
import { editDistance, allowedEdits } from './match'
import { isPronounToken } from './tickers'

// Words of 3+ letters. ALL-CAPS tokens in prose/source are skipped: they are tickers and acronyms in
// examples ("Compare NVDA against QQQ") — a ticker must never become a "known word".
const WORD = /[A-Za-z]{3,}/g
const wordsOf = (s) => (String(s || '').replace(/\\[bBsSdDwW]/g, ' ').match(WORD) || []).filter(w => !/^[A-Z]+$/.test(w)).map(w => w.toLowerCase())

const stripComments = (src) => String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')

let staticWords = null
let staticKey = ''
/** Registry- and catalog-derived words (rebuilt when the registry changes). */
function registryWords() {
  const names = allCapabilityNames()
  const key = `${names.length}:${names.join(',').length}`
  if (staticWords && staticKey === key) return staticWords
  const set = new Set()
  const add = (s) => { for (const w of wordsOf(s)) set.add(w) }
  for (const n of names) {
    const c = getCapability(n)
    if (!c) continue
    add(n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' '))
    add(c.summary); add(c.hints)
    for (const p of Object.values(c.args?.properties || {})) for (const v of (p.enum || [])) add(String(v))
    // the phrase's CODE only — comments are prose about it (and quote example tickers in lowercase)
    if (typeof c.fast === 'function') add(stripComments(c.fast.toString()))
  }
  try { for (const r of addableRows()) { add(r.name); add(r.defId) } } catch { /* the catalog is optional */ }
  staticWords = set
  staticKey = key
  return set
}

/** The member's own names right now (layouts, watchlists, saved screens, templates). */
function liveWords(host) {
  const set = new Set()
  const add = (s) => { for (const w of wordsOf(s)) set.add(w) }
  try { for (const e of host?.layouts?.snapshot?.().entries || []) add(e.name) } catch { /* no layouts */ }
  try { for (const l of host?.watchlists?.snapshot?.() || []) add(l.name) } catch { /* no lists */ }
  try { const s = savedScreensNow(); for (const x of [...(s?.saved || []), ...(s?.starters || [])]) add(x.name) } catch { /* not loaded */ }
  try {                                                                 // the member's chart templates (their preference)
    const raw = host?.prefs?.read?.()?.chart_templates
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    for (const t of Array.isArray(list) ? list : []) add(t?.name)
  } catch { /* none */ }
  return set
}

/** Symbols visible to the member (charts, list items): never "corrected" into words. */
function symbolsOnBoard(host) {
  const set = new Set()
  try { for (const c of host?.charts?.list?.() || []) if (c.symbol) set.add(String(c.symbol).toLowerCase()) } catch { /* none */ }
  try { for (const l of host?.watchlists?.snapshot?.() || []) for (const s of l.symbols || []) set.add(String(s).toLowerCase()) } catch { /* none */ }
  return set
}

// The fast path's own phrase sources (CANON, LEAD, position words…), registered by fastPath.js at load
// (it imports this module, so this module cannot import it).
let baseSources = () => []
export function setBaseSources(fn) { baseSources = typeof fn === 'function' ? fn : () => [] }

export function lexiconFor(host, extraSources = []) {
  const words = new Set([...registryWords(), ...liveWords(host), ...extraWords(baseSources()), ...extraWords(extraSources)])
  return { words, symbols: symbolsOnBoard(host) }
}
const EXTRA = new Map()                                                 // source text → its words
function extraWords(sources) {
  const out = []
  for (const s of sources || []) {
    if (!EXTRA.has(s)) EXTRA.set(s, wordsOf(stripComments(s)))
    out.push(...EXTRA.get(s))
  }
  return out
}

/**
 * NL N4: may this lowercase word be read as a TICKER? Only when it is not a word UCT knows (or one
 * edit from one — then it is a typo of that word, never a symbol) and not a pronoun. Whether the
 * ticker exists is decided later by the ticker search (prepare), never here.
 */
export function plainSymbolWord(tok, host, raw = tok) {
  const t = String(tok || '').toLowerCase()
  if (!/^[a-z][a-z0-9.]{0,9}$/.test(t) || isPronounToken(tok, raw)) return false
  const { words } = lexiconFor(host)
  if (words.has(t)) return false
  if (t.length >= 4) for (const w of words) if (Math.abs(w.length - t.length) <= 1 && editDistance(t, w, 1) <= 1) return false
  return true
}

export const MAX_VARIANTS = 16

/**
 * Candidate corrections of `text`. → null (nothing to correct) | [{ text, changes: [{ from, to }] }]
 * — one variant per combination of the closest vocabulary words (a word with two equally close
 * readings, "weeky" → weekly | week, gives two variants). The CALLER keeps a variant only when exactly
 * one distinct safe action results (the parser disambiguates, nothing here guesses). Case, spacing
 * and punctuation of the rest are kept. Too many combinations → null.
 */
export function correctTypos(text, lex) {
  const raw = String(text || '')
  if (!raw || raw.length > 160) return null
  const byLen = new Map()
  for (const w of lex.words) { const k = w.length; if (!byLen.has(k)) byLen.set(k, []); byLen.get(k).push(w) }
  const slots = []                                                           // { index, tok, options }
  for (const m of raw.matchAll(/\$?[A-Za-z]+/g)) {
    const tok = m[0]
    const lw = tok.toLowerCase()
    if (tok.startsWith('$') || lw.length < 4 || lex.words.has(lw)) continue
    if (/^[A-Z]+$/.test(tok) && /[a-z]/.test(raw)) continue                  // TYPED IN CAPITALS: a ticker
    if (lex.symbols.has(lw) || isPronounToken(tok, raw)) continue
    const allow = allowedEdits(lw)
    if (!allow) continue
    let bestD = allow + 1
    let options = []
    for (let k = lw.length - allow; k <= lw.length + allow; k++) {
      for (const w of byLen.get(k) || []) {
        const d = editDistance(lw, w, allow)
        if (d < bestD) { bestD = d; options = [w] } else if (d === bestD) options.push(w)
      }
    }
    if (options.length) slots.push({ index: m.index, tok, options })         // unknown word: left alone
  }
  if (!slots.length) return null
  const total = slots.reduce((n, s) => n * s.options.length, 1)
  if (total > MAX_VARIANTS) return null
  let variants = [{ text: '', changes: [], at: 0 }]
  for (const s of slots) {
    const next = []
    for (const v of variants) {
      for (const o of s.options) {
        const word = /^[A-Z]/.test(s.tok) ? o[0].toUpperCase() + o.slice(1) : o
        next.push({ text: v.text + raw.slice(v.at, s.index) + word, changes: [...v.changes, { from: s.tok, to: o }], at: s.index + s.tok.length })
      }
    }
    variants = next
  }
  return variants.map(v => ({ text: v.text + raw.slice(v.at), changes: v.changes }))
}
