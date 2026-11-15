// ⛔ H14 · AUDIT held-out probe 50 (2026-11-15): the six cases that failed, through the REAL panel (and the rail's own reading).
//   50d2  a STALE pick on the generic "which chart?" path — and an EMPTY chart filled before the pick — never applies
//   50f1  a chart TAB on another link colour (and a hidden wtab chart) makes the board NOT sole on the real path
//   50b1  a set-aside clause governs only the ticker it negates — never a requested one
//   50c1  a single chart taking two newly named tickers in one plan (the SELECTED chart of several) → refused
//   50e1  a linked pair (one link colour) is ONE object: switched together, never asked with two identical choices
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { chartRailRefusal, tickerSetAside } from './chartRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chart = (id, x, w, color = 'N', opts = {}) => ({ id, type: 'chart', x, y: 0, w, h: 20, color, opts: { settings: bareSettings(), ...opts } })
const symsOf = (m) => m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id)?.symbol || '')
const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
const questionText = () => screen.queryAllByTestId('agent-question').map(q => q.textContent).join(' ')

describe('50d2 · a pick bound to the chart AND what it showed when asked (every chart pick path)', () => {
  it('two charts, a ticker-only request → asked → the picked chart changes ticker before the click → nothing applied, said', async () => {
    const m = p.mount([chart('c0', 0, 12), chart('c1', 12, 12)], { 'N:c0': 'SPY', 'N:c1': 'QQQ' }, { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[1].ref, args: { symbol: 'AMD' } }]))
    await m.say('AMD')
    expect(screen.queryAllByRole('button', { name: 'Chart (SPY)' }).length, `the ask must have happened: ${p.transcript()}`).toBeGreaterThan(0)
    m.board.state.groupSyms['N:c0'] = 'IWM'                           // the board changes between the ask and the pick
    await m.click('Chart (SPY)')
    expect(symsOf(m), p.transcript()).toEqual(['IWM', 'QQQ'])
    expect(p.transcript()).toMatch(/Your board changed since I asked/)
  }, 40000)
  it('an EMPTY chart among the choices, filled before the pick → stale (never applied over what now shows)', async () => {
    // (the fixture shows SPY for a chart with no ticker; ZZZZ stands for the EMPTY chart, read as empty by the decorated host)
    const empty = (x) => (x && x.symbol === 'ZZZZ' ? { ...x, symbol: '', label: 'Chart (empty)' } : decorate(x))
    const m = p.mount([chart('c0', 0, 12), chart('c1', 12, 12)], { 'N:c0': 'ZZZZ', 'N:c1': 'QQQ' }, { decorate: empty })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[1].ref, args: { symbol: 'AMD' } }]))
    await m.say('AMD')
    const pick = screen.queryAllByRole('button', { name: 'Chart (empty)' })
    expect(pick.length, `the ask must offer the empty chart: ${p.transcript()}`).toBeGreaterThan(0)
    m.board.state.groupSyms['N:c0'] = 'NVDA'
    await m.click('Chart (empty)')
    expect(symsOf(m), p.transcript()).toEqual(['NVDA', 'QQQ'])
    expect(p.transcript()).toMatch(/Your board changed since I asked/)
  }, 40000)
})

describe('50f1 · not sole on the REAL path: a chart tab on another colour, or a hidden wtab chart', () => {
  it.each([
    ['a chart tab on link colour B showing another ticker', [chart('c0', 0, 24, 'A', { chartTabs: [{ id: 't1', color: 'B', symbol: 'QQQ' }] })], { A: 'SPY', B: 'QQQ' }],
    ['a hidden widget-tab chart', [chart('c0', 0, 12), { id: 'n1', type: 'news', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: {}, wtabs: [{ id: 'wt1', type: 'chart' }] }], { 'N:c0': 'SPY' }],
  ])('%s → "show AMD" is asked / refused, the main chart never re-symbolled', async (_n, widgets, syms) => {
    const m = p.mount(widgets, syms, { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'AMD' } }]))
    const out = await m.say('show AMD')
    expect(m.h.charts.read('c0').symbol, out).toBe('SPY')
  }, 40000)
})

