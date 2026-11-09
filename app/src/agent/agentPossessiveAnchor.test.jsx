// POSSESSIVE anchors (AUDIT held-out on 9828b67c6e, the one residual: c5 clicked, "switch the neighbour on its left to weekly" applied a
// plan on the CLICK with a success receipt, and asked about the right plan with every chart offered, the anchor included).
//   R1 (possessive form): "its / it's / this one's / this chart's / the selected one's" before a RELATIONAL noun or phrase (left /
//   right / side / neighbour(s) / end / row / corner / diagonal …) makes the click a REFERENCE POINT: never applied, never offered,
//   resolved from the grid where it can be ("the neighbour on its left" = the cell to its left), otherwise asked without it.
// Negatives: "its" on a THING ("move the alert to its level", "hide the RSI and its signal line") is no relation: the click is acted on.
// Built from the family: possessives × relational phrases × two grids. Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED (scripted plans through the real panel).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const w = (id, x, y) => ({ id, x, y, w: 8, h: 10 })
// 2×3: top TL TM TR, bottom BL BM BR
const G = [w('TL', 0, 0), w('TM', 8, 0), w('TR', 16, 0), w('BL', 0, 10), w('BM', 8, 10), w('BR', 16, 10)]
// one row of five, AUDIT's shape: c1 … c5
const ROW = [w('c1', 0, 0), w('c2', 8, 0), w('c3', 16, 0), w('c4', 24, 0), w('c5', 32, 0)]
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts/.test(transcript())
const mount = (grid, sel) => {
  const widgets = grid.map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id)
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
function anchorSafe(sel) {
  expect(transcript(), 'the anchor named in a headline').not.toContain(`Did you mean Chart (${sel})?`)
  const offered = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
  expect(offered, 'the anchor offered').not.toContain(`Chart (${sel})`)
}

const POSS = ['its', "it's", "this one's", "this chart's", "the selected one's"]
// [phrase with {P}, grid, clicked, the chart(s) meant]
const PHRASES = [
  ['switch the neighbour on {P} left to weekly', ROW, 'c5', ['c4']],                // AUDIT's sentence
  ['make the one on {P} right side weekly', G, 'TL', ['TM']],
  ['put the chart to {P} left on weekly', ROW, 'c3', ['c2']],
  ['make {P} left-hand neighbour weekly', G, 'BR', ['BM']],
  ['set {P} right neighbour to weekly', ROW, 'c1', ['c2']],
  ["make {P} row's far end weekly", G, 'TL', ['TR']],
  ['make the chart at the far end of {P} row weekly', ROW, 'c5', ['c1']],
  ['make {P} diagonal weekly', G, 'TL', ['BR']],
  ['make {P} opposite corner weekly', G, 'BL', ['TR']],
  ['make both of {P} neighbours weekly', G, 'TM', ['TL', 'TR']],
]
const ROWS = PHRASES.flatMap(([t, grid, sel, meant], i) => POSS.map((P, j) => [t.replace('{P}', P), grid === ROW ? 'row' : '2x3', sel, meant, i * POSS.length + j]))
  .map(([t, g, sel, meant]) => [t, g, sel, meant])
const gridOf = (g) => (g === 'row' ? ROW : G)

describe('possessive anchor: a plan on the CLICK is never applied, and the anchor is never offered', () => {
  it.each(ROWS)('"%s" (%s, clicked %s)', async (t, g, sel) => {
    const m = mount(gridOf(g), sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    anchorSafe(sel)
  }, 40000)
})

describe('possessive anchor: the plan on the chart meant RUNS there (resolved from the grid), never on the click', () => {
  it.each(ROWS)('"%s" (%s, clicked %s, meant %j)', async (t, g, sel, meant) => {
    const m = mount(gridOf(g), sel)
    p.st.envelopes.push(planOn(...meant))
    await m.say(t)
    expect(changed(m.board).sort(), transcript()).toEqual([...meant].sort())
    anchorSafe(sel)
  }, 40000)
})

describe('possessive anchor: a plan on a WRONG non-anchor chart is asked about without the anchor, never applied', () => {
  // the chart a confused planner names: neither the click nor the chart meant
  const WRONG = [
    ['switch the neighbour on its left to weekly', ROW, 'c5', 'c2'],
    ["make this chart's right neighbour weekly", G, 'TL', 'BR'],
    ["make the selected one's diagonal weekly", G, 'TL', 'TM'],
  ]
  it.each(WRONG.map(([t, grid, sel, wrong]) => [t, grid === ROW ? 'row' : '2x3', sel, wrong]))('"%s" (%s, clicked %s, plan on %s)', async (t, g, sel, wrong) => {
    const m = mount(gridOf(g), sel)
    p.st.envelopes.push(planOn(wrong))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([])
    expect(asked(), transcript()).toBe(true)
    anchorSafe(sel)
  }, 40000)
})

describe('negatives: "its" on a THING is no relation — the click is acted on', () => {
  const ACT = [
    'make this one weekly and move the alert to its level',
    'hide the RSI and its signal line on this chart, and make it weekly',
    'switch this one to weekly and hide its volume',
    'make it weekly and keep its price scale on the right',
    'make it weekly; its 50-day is above the 200',
  ]
  it.each(ACT)('"%s" (TM clicked): the plan on the click runs there', async (t) => {
    const m = mount(G, 'TM')
    p.st.envelopes.push(planOn('TM'))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(['TM'])
  }, 40000)
})
