// Production verification 11-05 (REAL-MODEL findings, reproduced here on a SCRIPTED model, through the REAL panel with a chart
// clicked): the value of a plan survives the "which chart?" question and the model's plan keeps its value, a company's name finds
// its chart, a tab is named like a chart, and a true "this chart" with a chart clicked is not asked about. Everything else that
// disagrees with the click is still asked (AUDIT N1).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { _resetGrounding } from './nl/tickers'
import { NAME_SEARCH_MS } from './useAgent'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel(); _resetGrounding() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const stacked = (top = {}, bottom = {}) => [[
  { id: 't', type: 'chart', x: 0, y: 0, w: 24, h: 10, color: 'N', opts: { settings: bareSettings(), ...top } },
  { id: 'b', type: 'chart', x: 0, y: 10, w: 24, h: 10, color: 'N', opts: { settings: bareSettings(), ...bottom } },
], { 'N:t': 'AAPL', 'N:b': 'NVDA' }]
const mountOn = ({ clicked = 't', top, bottom } = {}) => { const m = p.mount(...stacked(top, bottom)); if (clicked) p.select(clicked); return m }
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const setTf = (target, timeframe) => ({ action: 'chart.setTimeframe', target, args: { timeframe } })
/** The ticker search knows NVIDIA by its company name (the harness's own answers the ticker it is asked for). */
const knowsNvidia = () => {
  const inner = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init) => {
    if (/ticker-search\?q=nvidia/i.test(String(url))) return new Response(JSON.stringify({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corporation' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    return inner(url, init)
  })
}

describe('a company name, with the other chart clicked', () => {
  it('"put the nvidia chart on the hourly" lands on NVDA at 1 hour, with no question', async () => {
    knowsNvidia()
    const { say, board } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('b', '60')]))
    await say('put the nvidia chart on the hourly')
    expect(tfOf(board, 'b')).toBe('60')
    expect(tfOf(board, 't')).toBe('D')
    expect(screen.queryAllByRole('button').filter(x => /chart \(/i.test(x.textContent))).toHaveLength(0)
  }, 30000)
  it('NEGATIVE: a plan aimed at the clicked chart for that name is not obeyed', async () => {
    knowsNvidia()
    const { say, board } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('t', '60')]))
    await say('put the nvidia chart on the hourly')
    expect(tfOf(board, 't')).toBe('D')
  }, 30000)
})

describe('a clarify choice keeps the value', () => {
  it('the name is unread, so it asks; the pick runs the plan with its value', async () => {
    const { say, click, board } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('b', '60')]))
    await say('put the qwzzx chart on the hourly')
    await click(/NVDA/)
    expect(tfOf(board, 'b')).toBe('60')
    expect(tfOf(board, 't')).toBe('D')
  }, 30000)
})

// AUDIT N2: the plan's value is the value. The words are never read over it (an earlier override changed correct plans).
describe('the plan keeps its timeframe, with a chart clicked', () => {
  it.each([
    ['flip the AAPL daily chart over to 1h', '60'],
    ['flip the weekly view on AAPL to 30m', '30'],
    ['the AAPL chart is on daily, bump it up one timeframe step', 'W'],
    ['the 5 minute is noisy on the AAPL chart, go to the next timeframe up', '15'],
  ])('%s', async (t0, tf) => {
    const { say, board } = mountOn({ clicked: 't' })
    p.st.envelopes.push(p.env('apply', [setTf('t', tf)]))
    await say(t0)
    expect(tfOf(board, 't')).toBe(tf)
    expect(tfOf(board, 'b')).toBe('D')
  }, 30000)
})

describe('a tab is named like a chart', () => {
  const tabs = { chartTabs: [{ id: 'x1', tf: '60', color: 'A' }, { id: 'x2', tf: 'W', color: 'A' }] }
  it('"remove the RSI from the AAPL tab": the AAPL chart, with NVDA clicked', async () => {
    const { say, click, board } = mountOn({ clicked: 'b', top: tabs })
    await say('add rsi to the AAPL chart')
    await say('add rsi to the NVDA chart')
    const n = p.turns()
    await say('remove the RSI from the AAPL tab')
    if (screen.queryByRole('button', { name: 'Apply' })) await click('Apply')
    expect(p.turns()).toBe(n)
    expect(p.instancesOn(board, 't').filter(i => i.defId === 'rsi')).toHaveLength(0)
    expect(p.instancesOn(board, 'b').filter(i => i.defId === 'rsi')).toHaveLength(1)
  }, 30000)
  it('the board context says what each chart tab shows, main tab included', async () => {
    const { say } = mountOn({ top: { ...tabs, chartTabs: [{ id: 'x1', tf: '60', color: 'B' }] } })
    await say('kindly tell me about my tabs here')
    const row = p.lastTurnBody().context.board[0].widgets.find(w => w.id === 't')
    expect(row.chartTabs[0]).toMatchObject({ tab: 'main', symbol: 'AAPL' })
  }, 30000)
})

