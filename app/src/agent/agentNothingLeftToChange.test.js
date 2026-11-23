// NOTHING LEFT TO CHANGE (AUDIT 11-23): a whole-board quantifier whose exclusion covers EVERY chart — "set all to weekly but leave
// the daily ones alone" with every chart on daily — was asked about ("Which chart do you mean? Pick one:" offering only charts the
// member had excluded), and "…but not the daily ones" was not read as an exclusion at all (a plan on every chart would run).
// spatialCheck.everyExceptNothing reads the cover; useAgent answers one plain sentence and applies nothing. Class-generated:
//   (1) COVER: board × quantifier × exclusion form × a cover that is every chart — a TIMEFRAME description (every chart on it), a
//       TICKER on every chart, POSITIONS that together are the board, two timeframe descriptions whose union is the board.
//       → the verdict names every chart; its reason is the description (timeframe / ticker) or the charts.
//   (2) UNCHANGED (null — the gates run / ask exactly as before): a PARTIAL cover (one chart on another timeframe; a ticker on
//       some charts; one line of the board), a SINGULAR description on several charts ("the daily one"), a description the words
//       narrow ("the daily ones in the top row"), an extra exclusion the board cannot place ("…and the big chart"), a SCOPED
//       quantifier, no quantifier, and timeframe-set words that are no exclusion ("add RSI to all the daily charts").
//   (3) the sentence (nothingLeftText).
// The expected cover comes from the board's own construction (every chart's timeframe / symbol / cell), never from the reader.
// LOCAL (vitest, unit; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { everyExceptNothing, nothingLeftText, everyExceptSet } from './spatialCheck'

registerBuiltins()

const SYMS6 = ['SPY', 'QQQ', 'NVDA', 'AMD', 'MSFT', 'META']
function boardOf(R, C, { syms = SYMS6, tf = null, tfs = null } = {}) {
  const n = R * C, w = 24 / C
  const fb = makeBoard(Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, type: 'chart', x: (i % C) * w, y: Math.floor(i / C) * 10, w, h: 10, color: 'N',
    opts: { settings: mergeChartSettings(null), ...((tfs ? tfs[i] : tf) ? { tf: tfs ? tfs[i] : tf } : {}) },
  })), Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i}`, syms[i]])))
  return { name: `${R}x${C}`, R, C, n, live: () => fb.host.charts.list() }
}
const SHAPES = [[1, 3], [2, 2], [2, 3]]

const QUANTS = [
  { says: 'set all to monthly' }, { says: 'make each monthly' }, { says: 'set every one to monthly' }, { says: 'set the lot to monthly' },
  { says: 'set the rest to monthly', rest: true }, { says: 'set everything to monthly' }, { says: 'set every chart to monthly' },
  { says: 'set all of them to monthly' }, { says: 'add RSI to all' }, { says: 'add RSI to every chart' },
]
const FORMS = {
  'but leave X alone': (x) => ` but leave ${x} alone`,
  'except X': (x) => ` except ${x}`,
  'but not X': (x) => ` but not ${x}`,
  'apart from X': (x) => ` apart from ${x}`,
  'skip X': (x) => `, skip ${x}`,
  'keep X as is': (x) => `, keep ${x} as is`,
  "don't touch X": (x) => ` but don't touch ${x}`,
  'excluding X': (x) => ` excluding ${x}`,
  'other than X': (x) => ` other than ${x}`,
}
// the covers: [kind, board options, X, expected reason] — every one covers the whole board by construction
const TF_COVERS = [
  ['daily', null, ['the daily ones', 'the daily charts', 'the ones on daily', 'the dailies', 'my daily charts', 'the charts on the daily timeframe']],
  ['weekly', 'W', ['the weekly ones', 'the weekly charts', 'the weeklies', 'the ones set to weekly']],
  ['1h', '60', ['the 1h charts', 'the hourly ones', 'the 60 minute charts', 'the 1-hour ones']],
]
const COVERS = (R, C) => {
  const out = []
  for (const [, tf, xs] of TF_COVERS) for (const x of xs) out.push({ kind: 'timeframe', board: { tf }, x, why: 'timeframe' })
  for (const x of ['SPY', 'the SPY charts', 'the SPY ones', 'all the SPY charts']) out.push({ kind: 'ticker', board: { syms: Array(6).fill('SPY') }, x, why: 'ticker' })
  if (R === 1) out.push({ kind: 'position', board: {}, x: 'the top row', why: 'charts' })
  else out.push({ kind: 'position', board: {}, x: 'the top row and the bottom row', why: 'charts' })
  if (C === 2) out.push({ kind: 'position', board: {}, x: 'the left column and the right column', why: 'charts' })
  // two descriptions whose union is the board (the first chart weekly, the rest daily)
  out.push({ kind: 'union', board: { tfs: ['W', null, null, null, null, null] }, x: 'the daily ones and the weekly one', why: 'charts' })
  return out
}
// a sentence the quantifier and form read; `rest` only with no click and no subject (as useAgent passes it)
const say = (q, form, x) => `${q.says}${FORMS[form](x)}`

