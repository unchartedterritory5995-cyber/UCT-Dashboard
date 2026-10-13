// UCT Agent — Gate B safety regressions (owner 2026-10-13): the three wrong actions the held-out set found.
//   "open swing"      must not pick the Swing watchlist OR the Swing Board layout on its own
//   "remove momentum" must not pick the Momentum watchlist OR a momentum indicator on its own
//   "pull up amzon"   must not change the chart to an unverified ticker (refused; one real near ticker
//                     may be SUGGESTED in words, never applied)
// "Zero unintended mutations, not maximizing deterministic routing coverage at any cost."
import { describe, it, expect, beforeEach, vi } from 'vitest'
import corpus from './__fixtures__/nlIntent/corpus.json'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { getCapability } from './capabilities'
import { makeBoard } from './__fixtures__/board'
import { namedKinds, wordsName } from './nl/collisions'
import { groundSymbols, suggestionText, _resetGrounding } from './nl/tickers'

registerBuiltins()

function host({ layouts = corpus.library.layouts, watchlists = corpus.library.watchlists } = {}) {
  const fx = corpus.fixtures.one_chart
  const charts = fx.charts.map(c => ({ id: c.id, type: 'chart', x: c.x, y: c.y, w: c.w, h: c.h, color: c.id, opts: { tf: c.tf } }))
  const syms = Object.fromEntries(fx.charts.map(c => [c.id, c.symbol]))
  return makeBoard(charts, syms, { layouts: { entries: layouts, boards: {}, active: corpus.library.activeLayout }, watchlists }).host
}
const actions = (r) => (r?.kind === 'ops' ? r.ops.map(o => o.action) : r)

describe('one name, two kinds of thing — never picked by the instant path', () => {
  it('"open swing" (Swing watchlist + Swing Board layout) goes to the model path, which asks', () => {
    const h = host()
    expect([...namedKinds(h, 'swing')].sort()).toEqual(['layout', 'watchlist'])
    for (const t of ['open swing', 'Open Swing', 'pull up swing', 'load my swing']) expect(fastParse(t, { host: h })).toBeNull()
  })

  it('naming the kind removes the doubt (unchanged fast paths)', () => {
    const h = host()
    expect(actions(fastParse('open swing watchlist', { host: h }))).toEqual(['watchlist.open'])
    expect(actions(fastParse('open my swing list', { host: h }))).toEqual(['watchlist.open'])
    expect(actions(fastParse('open swing board', { host: h }))).toEqual(['layout.open'])
    expect(actions(fastParse('open day trading', { host: h }))).toEqual(['layout.open'])
    expect(actions(fastParse('open earnings plays', { host: h }))).toEqual(['watchlist.open'])
  })

  it('a name only ONE kind uses is still instant (no needless question)', () => {
    const h = host({ layouts: corpus.library.layouts.filter(l => !/swing/i.test(l.name)) })
    expect(actions(fastParse('open swing', { host: h }))).toEqual(['watchlist.open'])
  })

  it('"remove momentum" (Momentum watchlist) is not read as an indicator; "the momentum indicator" and "remove rsi" still are', () => {
    const h = host()
    expect(fastParse('remove momentum', { host: h })).toBeNull()
    expect(fastParse('get rid of momentum', { host: h })).toBeNull()
    expect(actions(fastParse('remove rsi', { host: h }))).toEqual(['indicator.remove'])
    const noList = host({ watchlists: corpus.library.watchlists.filter(l => l.name !== 'Momentum') })
    const r = fastParse('remove momentum', { host: noList })
    // with no colliding name, whatever the indicator vocabulary reads is unchanged (and still a proposal)
    if (r) expect(actions(r)).toEqual(['indicator.remove'])
    expect(getCapability('indicator.remove').risk).toBe('confirm')
  })

  it('names match whole words only — never a substring or a typo', () => {
    expect(wordsName('swing', 'Swing Board')).toBe(true)
    expect(wordsName('my swing layout', 'Swing Board')).toBe(true)
    expect(wordsName('swin', 'Swing Board')).toBe(false)
    expect(wordsName('board', 'Swing Board')).toBe(false)
    expect(wordsName('day', 'Day Trading')).toBe(true)
    expect(wordsName('trading', 'Day Trading')).toBe(false)
  })
})

describe('"pull up amzon" — an unverified ticker is refused, a near ticker only suggested', () => {
  beforeEach(() => _resetGrounding())

  const searchOf = (table) => vi.fn(async (url) => {
    const q = decodeURIComponent(/q=([^&]+)/.exec(url)[1]).toUpperCase()
    return { ok: true, json: async () => ({ results: table.filter(r => r.ticker.startsWith(q.slice(0, 3)) || r.ticker === q) }) }
  })

  it('AMZON is unknown; the refusal suggests AMZN and nothing is applied', async () => {
    const fetchFn = searchOf([{ ticker: 'AMZN', name: 'Amazon.com Inc' }, { ticker: 'AMD', name: 'Advanced Micro Devices' }])
    const g = await groundSymbols(['AMZON'], { fetchFn })
    expect([...g.unknown]).toEqual(['AMZON'])
    const msg = getCapability('chart.setSymbol').check({ symbol: 'NVDA', cs: {} }, { symbol: 'AMZON' }, { unknownSymbols: g.unknown })
    expect(msg).toBe('UCT has no symbol “AMZON”. Did you mean AMZN (Amazon.com Inc)?')
  })

  it('two equally near tickers → no suggestion at all (never a guess)', async () => {
    const fetchFn = searchOf([{ ticker: 'ABCD', name: 'A' }, { ticker: 'ABCF', name: 'B' }])
    await groundSymbols(['ABCE'], { fetchFn })
    expect(suggestionText('ABCE')).toBe('')
  })

  it('the instant path never corrects a ticker by itself', () => {
    const h = host()
    const r = fastParse('pull up amzon', { host: h })
    // the instant path may propose the member's literal word as a ticker; the planner's ticker check refuses it
    if (r) expect(r.ops.map(o => o.args.symbol)).toEqual(['AMZON'])
  })
})
