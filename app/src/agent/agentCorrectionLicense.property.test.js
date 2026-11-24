// ⭐ AUDIT NO-GO #3 (11-23, F1b): the correction licence as a PROPERTY. A message licenses a correction's undo half (without an explicit
// "put … back" / "undo …") ONLY when every token is a rejection or a VERIFIED pointer and at least one rejection is present. Default-
// deny: any token the licence cannot positively classify — capitals that are no symbol here ("TOO", "ALSO", "ADD"), an unverified
// ticker ("NVDA" off the board, "$QQQ"), a ticker-like English word that is not on the board ("FIX", "GO"), a value / number /
// timeframe ("weekly", "15", "5m"), an emoji, a mixed token, praise, thanks — makes it unlicensed.
// Generated: every rejection × 1–3 tokens drawn from every class × separators (comma, space, dash, two sentences, "!", parentheses,
// quotes) × case forms. The oracle below is independent of the implementation: it only knows each token's class.
import { describe, it, expect } from 'vitest'
import { correctionLicensed } from './deixis'

const A = 'META', B = 'MSFT'                                         // the earlier chart, the chart the correction names
const BOARD = [A, B]
const REJECT = ['no', 'nope', 'nah', 'wrong', 'oops', 'sorry', 'I meant', 'meant', 'NO', 'Nope', 'Sorry']
const POINTER = ['the', 'one', 'chart', 'right', 'left', 'top', 'MSFT', 'msft', 'Msft', '$MSFT', 'META', 'that', 'please', 'instead',
  'the other one', 'on the right', '"MSFT"', 'the MSFT one', 'do', 'it', 'wait', 'ok']
const FRESH = {
  capsAdditive: ['TOO', 'ALSO', 'ADD', 'KEEP', 'BOTH', 'AS WELL', 'PLUS'],
  additive: ['too', 'also', 'add', 'keep', 'both', 'as well', 'plus', 'another'],
  values: ['weekly', 'WEEKLY', 'Weekly', 'daily', 'log', '15', '5m', '1h', '2', '200'],
  emoji: ['🙂', '👍', '🚀'],
  thanks: ['thanks', 'thx', 'ty', 'cheers'],
  unverifiedTicker: ['NVDA', '$NVDA', 'nvda', '$QQQ', 'AAPL'],
  tickerLikeWord: ['FIX', 'GO', 'fix', 'go', 'NOW', 'ON', 'RUN', 'IT', 'ALL'],
  mixed: ['M5FT', 'msft2', 'MS-FT2'],
  praise: ['great', 'perfect', 'looks good', 'nice'],
  verbs: ['make', 'switch', 'show', 'set', 'put', 'change', 'move'],
  odd: ["don't", 'café', 'naïve', 'u', 'pls2', 'www', 'k', 'MSFTs', 'METAs'],
  quotedFresh: ['"add"', "'too'", '"weekly"'],
}
const SEPS = [', ', ' ', ' — ', '. ', '! ', ' (', '; ', ' - ', '... ']
// a small deterministic PRNG, so the generated set is the same on every run
let seed = 20261123
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
const pick = (xs) => xs[rnd(xs.length)]
const FRESH_ALL = Object.entries(FRESH).flatMap(([cls, xs]) => xs.map(x => [cls, x]))

function build(rejection, tokens) {
  let s = rejection
  for (const t of tokens) s += pick(SEPS) + t
  return s + pick(['', '.', '!', '?', ' 🙏'.slice(0, 0)])
}

const cases = []
// every fresh token after every rejection, alone and among pointers — must be UNLICENSED
for (const r of REJECT) {
  for (const [cls, f] of FRESH_ALL) {
    cases.push([cls, build(r, [f]), false])
    cases.push([cls, build(r, [pick(POINTER), f]), false])
    cases.push([cls, build(r, [f, pick(POINTER), pick(POINTER)]), false])
  }
}
// rejection + only pointers — LICENSED; pointers with no rejection — unlicensed
for (let k = 0; k < 400; k++) {
  const n = 1 + rnd(3)
  const toks = Array.from({ length: n }, () => pick(POINTER))
  cases.push(['pointers', build(pick(REJECT), toks), true])
  if (!toks.some(t => /^instead$/i.test(t))) cases.push(['no-rejection', toks.join(pick(SEPS)), false])
}
// mixed random: 1–3 tokens from either side; licensed iff no fresh token
for (let k = 0; k < 1500; k++) {
  const n = 1 + rnd(3)
  let fresh = false
  const toks = Array.from({ length: n }, () => { if (rnd(3) === 0) { fresh = true; return pick(FRESH_ALL)[1] } return pick(POINTER) })
  cases.push([fresh ? 'random-fresh' : 'random-pointers', build(pick(REJECT), toks), !fresh])
}

describe('the correction licence is default-deny: only rejections and verified pointers license it', () => {
  it(`${cases.length} generated messages`, () => {
    expect(cases.length).toBeGreaterThan(3000)
    const wrong = cases.filter(([, t, want]) => correctionLicensed(t, [A], BOARD) !== want).map(([cls, t, want]) => `${cls}: ${JSON.stringify(t)} → want ${want}`)
    expect(wrong).toEqual([])
  })
  it('a symbol counts as a pointer only when it is on this board (or the earlier chart)', () => {
    expect(correctionLicensed('no, the MSFT one', [A], BOARD)).toBe(true)
    expect(correctionLicensed('no, the MSFT one', [A], [A])).toBe(false)              // MSFT not on this board: unverified
    expect(correctionLicensed('no, $MSFT', [A], BOARD)).toBe(true)
    expect(correctionLicensed('no, $NVDA', [A], BOARD)).toBe(false)
    expect(correctionLicensed('no, the FIX one', [A], BOARD)).toBe(false)              // a ticker-like word off the board
    expect(correctionLicensed('no, the FIX one', [A], [A, 'FIX'])).toBe(true)
  })
  it('AUDIT\'s caps forms are unlicensed', () => {
    for (const t of ['no, MSFT weekly TOO', 'nope ALSO MSFT', 'oops ADD MSFT weekly', 'no wait KEEP META, MSFT weekly', 'no, MSFT WEEKLY too',
      'sorry, MSFT AS WELL', 'no, BOTH', 'nope, MSFT TOO']) expect([t, correctionLicensed(t, [A], BOARD)]).toEqual([t, false])
  })
  it('an explicit revert of the earlier change stays licensed', () => {
    for (const t of ['put META back', 'put the META chart back', 'undo that', 'revert it', 'undo META']) expect([t, correctionLicensed(t, [A], BOARD)]).toEqual([t, true])
  })
})
