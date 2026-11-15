// P2 safe asks, resolved (follow-up to #988, agent/pl/relrefs-steps): STEPS from the click along a row or a column, "the other side
// of the row / column", and "the corner on the same side / row / column". Each names one chart when the grid makes it unique; when
// it does not (no chart there, or two that fit) it is asked about with the real candidates, never the click. The click is the
// ANCHOR: a plan on it is never applied and it is never offered. Negatives: a MOVE of the click ("move this one up one row"), and a
// count of bars or panes, are no chart reference — the click is acted on. Built from families on 1×3, 2×2, 2×3 and 3×3 boards.
// Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans through the real panel).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (W, H) => (id, c, r) => ({ id, x: c * W, y: r * H, w: W, h: H })
const grid = (rows, W = 8, H = 10) => rows.flatMap((ids, r) => ids.map((id, c) => cell(W, H)(id, c, r)))
const BOARDS = {
  '1x3': grid([['L', 'M', 'R']]),
  '2x2': grid([['TL', 'TR'], ['BL', 'BR']], 12),
  '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]),
  '3x3': grid([['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]),
}
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts/.test(transcript())
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t))
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id)
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))

// [words, board, clicked, the chart meant | { ask: [the candidates] }]
const ROWS = [
  // row / column STEPS
  ['make the chart one row up from this one weekly', '2x3', 'BM', 'TM'],
  ['make the chart two rows down from here weekly', '3x3', 'TM', 'BM'],
  ['make the one up one row weekly', '3x3', 'MM', 'TM'],
  ['make the chart a row below this one weekly', '3x3', 'TR', 'MR'],
  ['make the chart one row down weekly', '3x3', 'BR', { ask: [] }],                     // nothing below the bottom row
  ['make the chart two rows up from this one weekly', '2x3', 'BL', { ask: [] }],        // only one row up
  ['make the chart one over to the right weekly', '1x3', 'L', 'M'],
  ['make the chart two over to the left of this one weekly', '1x3', 'R', 'L'],
  ['make the one two over weekly', '1x3', 'L', 'R'],                                   // only the right side is two deep
  ['make the one one over weekly', '1x3', 'M', { ask: ['L', 'R'] }],                    // either side
  ['make the chart two to the right of this one weekly', '2x3', 'TL', 'TR'],
  ['make the chart one column left of this one weekly', '3x3', 'MR', 'MM'],
  ['make the one two over weekly', '3x3', 'MM', { ask: [] }],                           // two over runs off both sides
  ['make the chart two columns over from here weekly', '2x3', 'BR', 'BL'],
  // the OTHER SIDE of the click's row / column
  ['make the chart on the other side of the row weekly', '1x3', 'L', 'R'],
  ['make the chart on the other side of the row weekly', '2x3', 'BR', 'BL'],
  ['make the chart on the other side of the row weekly', '1x3', 'M', { ask: ['L', 'R'] }],
  ['make the chart on the other side of the column weekly', '3x3', 'TM', 'BM'],
  ['make the one at the other side of the column weekly', '2x2', 'BL', 'TL'],
  // a CORNER on the same side / row / column
  ['make the other corner on the same side weekly', '1x3', 'L', 'R'],
  ['make the other corner on the same side weekly', '2x2', 'TL', { ask: ['TR', 'BL'] }],
  ['make the corner on the same side as this one weekly', '2x3', 'TM', { ask: ['TL', 'TR'] }],
  ['make the corner in the same row as this one weekly', '2x2', 'TL', 'TR'],
  ['make the corner in the same row as this one weekly', '3x3', 'BL', 'BR'],
  ['make the corner in the same column as this one weekly', '2x2', 'TR', 'BR'],
  ['make the corner in the same column as this one weekly', '3x3', 'TL', 'BL'],
  ['make the other corner on the same row weekly', '2x3', 'BR', 'BL'],
]
const meantOf = (m) => (typeof m === 'string' ? [m] : null)

describe('steps / other side / same-side corner: a plan on the CLICK is never applied; the anchor is never offered', () => {
  it.each(ROWS)('"%s" (%s, clicked %s)', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    expect(transcript()).not.toContain(`Did you mean Chart (${sel})?`)
    expect(offered()).not.toContain(`Chart (${sel})`)
  }, 40000)
})

describe('steps / other side / same-side corner: resolved when unique, asked with the real candidates when not', () => {
  it.each(ROWS)('"%s" (%s, clicked %s → %j)', async (t, g, sel, meant) => {
    const m = mount(g, sel)
    const one = meantOf(meant)
    // the plan an honest planner makes: on the chart meant; for an ask, on the first candidate (or a chart that is not the click)
    const target = one ? one[0] : meant.ask[0] || BOARDS[g].map(c => c.id).find(id => id !== sel)
    p.st.envelopes.push(planOn(target))
    await m.say(t)
    if (one) {
      expect(changed(m.board), transcript()).toEqual(one)
      expect(asked(), transcript()).toBe(false)
    } else {
      expect(changed(m.board), transcript()).toEqual([])
      expect(asked(), transcript()).toBe(true)
      if (meant.ask.length) expect(offered().sort(), transcript()).toEqual(meant.ask.map(id => `Chart (${id})`).sort())
    }
  }, 40000)
})

describe('negatives: a move of the click, or a count of bars / panes, is no chart reference — the click is acted on', () => {
  const ACT = [
    ['move this one up one row and make it weekly', '3x3', 'MM'],
    ['shift this chart two over to the right, and make it weekly', '1x3', 'L'],
    ['scroll this one two bars to the left and make it weekly', '2x3', 'TM'],
    ['make this one weekly; the RSI one pane up can stay', '2x2', 'BR'],
    ['make this chart weekly and keep the volume two panes down', '3x3', 'TM'],
  ]
  it.each(ACT)('"%s" (%s, clicked %s): the plan on the click runs there', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
  }, 40000)
})
