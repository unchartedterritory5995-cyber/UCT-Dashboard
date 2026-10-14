// app/src/pages/journal-2-0/lib/alertPhrase.js
/**
 * Tier 2 part A, item 8 -- "alert me if NVDA closes below 120" read LOCALLY and DETERMINISTICALLY:
 * ticker + comparator + price + close/intraday (spec). Pure: no React, no fetch. It never sets
 * anything; it says what a sentence asks for, and the chip asks the member.
 *
 * ⛔ The word it calls a symbol is a CANDIDATE. Whether it is a ticker here is the server's call
 * (POST /api/j2/smart-chips/tickers, buzz_extract), because RS / EMA / MA / GAP / PEG are real
 * symbols that are words in prose (R-T2A-6). "it" / "the stock" / "price" mean the note's ticker.
 *
 * The grammar, and nothing more: an ask ("alert") BEFORE "if/when/once", then a subject, a verb from
 * a fixed list, an optional direction word, a price, and for a close an optional "on the
 * daily/weekly". "closes" is a closed-bar alert (R-T2A-5); every other verb is intraday.
 */
import { parseAlertPrice } from '../../terminal/alertModel'

export const MAX_PHRASE_TEXT = 280

const ASK = /\balert\b/i
const NEGATED = /\b(?:don'?t|do\s+not|never|no)\b[^.!?]{0,20}\balert\b/i
const PHRASE = /\b(?:if|when|once)\s+(?<sym>it|the\s+stock|the\s+price|price|\$?[A-Za-z]{1,6}(?:[.-][A-Za-z]{1,2})?)\s+(?<verb>closes|close|trades|trade|goes|gets|moves|drops|falls|breaks|crosses|hits|touches|reaches|is)\s+(?:(?<dir>above|below|over|under|through|to)\s+)?(?<price>\$?\d{1,7}(?:\.\d{1,4})?)(?!\d|\.\d)(?:\s+on\s+the\s+(?<tf>daily|weekly)(?:\s+chart)?)?/gi

const DIR = { above: 'above', over: 'above', below: 'below', under: 'below' }
const FALLING = new Set(['drops', 'falls'])
const PRONOUN = /^(?:it|It|the\s+stock|the\s+price|price)$/i

function readSentence(sentence) {
  if (!ASK.test(sentence) || NEGATED.test(sentence)) return null
  let found = null
  for (const m of sentence.matchAll(PHRASE)) {
    if (!ASK.test(sentence.slice(0, m.index))) continue
    found = m
  }
  if (!found) return null
  const g = found.groups
  const priced = parseAlertPrice(g.price)
  if (!priced) return null
  const rawSym = g.sym
  const pronoun = rawSym !== 'IT' && PRONOUN.test(rawSym)
  const verb = g.verb.toLowerCase()
  const word = (g.dir || '').toLowerCase()
  const direction = DIR[word] || (FALLING.has(verb) ? 'below' : null)
  const mode = verb === 'closes' || verb === 'close' ? 'close' : 'intraday'
  return {
    symbol: pronoun ? null : rawSym.replace(/^\$/, '').toUpperCase().replace('.', '-'),
    pronoun,
    mode,
    direction,
    price: priced.price,
    tf: (g.tf || '').toLowerCase() === 'weekly' ? 'W' : 'D',
    phrase: found[0],
  }
}

export function parseAlertPhrase(text) {
  const t = String(text ?? '')
  if (!t.trim() || t.length > MAX_PHRASE_TEXT) return null
  const sentences = t.split(/(?<=[.!?])\s+/)
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const p = readSentence(sentences[i])
    if (p) return p
  }
  return null
}

const money = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function describeAlert(p, symbol) {
  if (!p) return ''
  if (p.mode === 'close') return `${symbol} closes ${p.direction || 'at'} ${money(p.price)} (${p.tf === 'W' ? 'weekly' : 'daily'})`
  if (!p.direction) return `${symbol} reaches ${money(p.price)}`
  return `${symbol} trades ${p.direction} ${money(p.price)}`
}