describe('a name in the words is searched for once, boundedly', () => {
  const searches = () => p.st.calls.filter(c => /ticker-search/.test(c[1]))
  it('a common word is not searched for', async () => {
    const { say } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('b', 'W')]))
    await say('put the price chart on the weekly')
    expect(searches().filter(c => /q=price/i.test(c[1]))).toHaveLength(0)
  }, 30000)
  it('a search that never answers does not hold the turn', async () => {
    const inner = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (/ticker-search/.test(String(url)) ? new Promise(() => {}) : inner(url, init)))
    const { say, board } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('t', 'W')]))
    const t0 = Date.now()
    await say('put the qwzzx chart on the weekly')
    expect(Date.now() - t0).toBeLessThan(NAME_SEARCH_MS + 3000)
    expect(tfOf(board, 'b')).toBe('D')
  }, 30000)
})

describe('a closed tab, with a chart clicked', () => {
  const closed = { chartTabs: [{ id: 'x1', tf: 'D', color: 'B' }] }
  const onTabs = () => { const [w, s] = stacked(closed, {}); const m = p.mount(w, { ...s, B: 'TSLA' }); p.select('t'); return m }
  it('"flip the TSLA tab over to the weekly view": said, and the open AAPL tab does not change', async () => {
    const { say, board } = onTabs()
    p.st.envelopes.push(p.env('apply', [setTf('t', 'W')]))
    await say('kindly flip the TSLA tab over to the weekly view')
    expect(tfOf(board, 't')).toBe('D')
    expect(p.transcript()).toMatch(/TSLA tab isn't the open tab/)
  }, 30000)
  it('the same with nothing clicked', async () => {
    const [w, s] = stacked(closed, {})
    const { say, board } = p.mount(w, { ...s, B: 'TSLA' })
    p.st.envelopes.push(p.env('apply', [setTf('t', 'W')]))
    await say('kindly flip the TSLA tab over to the weekly view')
    expect(tfOf(board, 't')).toBe('D')
  }, 30000)
  it('NEGATIVE: a request about the tab itself is not refused', async () => {
    const { say } = onTabs()
    p.st.envelopes.push(p.env('answer', [], 'scripted answer'))
    await say('what is on the TSLA tab')
    expect(p.transcript()).not.toMatch(/isn't the open tab/)
  }, 30000)
})

// AUDIT N1: "the chart", "the symbol", "my chart" are not "this". A plan that disagrees with the click is asked about, never moved.
describe('NEGATIVE: words other than a true "this" never move a plan to the clicked chart', () => {
  const quad = () => {
    const c = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
    const m = p.mount([c('c0', 0, 0), c('c1', 12, 0), c('c2', 0, 10), c('c3', 12, 10)], { 'N:c0': 'AAPL', 'N:c1': 'MSFT', 'N:c2': 'NVDA', 'N:c3': 'TSLA' })
    p.select('c0')
    return m
  }
  it.each([
    ['kindly flip the chart in the bottom right corner over to the weekly view', setTf('c3', 'W')],
    ['please swap the symbol over on the bottom right one to META', { action: 'chart.setSymbol', target: 'c3', args: { symbol: 'META' } }],
    ['take the ticker showing tesla and flip it over to the weekly view', setTf('c3', 'W')],
    ['kindly flip the chart in the last cell over to the weekly view', setTf('c3', 'W')],
    ['kindly flip the chart of Tesla over to the weekly view', setTf('c3', 'W')],
  ])('%s', async (t0, op) => {
    const { say, board } = quad()
    p.st.envelopes.push(p.env('apply', [op]))
    await say(t0)
    expect(tfOf(board, 'c0')).toBe('D')
    expect(board.state.groupSyms['N:c0']).toBe('AAPL')
    expect(p.transcript()).toMatch(/Did you mean|Which chart/)
  }, 30000)
  it('NEGATIVE: "this" with a position in the same sentence is asked too', async () => {
    const { say, board } = quad()
    p.st.envelopes.push(p.env('apply', [setTf('c3', 'W')]))
    await say('kindly flip this chart in the bottom right over to the weekly view')
    expect(tfOf(board, 'c0')).toBe('D')
  }, 30000)
})

describe('"this chart" with a chart clicked', () => {
  it('a plan aimed at the other chart goes to the clicked one, with no question', async () => {
    const { say, board } = mountOn({ clicked: 't' })
    p.st.envelopes.push(p.env('apply', [setTf('b', 'W')]))
    await say('kindly flip this chart over to the weekly')
    expect(tfOf(board, 't')).toBe('W')
    expect(tfOf(board, 'b')).toBe('D')
  }, 30000)
  it('"make this one weekly": no model call', async () => {
    const { say, board } = mountOn({ clicked: 'b' })
    const n = p.turns()
    await say('make this one weekly')
    expect(tfOf(board, 'b')).toBe('W')
    expect(tfOf(board, 't')).toBe('D')
    expect(p.turns()).toBe(n)
  }, 30000)
  it('NEGATIVE: nothing clicked still asks', async () => {
    const { say, board } = mountOn({ clicked: null })
    p.st.envelopes.push(p.env('apply', [setTf('b', 'W')]))
    await say('kindly flip this chart over to the weekly')
    expect(tfOf(board, 'b')).toBe('D')
    expect(p.transcript()).toMatch(/Which chart/)
  }, 30000)
})
