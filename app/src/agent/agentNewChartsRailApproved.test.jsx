// ⛔ NEW-CHARTS RAIL (2026-11-14) · the APPROVED path. The rail is FORCED off while the card is made (a producer regression: a
// card that writes an old chart under "the new charts" words); the approval alone must then refuse it, reading the words the
// card was proposed from ("do it" / "yes" / Apply name no chart). Nothing runs. LOCAL / SIMULATED (BROWSER-MOCK-MODEL).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const forced = { off: false }
vi.mock('./newChartsRail', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, newChartsRefusal: (...a) => (forced.off ? null : real.newChartsRefusal(...a)) }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, FOUR } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel(); forced.off = false })
afterEach(() => { forced.off = false; vi.restoreAllMocks(); cleanup() })

const chartOf = (b, sym) => b.context.charts.find(c => c.label === `Chart (${sym})`)?.ref
const tfOf = (m) => Object.fromEntries(m.board.state.widgets.filter(w => w.type === 'chart').map(w => [m.h.charts.read(w.id).symbol, m.h.charts.read(w.id).tf]))

describe('an approved card that writes an old chart under "the new charts" words never runs', () => {
  it.each([['the Apply button', null], ['typed "do it"', 'do it'], ['typed "yes"', 'yes']])('approved by %s', async (_how, said) => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    await m.say('open charts for AAPL and MSFT')
    await m.say('make the QQQ chart a line chart')
    forced.off = true
    p.st.envelopes.push(b => p.env('propose', ['AAPL', 'MSFT', 'SPY'].map(s => ({ action: 'chart.setTimeframe', target: chartOf(b, s), args: { timeframe: 'W' } }))))
    await m.say('make the new charts weekly')
    forced.off = false
    expect(p.proposals().map(c => c.textContent).join(' '), 'the forced card must carry SPY').toContain('Chart (SPY)')
    if (said) await m.say(said)
    else await m.click('Apply')
    expect(tfOf(m), p.transcript()).toEqual({ SPY: 'D', QQQ: 'D', AAPL: 'D', MSFT: 'D' })
    expect(p.transcript()).toMatch(/I didn’t change anything: you asked about the new charts/)
  }, 40000)
  it('control: the same card WITHOUT the old chart runs as approved', async () => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    await m.say('open charts for AAPL and MSFT')
    await m.say('make the QQQ chart a line chart')
    p.st.envelopes.push(b => p.env('propose', ['AAPL', 'MSFT'].map(s => ({ action: 'chart.setTimeframe', target: chartOf(b, s), args: { timeframe: 'W' } }))))
    await m.say('make the new charts weekly')
    await m.say('do it')
    expect(tfOf(m), p.transcript()).toEqual({ SPY: 'D', QQQ: 'D', AAPL: 'W', MSFT: 'W' })
  }, 40000)
})
