// D22 (owner live finding, 2026-11-14): with two SPY charts, "add AAPL and MSFT" got a MODEL clarify ("new charts or replace?").
// LAYER A ONLY (deterministic, no model): which of the D22 rows the client answers itself, and which reach the planner. What the
// MODEL decides on a row that reaches it is NOT measurable here (layer C needs the real model — agentEvalBaseline.test.js).
// The table this prints is the BEFORE evidence; it asserts nothing about model behaviour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings, MODEL_SENTINEL } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chart = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
const BOARDS = {
  '1 chart (SPY)': () => [[chart('c0', 0, 0, 24, 20)], { 'N:c0': 'SPY' }],
  '2 charts (SPY, SPY)': () => [[chart('c0', 0, 0, 12, 20), chart('c1', 12, 0, 12, 20)], { 'N:c0': 'SPY', 'N:c1': 'SPY' }],
  'full 3x3 (9 charts)': () => [Array.from({ length: 9 }, (_, i) => chart(`c${i}`, (i % 3) * 8, Math.floor(i / 3) * 10, 8, 10)), Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`N:c${i}`, ['SPY', 'QQQ', 'IWM', 'DIA', 'NVDA', 'AMD', 'TSLA', 'META', 'GOOGL'][i]]))],
}
const ROWS = ['add AAPL and MSFT', 'add AAPL', 'put AAPL up too', 'open AAPL and MSFT']
const CASES = Object.keys(BOARDS).flatMap(b => ROWS.map(r => [b, r]))
const table = []

describe('D22 rows · layer A (who answers: the client, or the planner)', () => {
  it.each(CASES)('%s · "%s"', async (b, said) => {
    const m = p.mount(...BOARDS[b]())
    const before = m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id).symbol)
    const out = await m.say(said)
    const after = m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id).symbol)
    const kept = before.every((s, i) => after[i] === s)
    const outcome = out.includes(MODEL_SENTINEL) ? 'MODEL' : p.proposals().length ? 'card' : /\?/.test(out) && after.length === before.length ? 'client-ask' : after.length > before.length ? 'acted-new' : 'other'
    table.push({ board: b, said, outcome, charts: `${before.length}→${after.length}`, existingKept: kept, text: out.replace(/\s+/g, ' ').slice(0, 140) })
    expect(kept, `an add never changes an existing chart: ${out}`).toBe(true)
  }, 40000)
  it('prints the table', () => { console.log('D22-TABLE>>', JSON.stringify(table)) })
})

// ── the RAILS still guard every row: whatever the planner does with the new hint, a plan that REPLACES an existing chart for
// an additive request is refused (chartRail ADDITIVE / REMOVAL; stateRail beside it) — nothing written, no card ──
const tickersOf = (said) => (said.match(/\b[A-Z]{2,5}\b/g) || [])
const PLANS = {
  're-symbol existing charts': (said) => (b) => p.env('apply', tickersOf(said).map((t, i) => ({ action: 'chart.setSymbol', target: b.context.charts[i % b.context.charts.length].ref, args: { symbol: t } }))),
  'a replacing grid': (said) => () => p.env('apply', [{ action: 'chartGrid.set', target: 'board', args: { symbols: tickersOf(said), timeframe: null, layout: null, new_charts: null, watchlist: null, replace: true } }]),
}
const RAIL_CASES = CASES.flatMap(([b, r]) => Object.keys(PLANS).map(k => [b, r, k]))
// ⚠ KNOWN GAP (reported to AUDIT, not changed here — a rail change is its own decision): "open" is not an ADDITIVE word for the
// chart rail, so on the one-chart board a reusing grid for "open AAPL and MSFT" goes to a card. That row is recorded as failing
// (it.fails) so the gap stays visible until the rail decision is made. (The re-symbol row of the same gap is CLOSED on master
// since the #1275 / H14 rails: it is refused like every other row and asserted with them.)
const OPEN_GAP = new Set(['1 chart (SPY)|open AAPL and MSFT|a replacing grid'])
describe('D22 rows · a replacing plan for an additive request is still refused by the rails', () => {
  const run = async (b, said, k) => {
    const m = p.mount(...BOARDS[b]())
    const before = JSON.stringify(m.board.state.widgets.filter(w => w.type === 'chart').map(w => [w.id, m.h.charts.read(w.id).symbol]))
    p.st.envelopes.push(PLANS[k](said))
    const out = await m.say(said)
    expect(p.turns(), 'the model planned it').toBe(1)
    expect(JSON.stringify(m.board.state.widgets.filter(w => w.type === 'chart').map(w => [w.id, m.h.charts.read(w.id).symbol])), out).toBe(before)
    expect(p.proposals(), out).toHaveLength(0)
    // refused by a rail, or asked which chart (the deictic screen: a plan on ONE unnamed chart of several) — never written
    expect(out).toMatch(/I didn.t change anything|I can.t change a chart|Which chart do you mean?/)
  }
  it.each(RAIL_CASES.filter(c => !OPEN_GAP.has(c.join('|'))))('%s · "%s" · %s → refused or asked, every existing chart kept, no card', run, 40000)
  it.fails.each(RAIL_CASES.filter(c => OPEN_GAP.has(c.join('|'))))('KNOWN GAP · %s · "%s" · %s', run, 40000)
})

// ── condition 2b (AUDIT): a DUPLICATING plan for a symbol already shown. #1275 (D18 reuse, 6ea2d1830a) is on master: a shown
// symbol REUSES its chart — never a second copy, never an existing chart changed, never a card. A symbol not shown gets ONE new
// chart where there is room; on the full board nothing is written and the reply says why (room).
const DUP_ROWS = ['add SPY and MSFT', 'add SPY', 'put SPY up too', 'open SPY and MSFT']
const ws = (b) => (Object.values(b.context || {}).flat().find(e => /workspace/i.test(String(e?.label || e?.ref)))?.ref) || 'workspace'
const FULL = 'full 3x3 (9 charts)'
describe('D22 rows · a duplicating plan for a shown symbol reuses its chart (#1275)', () => {
  it.each(Object.keys(BOARDS).flatMap(b => DUP_ROWS.map(r => [b, r])))('%s · "%s" · the shown SPY reuses its chart (no second SPY chart)', async (b, said) => {
    const m = p.mount(...BOARDS[b]())
    const sym = () => m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id).symbol)
    const before = sym()
    p.st.envelopes.push(bb => p.env('apply', [{ action: 'widget.addCharts', target: ws(bb), args: { symbols: tickersOf(said), timeframe: null, chart_type: null, exact: null } }]))
    const out = await m.say(said)
    const after = sym()
    expect(before.every((s, i) => after[i] === s), out).toBe(true)                      // never an existing chart changed
    expect(after.filter(s => s === 'SPY').length, out).toBe(before.filter(s => s === 'SPY').length)   // no second SPY chart
    expect(p.proposals(), out).toHaveLength(0)
    const adds = tickersOf(said).filter(t => !before.includes(t))
    if (!adds.length) {
      expect(after, out).toEqual(before)
      expect(out).toMatch(/SPY is already on your board/)
    } else if (b === FULL) {
      expect(after, out).toEqual(before)
      expect(out).toMatch(/I didn.t change anything/)
    } else {
      expect(after.slice(before.length), out).toEqual(adds)                             // one new chart per symbol not shown
    }
  }, 40000)
})
