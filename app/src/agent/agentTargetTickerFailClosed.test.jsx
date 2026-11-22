// AUDIT (11-13) — FAIL CLOSED: the target-ticker check that cannot finish never lets a write through.
//   PANEL  the check's lowercase-ticker lookup forced to THROW (nl/tickers groundingOf, module mock) → the turn is asked, 0 writes
//          (useAgent's own catch around the whole check; deixis itself cannot be module-mocked: it is in an import cycle)
//   UNIT   targetTickerConflict on a host whose chart list throws → an ask; offBoardTicker / tickerAntecedent on input that
//          throws → "withhold" ('?') / no antecedent (null) — both lead to a question, never to a stand-in chart
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

const boom = { on: false }
vi.mock('./nl/tickers', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, groundingOf: (w) => { if (boom.on) throw new Error('forced'); return real.groundingOf(w) } }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const real = await vi.importActual('./deixis')
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
const { getCapability, getTargetKind } = await import('./capabilities')
registerBuiltins()

let p
beforeEach(() => { boom.on = false; p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const stored = (b) => JSON.stringify(b.state.widgets)
const weekly = (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === 'Chart (SPY)').ref, args: { timeframe: 'W' } }])

describe('PANEL: a target-ticker check that throws → asked, 0 writes', () => {
  it.each([['take amd to weekly', ['SPY'], null], ['amd on weekly please', ['SPY', 'NVDA'], 'w0'], ['change Amd to weekly, leave nvda alone', ['SPY', 'NVDA'], null]])('"%s" on %j (check forced to throw)', async (t, syms, sel) => {
    const m = mount(syms, sel)
    const before = stored(m.board)
    boom.on = true
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(transcript()).toContain(real.TARGET_CHECK_FAILED)
    expect(stored(m.board)).toBe(before)
  }, 60000)
  it('control: "spy on weekly" (no word to look up) with the check forced to throw still runs', async () => {
    const m = mount(['SPY'], null)
    boom.on = true
    p.st.envelopes.push(weekly)
    await m.say('spy on weekly')
    expect(m.board.state.widgets[0].opts.tf, transcript()).toBe('W')
  }, 60000)
})

describe('UNIT: every reader of this family fails closed', () => {
  it('targetTickerConflict: a host whose chart list throws → an ask', () => {
    const host = { charts: { list: () => { throw new Error('list') } } }
    const r = real.targetTickerConflict({ host, ops: [{ action: 'chart.setTimeframe', target: 'w0', args: { timeframe: 'W' } }], text: 'SPY on weekly', getTargetKind, getCapability })
    expect(r?.ask?.text).toBe(real.TARGET_CHECK_FAILED)
  })
  it('targetTickerConflict: a capability lookup that throws → an ask', () => {
    const m = mount(['SPY'], null)
    const r = real.targetTickerConflict({ host: m.h, ops: [{ action: 'chart.setTimeframe', target: 'w0', args: { timeframe: 'W' } }], text: 'Take AMD to weekly', getTargetKind, getCapability: () => { throw new Error('cap') } })
    expect(r?.ask).toBeTruthy()
  })
  it('offBoardTicker: input it cannot read → "?" (withholds the one left)', () => expect(real.offBoardTicker('Change AMD to 1h', null)).toBe('?'))
  it('tickerAntecedent: input it cannot read → null (no stand-in)', () => expect(real.tickerAntecedent('Change SPY to 1h, add a 20 EMA to it', null)).toBeNull())
})
