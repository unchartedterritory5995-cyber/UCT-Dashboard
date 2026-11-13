// HOTFIX (negated-ticker targeting) — LAYER 1, the READER (spatialCheck.excludedCharts), unit, nothing else involved.
// A live wrong-chart write: "set all charts to weekly, but leave NVDA's alone", "earnings strip on all of them, skip NVDA's",
// "…; dont touch NVDA" — the plan named every chart and NVDA's was changed. Same class as #1143 / #1148. The family, written
// as cue × object form × position (own phrasings): every cell must place NVDA's chart (and only it) as excluded.
// Fail-closed: a negated ticker the board cannot place (on two charts, an unknown possessive, a relation from a ticker) is
// UNPLACED. Controls: the over-capture baseline reads nothing. LOCAL (vitest, unit).
import { describe, it, expect } from 'vitest'
import { excludedCharts, everyExceptSet, negTickerRefs, UNPLACED } from './spatialCheck'

const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
  { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
const ex = (t, board = B, sel = null) => [...excludedCharts(t, board, sel)].sort()

// the cue forms (each a function of the object), the object forms, the positions
export const CUES = {
  leave: (o) => `leave ${o} alone`,
  'leave … out': (o) => `leave ${o} out of it`,
  'leave out': (o) => `leave out ${o}`,
  'leave as is': (o) => `leave ${o} as it is`,
  keep: (o) => `keep ${o} as it is`,
  'keep out': (o) => `keep ${o} out of this`,
  'keep at setting': (o) => `keep ${o} on daily`,
  skip: (o) => `skip ${o}`,
  not: (o) => `not ${o} though`,
  'hands off': (o) => `hands off ${o}`,
  ignore: (o) => `ignore ${o}`,
  "don't touch": (o) => `don't touch ${o}`,
  'dont touch': (o) => `dont touch ${o}`,
  'don’t change': (o) => `don’t change ${o}`,
  'do not touch': (o) => `do not touch ${o}`,
  'never touch': (o) => `never touch ${o}`,
  exclude: (o) => `exclude ${o}`,
  spare: (o) => `spare ${o}`,
  without: (o) => `without ${o}`,
  'with the exception of': (o) => `with the exception of ${o}`,
  'stays (before the verb)': (o) => `${o} can stay as it is`,
  'is fine (before the verb)': (o) => `${o} is fine as it is`,
}
export const OBJECTS = ["NVDA's", "NVDA's chart", 'the NVDA one', 'the NVDA chart', 'NVDA', 'nvda']
const CHANGE = 'set every chart to weekly'
const cap = (s) => s[0].toUpperCase() + s.slice(1)
export const POSITIONS = {
  'but (after)': (n) => `${CHANGE}, but ${n}`,
  'comma (after)': (n) => `${CHANGE}, ${n}`,
  'semicolon (after)': (n) => `${CHANGE}; ${n}`,
  'colon (after)': (n) => `${CHANGE}: ${n}`,
  'em dash (after)': (n) => `${CHANGE} — ${n}`,
  'en dash (after)': (n) => `${CHANGE} – ${n}`,
  'next sentence (after)': (n) => `${cap(CHANGE)}. ${cap(n)}.`,
  'first sentence (before)': (n) => `${cap(n)}. ${cap(CHANGE)}.`,
  'comma (before)': (n) => `${cap(n)}, ${CHANGE}`,
  'and (before)': (n) => `${cap(n)} and ${CHANGE}`,
}
const FAMILY = Object.entries(CUES).flatMap(([cue, f]) => OBJECTS.map(o => [cue, o, f(o)]))
  .flatMap(([cue, o, n]) => Object.entries(POSITIONS).map(([pos, g]) => [cue, o, pos, g(n)]))

describe('layer 1 (reader): a negated ticker clause excludes exactly that ticker\'s chart', () => {
  it('the family covers every cue, object form and position', () => {
    expect(FAMILY.length).toBe(Object.keys(CUES).length * OBJECTS.length * Object.keys(POSITIONS).length)
  })
  it.each(FAMILY)('%s × %s × %s: "%s" → NVDA\'s chart', (_c, _o, _p, t) => {
    expect(ex(t)).toEqual(['c'])
  })
  it.each([
    ['set every chart to weekly, but leave NVDA and AMD alone', ['c', 'd']],
    ["skip NVDA's and AMD's, set all of them to weekly", ['c', 'd']],
    ['set all charts to weekly; dont touch NVDA or AMD', ['c', 'd']],
  ])('a list of tickers: "%s" → each', (t, refs) => {
    expect(ex(t)).toEqual(refs)
  })
  it('the reviewer\'s original live failures', () => {
    expect(ex("set all charts to weekly, but leave NVDA's alone")).toEqual(['c'])
    expect(ex("earnings strip on all of them, skip NVDA's")).toEqual(['c'])
    expect(ex('make every chart weekly. Not the NVDA chart though.')).toEqual(['c'])
    expect(ex("make every chart weekly apart from NVDA's")).toEqual(['c'])
    expect(ex("make every chart weekly other than NVDA's")).toEqual(['c'])
    expect(ex('all charts weekly; dont touch NVDA')).toEqual(['c'])
    expect(ex('hands off the NVDA chart')).toEqual(['c'])
    expect(ex('make every chart weekly. Leave NVDA out of it.')).toEqual(['c'])
  })
  it.each([
    ['make every chart weekly except for the NVDA one'], ["make every chart weekly with the exception of NVDA's chart"],
    ['spare NVDA and make every chart weekly'], ['make every chart weekly excluding the NVDA chart'], ['ignore NVDA and make every chart weekly'],
    ['keep NVDA on daily, make every chart weekly'], ['make every chart weekly but not on the NVDA one'],
  ])('already placed before / kept: "%s" → NVDA\'s chart', (t) => {
    expect(ex(t)).toEqual(['c'])
  })
})

// ── FAIL CLOSED: a negated ticker the board cannot place is UNPLACED (asked) — never nothing ──
const TWICE = [{ ref: 'a', symbol: 'SPY' }, { ref: 'b', symbol: 'TSLA' }, { ref: 'c', symbol: 'NVDA' }, { ref: 'd', symbol: 'TSLA' }]
describe('fail closed: an unplaceable negated ticker is UNPLACED', () => {
  it.each([
    ["set every chart to weekly, but leave SPY's neighbour alone"], ['set every chart to weekly; hands off the one beside NVDA'],
    ["set every chart to weekly, skip Apple's"], ["Leave Microsoft's alone and set every chart to weekly"],
  ])('"%s" → UNPLACED', (t) => {
    expect(ex(t)).toContain(UNPLACED)
  })
  it.each([['set every chart to weekly; dont touch TSLA'], ["set all charts to weekly, but leave TSLA's alone"], ['Not the TSLA chart though. Set every chart to weekly.']])(
    'a ticker on TWO charts: "%s" → UNPLACED, and both are never offered (unoffered)', (t) => {
      const r = excludedCharts(t, TWICE, null)
      expect([...r]).toContain(UNPLACED)
      expect([...r.unoffered].sort()).toEqual(['b', 'd'])
    })
  it('a plain ticker the board does not show is no chart to protect (master policy): nothing', () => {
    expect(ex('set every chart to weekly; dont touch MSFT')).toEqual([])
  })
})

// ── the over-capture baseline: these read nothing (they behave as on master) ──
describe('control: no over-capture', () => {
  it.each([
    ['leave it on weekly'], ['keep the RSI'], ['keep the RSI as it is'], ["don't touch the axis"], ['skip to the next bar'], ['make it weekly, not the chart I meant'],
    ["show Apple's earnings on every chart"], ["make SPY's neighbour weekly"], ['make NVDA weekly and leave it there'], ["NVDA's chart on weekly"],
    ["earnings strip on every chart, Apple's earnings are next week"], ['weekly for NVDA, keep the RSI as it is'], ['keep NVDA on weekly'],
    ["add MACD to all charts but leave NVDA's RSI alone"], ['make everything weekly, not daily'], ['skip the intro and set every chart to weekly'],
    ['set every chart to weekly, not now'], ['leave the rest as they are'],
  ])('"%s" → nothing', (t) => {
    expect(ex(t)).toEqual([])
    expect(negTickerRefs(t, B)).toEqual([])
  })
})

// ── the set question: "every chart …, but leave NVDA's alone" is the set every chart but NVDA (never a single pick) ──
describe('everyExceptSet reads a negated ticker beside the quantifier', () => {
  it.each([["set every chart to weekly, but leave NVDA's alone"], ['all charts weekly; dont touch NVDA'], ['Leave the NVDA one alone and set every chart to weekly']])('"%s"', (t) => {
    const s = everyExceptSet(t, B.map((c, i) => ({ ...c, cell: { x: (i % 2) * 8, y: Math.floor(i / 2) * 10, w: 8, h: 10 } })), null)
    expect(s?.refs?.sort()).toEqual(['a', 'b', 'd'])
  })
})
