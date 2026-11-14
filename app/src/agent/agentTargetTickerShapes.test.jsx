// AUDIT held-out (11-13, t1/t2) — the target-ticker reader in ANY verb position. deixis.targetTickers reads a ticker as the chart
// being changed after any verb ("take / move / bring / put / set / get AMD to weekly"), and verb-less ("AMD on weekly please",
// "AMD weekly", "AMD to 1h", "AMD with a 20 EMA"). Through the REAL panel (panelHarness), scripted plans on the SPY chart:
//   TARGET-SHAPED  (an off-board ticker as the subject)  → asked, 0 writes
//   VALUE-SHAPED   (the ticker is the plan's setSymbol value: "switch to AMD", "make this one AMD", "load AMD here instead",
//                  "flip it to AMD")                     → the symbol change runs
//   ON-BOARD SUBJECT ("SPY on weekly", SPY on the board) → the change runs
// × { one chart, one chart + an exclusion, SPY clicked, SPY clicked + an exclusion, three charts }.
// (Value shapes on three charts carry the click: with nothing naming a chart, "switch to AMD" on three charts is genuinely open.)
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean/i.test(transcript())
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const snapshot = (b, ids) => ids.map(id => [stored(b, id), symOf(b, id)])
const spyRef = (body) => body.context.charts.find(c => c.label === 'Chart (SPY)').ref
const OPS = {
  timeframe: (b) => ({ action: 'chart.setTimeframe', target: spyRef(b), args: { timeframe: 'W' } }),
  ema: (b) => ({ action: 'indicator.add', target: b.context.indicatorEdits.find(x => x.symbol === 'SPY').ref, args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }),
}
const CONTEXTS = [
  ['one chart', ['SPY'], null, ''],
  ['one chart + an exclusion', ['SPY'], null, ', but not NVDA'],
  ['SPY clicked', ['SPY', 'NVDA'], 'w0', ''],
  ['SPY clicked + an exclusion', ['SPY', 'NVDA'], 'w0', ". Don't touch NVDA"],
  ['three charts', ['SPY', 'NVDA', 'QQQ'], null, ''],
]
const TICKERS = ['AMD', 'TSLA', 'AAPL']
const TARGET = [
  [(T) => `Take ${T} to weekly`, 'timeframe'], [(T) => `Move ${T} to weekly`, 'timeframe'], [(T) => `Bring ${T} to weekly`, 'timeframe'],
  [(T) => `Put ${T} on weekly`, 'timeframe'], [(T) => `Set ${T} to weekly`, 'timeframe'], [(T) => `Get ${T} on the weekly`, 'timeframe'],
  [(T) => `${T} on weekly please`, 'timeframe'], [(T) => `${T} weekly`, 'timeframe'], [(T) => `${T} to 1h`, 'timeframe'], [(T) => `${T} with a 20 EMA`, 'ema'],
]
const VALUE = [(T) => `switch to ${T}`, (T) => `make this one ${T}`, (T) => `load ${T} here instead`, (T) => `flip it to ${T}`]
const ON_BOARD = [['SPY on weekly please', 'timeframe'], ['SPY weekly', 'timeframe'], ['SPY to 1h', 'timeframe'], ['Take SPY to weekly', 'timeframe'], ['SPY with a 20 EMA', 'ema']]

const ids = (syms) => syms.map((_, i) => `w${i}`)

describe('TARGET-SHAPED, any verb position: an off-board ticker as the subject → asked, 0 writes', () => {
  const CASES = TICKERS.flatMap(T => TARGET.flatMap(([say, op]) => CONTEXTS.map(([ctx, syms, sel, tail]) => [`${say(T)}${tail}.`, ctx, syms, sel, op])))
  it('generated: 3 tickers × 10 shapes × 5 contexts', () => expect(CASES).toHaveLength(150))
  it.each(CASES)('"%s" (%s)', async (t, ctx, syms, sel, op) => {
    const m = mount(syms, sel)
    const before = snapshot(m.board, ids(syms))
    p.st.envelopes.push((body) => p.env('apply', [OPS[op](body)]))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, ids(syms)), transcript()).toEqual(before)
  }, 60000)
})

describe('VALUE-SHAPED: the ticker is the value of a symbol change → it runs', () => {
  const CASES = TICKERS.flatMap(T => VALUE.flatMap(say => CONTEXTS.map(([ctx, syms, sel, tail]) => [`${say(T)}${tail}${tail ? "." : ""}`, ctx, syms, syms.length > 2 ? 'w0' : sel, T])))
  it('generated: 3 tickers × 4 shapes × 5 contexts', () => expect(CASES).toHaveLength(60))
  it.each(CASES)('"%s" (%s) → the SPY chart shows the new ticker', async (t, ctx, syms, sel, T) => {
    const m = mount(syms, sel)
    const others = ids(syms).filter(id => id !== 'w0')
    const before = snapshot(m.board, others)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: spyRef(body), args: { symbol: T } }]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(symOf(m.board, 'w0'), transcript()).toBe(T)
    expect(snapshot(m.board, others)).toEqual(before)
  }, 60000)
})

// FIXED (fix-symbol-trailing-punct): a bare "switch to AMD." / "flip it to AMD." with a trailing period used to be read by the
// instant symbol path as the symbol "AMD." and refused. Trailing punctuation is now stripped: the symbol change runs.
describe('a trailing period on a bare value shape: the symbol change runs', () => {
  it.each(TICKERS.flatMap(T => [`switch to ${T}.`, `flip it to ${T}.`]))('"%s" (one chart): the SPY chart shows the new ticker', async (t) => {
    const m = mount(['SPY'], null)
    await m.say(t)
    expect(transcript()).not.toMatch(/Did you mean|has no symbol/)
    expect(symOf(m.board, 'w0'), transcript()).toBe(t.replace(/^.* (\S+)\.$/, '$1'))
  }, 60000)
})

describe('ON-BOARD SUBJECT: the ticker IS the target chart → the change runs', () => {
  const CASES = ON_BOARD.flatMap(([t, op]) => CONTEXTS.map(([ctx, syms, sel, tail]) => [`${t}${tail}.`, ctx, syms, sel, op]))
  it('generated: 5 shapes × 5 contexts', () => expect(CASES).toHaveLength(25))
  it.each(CASES)('"%s" (%s) → applied on SPY only', async (t, ctx, syms, sel, op) => {
    const m = mount(syms, sel)
    const others = ids(syms).filter(id => id !== 'w0')
    const before = snapshot(m.board, others), spy0 = stored(m.board, 'w0')
    p.st.envelopes.push((body) => p.env('apply', [OPS[op](body)]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(stored(m.board, 'w0'), transcript()).not.toBe(spy0)
    expect(snapshot(m.board, others)).toEqual(before)
  }, 60000)
})
