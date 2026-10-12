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
import { templatesNow } from '../capabilities/chart'
import { editDistance, allowedEdits } from './match'
import { isPronounToken } from './tickers'

const WORD = /[a-z]{3,}/g
const wordsOf = (s) => (String(s || '').toLowerCase().replace(/\\[bBsSdDwW]/g, ' ').match(WORD) || [])

let staticWords = null
let staticKey = ''
/** Registry- and catalog-derived words (rebuilt when the registry changes). */
function registryWords(extraSources) {
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
    if (typeof c.fast === 'function') add(c.fast.toString())
  }
  for (const s of extraSources || []) add(s)
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
  try { for (const t of templatesNow() || []) add(t.name) } catch { /* none */ }
  return set
}

/** Symbols visible to the member (charts, list items): never "corrected" into words. */
function symbolsOnBoard(host) {
  const set = new Set()
  try { for (const c of host?.charts?.list?.() || []) if (c.symbol) set.add(String(c.symbol).toLowerCase()) } catch { /* none */ }
  try { for (const l of host?.watchlists?.snapshot?.() || []) for (const s of l.symbols || []) set.add(String(s).toLowerCase()) } catch { /* none */ }
  return set
}

export function lexiconFor(host, extraSources = []) {
  const words = new Set([...registryWords(extraSources), ...liveWords(host)])
  return { words, symbols: symbolsOnBoard(host) }
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
