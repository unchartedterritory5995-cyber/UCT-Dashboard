// SAFETY, end to end (the real panel, planner, gate and board writer): "replace every chart except the top-right one with AMD" on a
// board whose top row is ONE color link group never switches the top-right chart — not by its own op, and not through the
// linked top-left chart (the board writer moves the whole link group, as the product's symbol search does). The model's plan is
// scripted to be the CORRECT reading of the words (every chart but the top-right one), so what is tested is the gate, not the
// model. LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, a scripted plan, the fixture board's real link groups.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// 2×2: TL + TR linked (group A, SPY); BL, BR unlinked
const W = (id, x, y, color) => ({ id, type: 'chart', x, y, w: 12, h: 10, color, opts: { settings: bareSettings() } })
const mount = () => p.mount([W('TL', 0, 0, 'A'), W('TR', 12, 0, 'A'), W('BL', 0, 10, 'N'), W('BR', 12, 10, 'N')],
  { A: 'SPY', 'N:BL': 'NVDA', 'N:BR': 'TSLA' }, { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
const symbolOf = (m, id) => m.board.host.charts.read(id).symbol
const plan = (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setSymbol', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { symbol: 'AMD' } })))

const WORDS = [
  'replace every chart except the top-right one with AMD',
  'replace all of them except the top-right chart with AMD',
  'replace every chart other than the top-right one with AMD',
]

describe('a linked chart never carries a symbol change onto the chart the words exclude', () => {
  it.each(WORDS.flatMap(t => [['apply', t], ['propose', t]]))('model plan %s — "%s": the top-right chart stays on SPY (also after Apply)', async (disp, t) => {
    const m = mount()
    p.st.envelopes.push(plan(disp, ['TL', 'BL', 'BR']))
    await m.say(t)
    if (p.proposals().length) await m.click('Apply')
    expect(symbolOf(m, 'TR'), `the excluded top-right chart was switched: ${p.transcript()}`).toBe('SPY')
    expect(symbolOf(m, 'TL'), 'TL cannot switch without switching its linked TR').toBe('SPY')
    // the charts that share nothing with the excluded one are still switched (fail closed only where the exclusion reaches)
    expect([symbolOf(m, 'BL'), symbolOf(m, 'BR')]).toEqual(['AMD', 'AMD'])
  }, 40000)
  it('control: with the top row UNLINKED the same plan switches TL, BL and BR, and TR stays', async () => {
    const m = p.mount([W('TL', 0, 0, 'N'), W('TR', 12, 0, 'N'), W('BL', 0, 10, 'N'), W('BR', 12, 10, 'N')],
      { 'N:TL': 'SPY', 'N:TR': 'SPY', 'N:BL': 'NVDA', 'N:BR': 'TSLA' }, { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
    p.st.envelopes.push(plan('apply', ['TL', 'BL', 'BR']))
    await m.say(WORDS[0])
    if (p.proposals().length) await m.click('Apply')
    expect(['TL', 'TR', 'BL', 'BR'].map(id => symbolOf(m, id)), p.transcript()).toEqual(['AMD', 'SPY', 'AMD', 'AMD'])
  }, 40000)
})