describe('50b1 · a negation governs ONLY the ticker it negates', () => {
  it.each([
    ['leave NVDA alone and open AAPL and MSFT', 'NVDA', true], ['leave NVDA alone and open AAPL and MSFT', 'AAPL', false], ['leave NVDA alone and open AAPL and MSFT', 'MSFT', false],
    ["don't touch NVDA, open AAPL and MSFT", 'AAPL', false], ["don't touch NVDA, open AAPL and MSFT", 'NVDA', true],
    ['not NVDA — open AAPL and MSFT', 'AAPL', false], ['open AAPL and MSFT but not NVDA', 'NVDA', true], ['open AAPL and MSFT but not NVDA', 'MSFT', false],
    ['open AAPL and MSFT, except NVDA', 'NVDA', true], ['keep NVDA and open AAPL and MSFT', 'AAPL', false], ['keep NVDA and open AAPL and MSFT', 'NVDA', true],
  ])('"%s": %s set aside → %s', (w, t, want) => { expect(tickerSetAside(w, t)).toBe(want) })
  it.each(['leave NVDA alone and open AAPL and MSFT', "don't touch NVDA, open AAPL and MSFT"])('ONE chart · "%s" · re-symbolled twice → refused, SPY kept', async (said) => {
    const m = p.mount([chart('c0', 0, 24)], { 'N:c0': 'SPY' }, { decorate })
    p.st.envelopes.push(b => p.env('apply', ['AAPL', 'MSFT'].map(t => ({ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: t } }))))
    const out = await m.say(said)
    expect(symsOf(m), out).toEqual(['SPY'])
  }, 40000)
})

describe('50c1 · a single chart taking two newly named tickers in one plan is refused, wherever it is', () => {
  it('the SELECTED chart of two, "open AAPL and MSFT", re-symbolled twice → refused, both charts kept', async () => {
    const m = p.mount([chart('c0', 0, 12), chart('c1', 12, 12)], { 'N:c0': 'SPY', 'N:c1': 'QQQ' }, { decorate })
    p.select('c0')
    p.st.envelopes.push(b => p.env('apply', ['AAPL', 'MSFT'].map(t => ({ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: t } }))))
    const out = await m.say('open AAPL and MSFT')
    expect(symsOf(m), out).toEqual(['SPY', 'QQQ'])
  }, 40000)
})

describe('50e1 · a linked pair (one link colour) is ONE object', () => {
  it('"show AMD": both switch, never asked; Undo restores both', async () => {
    const m = p.mount([chart('c0', 0, 12, 'A'), chart('c1', 12, 12, 'A')], { A: 'SPY' }, { decorate: (s) => (s ? { ...s, label: `Chart (${s.symbol})`, linkedCount: 1 } : s) })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'AMD' } }]))
    const out = await m.say('show AMD')
    if (process.env.DUMP) console.log('REC>>', JSON.stringify(p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2]?.outcomeData?.kind)), questionText())
    expect(questionText(), out).not.toMatch(/Which chart/)
    expect(symsOf(m), out).toEqual(['AMD', 'AMD'])
    await m.say('undo')
    expect(symsOf(m), p.transcript()).toEqual(['SPY', 'SPY'])
  }, 40000)
})
void chartRailRefusal

// ── a SHOWN ticker the words ask to see counts as on the board only while it STAYS there (#1275 reuse) ──
describe('final board · "open SPY and AAPL" on the sole SPY chart', () => {
  it('re-symbolling SPY to AAPL drops SPY → refused, SPY kept', async () => {
    const m = p.mount([chart('c0', 0, 24)], { 'N:c0': 'SPY' }, { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'AAPL' } }]))
    const out = await m.say('open SPY and AAPL')
    expect(symsOf(m), out).toEqual(['SPY'])
  }, 40000)
})
