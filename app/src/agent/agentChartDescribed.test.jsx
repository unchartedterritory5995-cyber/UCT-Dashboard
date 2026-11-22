// AUDIT #858 D1: a chart the member DESCRIBES ("the empty one", "the chart with rsi") is the target, and the clicked chart never
// stands in for it. Through the REAL panel on the fixture board with a chart CLICKED, the model scripted (no paid call).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const rsi = { id: 'r1', defId: 'rsi', inputs: {}, visible: true }
const settings = (on) => (on ? { ...bareSettings(), indicatorInstances: [...(bareSettings().indicatorInstances || []), rsi] } : bareSettings())
const cell = (id, x, y, withRsi = false) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: settings(withRsi) } })
// 2×2: c0 clicked and showing a ticker; `syms` says which cells are empty; `ind` which carry the RSI
const board = (syms, ind = []) => [[cell('c0', 0, 0, ind.includes('c0')), cell('c1', 12, 0, ind.includes('c1')), cell('c2', 0, 10, ind.includes('c2')), cell('c3', 12, 10, ind.includes('c3'))],
  Object.fromEntries(Object.entries(syms).filter(([, s]) => s != null).map(([k, s]) => [`N:${k}`, s]))]
const blanks = (m, ids) => (s) => (ids.includes(s.ref) ? { ...m(s), symbol: null } : m(s))
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const mountOn = (syms, { empty = [], ind = [], clicked = 'c0' } = {}) => {
  const [w, g] = board(syms, ind)
  const m = p.mount(w, g, { decorate: blanks(label, empty) })
  if (clicked) p.select(clicked)
  return m
}
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const choices = () => screen.queryAllByRole('button').map(b => b.textContent).filter(t => /^Chart \(/.test(t))
const FULL = { c0: 'AAPL', c1: 'AMD', c2: 'MSFT', c3: 'NVDA' }

describe('a described chart with another chart clicked', () => {
  it.each([['put SPY on the empty one'], ['put SPY on the blank cell'], ['put SPY on the empty chart'], ['put SPY in the unused slot']])('%s: the one empty chart, never the clicked one', async (t) => {
    const { say, board: b } = mountOn(FULL, { empty: ['c3'] })
    await say(t)
    expect(symOf(b, 'c0')).toBe('AAPL')
    expect(symOf(b, 'c3')).toBe('SPY')
  }, 30000)
  it('two empty cells, another chart clicked: asks, offering only those two, and nothing changes', async () => {
    const { say, board: b } = mountOn(FULL, { empty: ['c2', 'c3'] })
    await say('put SPY on the empty chart')
    expect(symOf(b, 'c0')).toBe('AAPL')
    expect(choices().sort()).toEqual(['Chart (c2)', 'Chart (c3)'])
  }, 30000)
  it('two empty cells, nothing clicked: the same two', async () => {
    const { say } = mountOn(FULL, { empty: ['c2', 'c3'], clicked: null })
    await say('put SPY on the empty chart')
    expect(choices().sort()).toEqual(['Chart (c2)', 'Chart (c3)'])
  }, 30000)
  it('two empty cells, one of them clicked: that one', async () => {
    const { say, board: b } = mountOn(FULL, { empty: ['c2', 'c3'], clicked: 'c3' })
    await say('put SPY on the empty chart')
    expect(symOf(b, 'c3')).toBe('SPY')
    expect(symOf(b, 'c2')).toBe('MSFT')
  }, 30000)
  it.each([['make the one with rsi weekly'], ['make the chart with rsi weekly'], ['make the rsi chart weekly']])('%s (RSI on c2 only): c2, never the clicked c0', async (t) => {
    const { say, board: b } = mountOn(FULL, { ind: ['c2'] })
    await say(t)
    expect(tfOf(b, 'c0')).toBe('D')
    expect(tfOf(b, 'c2')).toBe('W')
  }, 30000)
  it('the RSI on two charts, neither clicked: asks between those two; nothing changes', async () => {
    const { say, board: b } = mountOn(FULL, { ind: ['c2', 'c3'] })
    await say('make the chart with rsi weekly')
    expect(tfOf(b, 'c0')).toBe('D')
    expect(choices().sort()).toEqual(['Chart (c2)', 'Chart (c3)'])
  }, 30000)
  it('the RSI on two charts, one clicked: that one', async () => {
    const { say, board: b } = mountOn(FULL, { ind: ['c2', 'c3'], clicked: 'c3' })
    await say('make the chart with rsi weekly')
    expect(tfOf(b, 'c3')).toBe('W')
    expect(tfOf(b, 'c2')).toBe('D')
  }, 30000)
  it('NEGATIVE: described, but nothing fits: the clicked chart is not used', async () => {
    const a = mountOn(FULL)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setSymbol', target: 'c0', args: { symbol: 'SPY' } }]))
    await a.say('put SPY on the empty chart')
    expect(symOf(a.board, 'c0')).toBe('AAPL')
    cleanup()
    p = setupPanel()
    const b = mountOn(FULL)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setTimeframe', target: 'c0', args: { timeframe: 'W' } }]))
    await b.say('make the chart with rsi weekly')
    expect(tfOf(b.board, 'c0')).toBe('D')
  }, 30000)
  it('the same holds for a symbol two charts show, with a third clicked', async () => {
    const { say, board: b } = mountOn({ c0: 'AAPL', c1: 'NVDA', c2: 'NVDA', c3: 'AMD' })
    await say('make the NVDA chart weekly')
    expect(tfOf(b, 'c0')).toBe('D')
    expect(choices().sort()).toEqual(['Chart (c1)', 'Chart (c2)'])
  }, 30000)
  it('NEGATIVE: a bare command still goes to the clicked chart', async () => {
    const { say, board: b } = mountOn(FULL)
    await say('switch to weekly')
    expect(tfOf(b, 'c0')).toBe('W')
  }, 30000)
})
