// app/src/pages/optionsAnalytics/flowWords.js
//
// The flow tape's raw codes in the words the rest of the product already uses for them
// (OptionsFlow's own tooltips: "Above Ask", "At Ask", "At Bid", "Below Bid", "Sweep", "Block").
// TIDE's minute prints and STRS's block trades printed the vendor codes as-is (AA, BB, SWEEP),
// which is engineering vocabulary, not member copy (quality pass 2026-10-05).

const SIDES = {
  AA: 'Above ask',
  A: 'At ask',
  ASK: 'At ask',
  B: 'At bid',
  BID: 'At bid',
  BB: 'Below bid',
  M: 'At mid',
  MID: 'At mid',
}

/** A tape side code in words. Blank is "Unsided" (Market Tide counts those, unsigned). */
export function sideWords(side) {
  const k = String(side ?? '').trim().toUpperCase()
  if (!k) return 'Unsided'
  return SIDES[k] || titleWord(k)
}

/** A tape trade type (SWEEP / BLOCK / SPLIT / ...) in words. */
export function tradeTypeWords(type) {
  const k = String(type ?? '').trim()
  return k ? titleWord(k) : '—'
}

/** 'call' / 'C' -> 'Call', 'put' / 'P' -> 'Put'. */
export function callPutWords(cp) {
  const k = String(cp ?? '').trim().toUpperCase()
  if (k === 'C' || k === 'CALL') return 'Call'
  if (k === 'P' || k === 'PUT') return 'Put'
  return k ? titleWord(k) : ''
}

function titleWord(s) {
  return s.toLowerCase().split(/([\s_-]+)/).map((w) => (/^[\s_-]+$/.test(w) ? ' ' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('').replace(/\s+/g, ' ')
}
