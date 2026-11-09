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

describe('possessive anchor on a relation UCT cannot place: the click is only the anchor, never applied, never offered', () => {
  const UNPLACED = [
    ['make its upper-side neighbour weekly', 'BM'],
    ["make the chart in this one's column weekly", 'TR'],
    ["make the selected chart's other neighbour weekly", 'TL'],
    ['put its corner on weekly', 'BR'],
  ]
  it.each(UNPLACED)('"%s" (2x3, clicked %s)', async (t, sel) => {
    const m = mount(G, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
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

// u4-clauses-10's shape as a FAMILY (Lead, after 79355cb0ac broke it): a TWO-TARGET clause, "this one and the one to its left /
// right / above / below", must keep BOTH charts — the click (named by "this one") and its neighbour. A rewrite of the possessive
// must never turn it into a single relation that points at the click twice. On 1×3, 2×2 and 2×3.
const ROW3 = [w('L', 0, 0), w('M', 8, 0), w('R', 16, 0)]
const w12 = (id, x, y) => ({ id, x, y, w: 12, h: 10 })
const QUAD = [w12('TL', 0, 0), w12('TR', 12, 0), w12('BL', 0, 10), w12('BR', 12, 10)]
const BOARDS = { '1x3': ROW3, '2x2': QUAD, '2x3': G }
const SIDE_SAYS = {
  left: ['make this one and the one to its left weekly', 'this one and the one on its left on the weekly'],
  right: ['make this one and the one to its right weekly', 'this one and the one on its right on the weekly'],
  above: ['make this one and the one right above it weekly'],
  below: ['make this one and the one just below it weekly'],
}
// [board, clicked, side, the neighbour on that side, a chart that is neither]
const PAIRS = [
  ['1x3', 'R', 'left', 'M', 'L'], ['1x3', 'L', 'right', 'M', 'R'], ['1x3', 'M', 'left', 'L', 'R'], ['1x3', 'M', 'right', 'R', 'L'],
  ['2x2', 'BR', 'left', 'BL', 'TL'], ['2x2', 'TL', 'right', 'TR', 'BR'], ['2x2', 'BR', 'above', 'TR', 'TL'], ['2x2', 'TL', 'below', 'BL', 'TR'],
  ['2x3', 'BM', 'left', 'BL', 'TL'], ['2x3', 'BM', 'right', 'BR', 'TR'], ['2x3', 'BM', 'above', 'TM', 'TR'], ['2x3', 'TM', 'below', 'BM', 'BL'],
]
const CLAUSE_ROWS = PAIRS.flatMap(([g, sel, side, nb, other]) => SIDE_SAYS[side].map(t => [t, g, sel, nb, other]))
describe('two-target clause: "this one and the one to its <side>" keeps both charts (u4-clauses-10 as a family)', () => {
  it.each(CLAUSE_ROWS)('"%s" (%s, clicked %s): the click and %s, both weekly', async (t, g, sel, nb) => {
    const m = mount(BOARDS[g], sel)
    p.st.envelopes.push(planOn(sel, nb))
    await m.say(t)
    expect(changed(m.board).sort(), transcript()).toEqual([sel, nb].sort())
  }, 40000)
  it.each(CLAUSE_ROWS)('NEGATIVE "%s" (%s, clicked %s, neighbour %s): a second op on %s never lands there', async (t, g, sel, nb, other) => {
    const m = mount(BOARDS[g], sel)
    p.st.envelopes.push(planOn(sel, other))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(other)
  }, 40000)
})