describe('(1) cover: an exclusion that is every chart → nothing left to change', () => {
  const rows = []
  for (const [R, C] of SHAPES) for (const cov of COVERS(R, C)) for (const q of QUANTS) for (const form of Object.keys(FORMS)) {
    // "the rest" with a ticker every chart shows reads as "the rest of SPY" — still covered; generated for every quantifier
    rows.push([`${R}x${C}`, cov.kind, say(q, form, cov.x), R, C, cov, q])
  }
  it(`${rows.length} generated sentences: every chart excluded, with the description as the reason`, () => {
    const miss = []
    for (const [, , text, R, C, cov, q] of rows) {
      const b = boardOf(R, C, cov.board)
      const all = b.live().map(c => c.ref).sort()
      const v = everyExceptNothing(text, b.live(), null, { rest: !!q.rest })
      if (!v || JSON.stringify([...v.excluded].sort()) !== JSON.stringify(all) || v.why.kind !== cov.why) miss.push(`${b.name} · ${text} → ${JSON.stringify(v)}`)
    }
    expect(miss).toEqual([])
  })
  it.each(SHAPES)('%sx%s: a click elsewhere — an unscoped quantifier still covers the whole board', (R, C) => {
    const b = boardOf(R, C)
    for (const text of ['set all to monthly but leave the daily ones alone', 'set every chart to monthly except the daily charts']) {
      const v = everyExceptNothing(text, b.live(), 'c1', {})
      expect(v?.excluded?.length, text).toBe(b.n)
    }
  })
  it('the AUDIT sentence on every board shape', () => {
    for (const [R, C] of SHAPES) {
      const b = boardOf(R, C)
      expect(everyExceptNothing('set all to weekly but leave the daily ones alone', b.live(), null, { rest: true })).toMatchObject({ why: { kind: 'timeframe', word: 'daily' } })
    }
  })
})

