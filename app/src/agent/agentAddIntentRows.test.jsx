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
