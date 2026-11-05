// Production verification 11-05 (REAL-MODEL findings, reproduced here on a SCRIPTED model, through the REAL panel with a chart
// clicked): the value of a plan survives the "which chart?" question, a company's name finds its chart, a tab is named like a
// chart, and "this chart" with a chart clicked is not asked about.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { _resetGrounding } from './nl/tickers'
import { saidTimeframe } from './multiChart'

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
  it('"put the nvidia chart on the hourly" lands on NVDA at 1 hour, with no question, even if the plan said 1 minute', async () => {
    knowsNvidia()
    const { say, board } = mountOn()
    p.st.envelopes.push(p.env('apply', [setTf('b', '1')]))
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

describe('one timeframe in the words is the timeframe', () => {
  const ops = (tf) => [setTf('b', tf)]
  const said = (t, tf) => saidTimeframe(ops(tf), t)[0].args.timeframe
  it.each([['put it on the hourly', '1', '60'], ['make that weekly', 'D', 'W'], ['switch to the 5 minute', '1', '5'], ['daily please', 'W', 'D']])('%s', (t, tf, want) => expect(said(t, tf)).toBe(want))
  it('NEGATIVE: two in the sentence, or none, leave the plan alone', () => {
    expect(said('make the daily chart weekly', 'W')).toBe('W')
    expect(said('no, I wanted hourly bars, not 1 minute', '60')).toBe('60')
    expect(said('make it the usual', '15')).toBe('15')
  })
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