describe('(2) unchanged: a partial cover, an unplaceable exclusion, other meanings → null (the gates decide as before)', () => {
  const partial = []
  for (const [R, C] of SHAPES) {
    const n = R * C
    // one chart on another timeframe: the timeframe cover is partial, at every position
    for (let k = 0; k < n; k++) {
      const tfs = Array.from({ length: n }, (_, i) => (i === k ? 'W' : null))
      for (const x of ['the daily ones', 'the daily charts', 'the dailies']) for (const q of QUANTS) for (const form of Object.keys(FORMS)) partial.push([`${R}x${C} weekly@${k}`, say(q, form, x), { tfs }, q])
    }
    // a ticker on SOME charts (two of them)
    const syms = SYMS6.slice(0, n).map((s, i) => (i < 2 ? 'SPY' : s))
    for (const q of QUANTS) for (const form of Object.keys(FORMS)) partial.push([`${R}x${C} SPY×2`, say(q, form, 'SPY'), { syms }, q])
    // one line of a two-row board
    if (R === 2) for (const q of QUANTS) for (const form of Object.keys(FORMS)) partial.push([`${R}x${C} row`, say(q, form, 'the top row'), {}, q])
  }
  it(`${partial.length} partial covers: null`, () => {
    const miss = []
    for (const [name, text, opts, q] of partial) {
      const b = boardOf(name.startsWith('1x3') ? 1 : 2, name.startsWith('2x3') || name.startsWith('1x3') ? 3 : 2, opts)
      const v = everyExceptNothing(text, b.live(), null, { rest: !!q.rest })
      if (v) miss.push(`${name} · ${text}`)
    }
    expect(miss).toEqual([])
  })
  // [why, sentence, board options]
  const NOT = [
    ['singular description on several charts', 'set all to monthly but leave the daily one alone', {}],
    ['singular description on several charts', 'set every chart to monthly except the daily chart', {}],
    ['singular ticker description on several charts', 'set every chart to monthly except the SPY chart', { syms: Array(6).fill('SPY') }],
    ['singular ticker possessive', "set all to monthly but leave SPY's chart alone", { syms: Array(6).fill('SPY') }],
    ['a description the words narrow', 'set every chart to monthly except the daily ones in the top row', {}],
    ['a description the words narrow', 'set all to monthly but leave the daily ones on the left alone', {}],
    ['a description the words narrow', 'set all to monthly but leave the daily ones with RSI alone', {}],
    ['an extra exclusion the board cannot place', 'set all to monthly but leave the daily ones and the big chart alone', {}],
    ['a scoped quantifier', 'set every chart in the top row to monthly except the daily ones', {}],
    ['no quantifier', 'set SPY to monthly but leave the daily ones alone', {}],
    ['no quantifier', 'make it monthly but leave the daily ones alone', {}],
    ['a timeframe set, no exclusion', 'add RSI to all the daily charts', {}],
    ['a timeframe set, no exclusion', 'set all the daily charts to monthly', {}],
    ['a timeframe set, no exclusion', 'set the daily ones to monthly', {}],
    ['no chart on that timeframe', 'set all to monthly but leave the weekly ones alone', {}],
    ['an indicator, not a chart', 'remove all indicators but leave the daily ones alone', {}],
    ['a value, not a chart', 'hide all except volume', {}],
  ]
  it.each(SHAPES.flatMap(([R, C]) => NOT.map(([why, t, o]) => [`${R}x${C}`, why, t, R, C, o])))('%s · %s · "%s"', (_b, _why, text, R, C, o) => {
    const b = boardOf(R, C, o)
    expect(everyExceptNothing(text, b.live(), null, { rest: true })).toBeNull()
  })
  it('a single chart is never this family (nothing to leave out of a board of one)', () => {
    const b = boardOf(1, 1, {})
    expect(everyExceptNothing('set all to monthly but leave the daily ones alone', b.live(), null, { rest: true })).toBeNull()
  })
  it('everyExceptSet is unchanged by the split: a cover is still no set, a partial exclusion still the rest', () => {
    const b = boardOf(2, 2)
    expect(everyExceptSet('set every chart to monthly except the top row and the bottom row', b.live(), null)).toBeNull()
    expect(everyExceptSet('set every chart to monthly except the top row', b.live(), null)).toEqual({ refs: ['c2', 'c3'], excluded: ['c0', 'c1'] })
  })
})

describe('(3) the sentence', () => {
  it('names the description, or the charts, and says nothing changed', () => {
    expect(nothingLeftText({ why: { kind: 'timeframe', word: 'daily' } }, 4)).toBe('Every chart here is on daily, so that leaves nothing to change. Nothing has changed.')
    expect(nothingLeftText({ why: { kind: 'ticker', word: 'SPY' } }, 4)).toBe('Every chart here shows SPY, so that leaves nothing to change. Nothing has changed.')
    expect(nothingLeftText({ why: { kind: 'charts', word: null } }, 3)).toBe('The charts you asked me to leave alone are all 3 charts here, so that leaves nothing to change. Nothing has changed.')
  })
})
