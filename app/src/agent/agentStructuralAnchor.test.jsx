// STRUCTURAL anchor rule (AUDIT on #988, pl-auto unseen10, SIMULATED): when a CHART reference ("the one / chart / cell / panel …
// <relation> this", "<relation> this one") carries ANY spatial or relational word (far end, corner, opposite, diagonal, next door,
// neighbours, beyond, past, a count …) and the anchor is the click ("this / this one / here / it / the selected chart / the one I
// clicked"), the click is NEVER applied and NEVER offered. Resolved where the grid says so — the far end of the line, the opposite
// corner, a two-axis diagonal step, "next door", a counted step with a unit — otherwise asked without the anchor. Built from the
// family: anchors × relations × grids. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const w = (id, x, y, ww = 8, hh = 10) => ({ id, x, y, w: ww, h: hh })
const GRIDS = {
  THREE: [w('t0', 0, 0), w('t1', 8, 0), w('t2', 16, 0)],
  FOUR: [w('c0', 0, 0, 12), w('c1', 12, 0, 12), w('c2', 0, 10, 12), w('c3', 12, 10, 12)],
  NINE: [0, 1, 2].flatMap(r => [0, 1, 2].map(c => w(`g${r}${c}`, c * 8, r * 10))),
}
const ANCHORS = ['this one', 'this chart', 'here', 'it', 'the selected chart', 'the one I clicked']
// [grid, clicked, relation phrase with {A} for the anchor, meant | null (asked)]
const RELATIONS = [
  ['THREE', 't0', 'the chart at the far end from {A}', 't2'],
  ['THREE', 't2', 'the one at the far end from {A}', 't0'],
  ['FOUR', 'c3', 'the corner opposite {A}', 'c0'],
  ['FOUR', 'c1', 'the one in the far corner from {A}', 'c2'],
  ['NINE', 'g22', 'the corner diagonal from {A}', 'g00'],
  ['NINE', 'g11', 'the chart diagonally up and to the left of {A}', 'g00'],
  ['NINE', 'g11', 'the one diagonally down and to the right of {A}', 'g22'],
  ['NINE', 'g01', 'the chart two charts below {A}', 'g21'],
  ['THREE', 't0', 'the one next door to {A}', 't1'],
  ['THREE', 't1', 'the diagonal chart from {A}', null],                 // a 1×3 row has no diagonal
  ['THREE', 't1', 'both neighbours of {A}', null],
  ['THREE', 't0', 'the chart beyond {A}', null],
  ['NINE', 'g11', 'the panel past {A}', null],
]
// each relation once per anchor (rotating so every anchor meets every grid)
const ROWS = RELATIONS.map((r, i) => {
  const a = ANCHORS[i % ANCHORS.length]
  return [r[0], r[1], r[2].replace('{A}', a), r[3]]
})
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart do you mean|Did you mean/.test(transcript())
const mountGrid = (g, sel) => {
  const widgets = GRIDS[g].map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'AAPL', 'MSFT', 'DIA'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  p.select(sel)
  return m
}
const tfs = (b) => b.state.widgets.map(x => x.opts?.tf || 'D').join('')
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])
function anchorNeverOffered(sel) {
  expect(transcript(), 'the anchor named in a headline').not.toContain(`Did you mean Chart (${sel})?`)
  const offered = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
  expect(offered, 'the anchor offered as a choice').not.toContain(`Chart (${sel})`)
}

describe('the anchor of any spatial relation on a chart reference is never the target', () => {
  it.each(ROWS.filter(r => r[3]))('%s, clicked %s: "make %s weekly" — the plan on %s runs there; nothing asked', async (g, sel, np, meant) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe(GRIDS[g].map(c => (c.id === meant ? 'W' : 'D')).join(''))
    expect(asked()).toBe(false)
  }, 40000)
  it.each(ROWS)('%s, clicked %s: "make %s weekly" — a plan on the CLICK never runs; the anchor is never offered', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    anchorNeverOffered(sel)
  }, 40000)
  it.each(ROWS.filter(r => !r[3]))('%s, clicked %s: "make %s weekly" — no single chart: asked without the anchor', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(GRIDS[g].find(c => c.id !== sel).id))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    anchorNeverOffered(sel)
  }, 40000)
})
