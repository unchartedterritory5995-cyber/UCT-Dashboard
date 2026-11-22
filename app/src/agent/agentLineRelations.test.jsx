// LINE references (AUDIT held-out probe 16 shapes, folded into #988; written from the family, not from the probe):
//   (a) "the <ordinal / position> chart in / of / on this | the <row | column>": "this row / column" is the CLICK's line — the click
//       is only a reference there, never the target unless the ordinal lands on it; "the top / bottom / left / right / middle /
//       first / last … row / column" is ABSOLUTE and resolves without the click. first / second / third / last / middle /
//       leftmost / rightmost / top / bottom are ordinals within that line.
//   (b) "same <axis> but the other <axis>" (same column but the other row, same row but a different column).
//   (c) row variants: "a row up", "a row lower", "across the row".
// One chart → it; none or several → asked with the real candidates, never the click as the anchor. Negatives: a row or column as
// a non-target noun phrase ("the row below is fine, just make this one weekly") acts on the click. On 1×3, 2×2, 2×3 and 3×3.
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
const asked = () => /Which chart|Did you mean|Which charts|Pick one/.test(transcript())
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
const RELATIVE_ROWS = [
  // (a) "this row / column": the click's own line
  ['make the first chart in this row weekly', '2x3', 'BR', 'BL'],
  ['make the last one in this row weekly', '3x3', 'ML', 'MR'],
  ['make the middle chart of this row weekly', '3x3', 'BL', 'BM'],
  ['make the top chart in this column weekly', '3x3', 'BM', 'TM'],
  ['make the bottom one of this column weekly', '2x2', 'TR', 'BR'],
  ['make the leftmost chart on this row weekly', '1x3', 'R', 'L'],
  ['make the second chart in this column weekly', '3x3', 'TR', 'MR'],
  ['make the middle chart of this row weekly', '2x2', 'TL', { ask: [] }],             // an even row has no middle
  // (b) same <axis> but the other <axis>
  ['make the one in the same column but the other row weekly', '2x2', 'TL', 'BL'],
  ['make the chart in the same row but the other column weekly', '2x2', 'BR', 'BL'],
  ['make the chart in the same column but a different row weekly', '2x3', 'TM', 'BM'],
  ['make the one in the same row but the other column weekly', '2x3', 'TM', { ask: ['TL', 'TR'] }],
  ['make the chart in the same column but the other row weekly', '3x3', 'MM', { ask: ['TM', 'BM'] }],
  // (c) row variants
  ['make the chart a row up weekly', '3x3', 'BM', 'MM'],
  ['make the one a row lower weekly', '2x3', 'TR', 'BR'],
  ['make the chart across the row weekly', '1x3', 'R', 'L'],
  ['make the chart across the column weekly', '2x2', 'TL', 'BL'],
]
// ABSOLUTE lines: resolved without the click (any click, or none)
const ABSOLUTE_ROWS = [
  ['make the middle chart on the bottom row weekly', '2x3', 'TL', 'BM'],
  ['make the first chart in the top row weekly', '3x3', 'BR', 'TL'],
  ['make the last one in the bottom row weekly', '2x3', 'TM', 'BR'],
  ['make the top chart in the right column weekly', '3x3', 'BL', 'TR'],
  ['make the bottom one of the left column weekly', '2x2', 'TR', 'BL'],
  ['make the middle chart of the middle row weekly', '3x3', 'TL', 'MM'],
  ['make the second chart in the top row weekly', '2x3', 'BR', 'TM'],
]
const meantOf = (m) => (typeof m === 'string' ? [m] : null)

describe('line references from the click: a plan on the click never runs unless the words land on it; the anchor never offered', () => {
  it.each(RELATIVE_ROWS)('"%s" (%s, clicked %s)', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    expect(transcript()).not.toContain(`Did you mean Chart (${sel})?`)
    expect(offered()).not.toContain(`Chart (${sel})`)
  }, 40000)
  it.each(RELATIVE_ROWS)('"%s" (%s, clicked %s → %j): resolved when unique, asked with the real candidates when not', async (t, g, sel, meant) => {
    const m = mount(g, sel)
    const one = meantOf(meant)
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
  it('the ordinal lands ON the click: "the first chart in this row" with the first chart clicked → the click', async () => {
    const m = mount('2x3', 'BL')
    p.st.envelopes.push(planOn('BL'))
    await m.say('make the first chart in this row weekly')
    expect(changed(m.board), transcript()).toEqual(['BL'])
  }, 40000)
})

describe('absolute lines: resolved without the click', () => {
  it.each(ABSOLUTE_ROWS)('"%s" (%s, clicked %s → %s)', async (t, g, sel, meant) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([meant])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  it.each(ABSOLUTE_ROWS)('"%s" (%s, clicked %s): a plan on the click (not that chart) never runs', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
  }, 40000)
})

describe('negatives: a row or a column as a non-target noun phrase — the click is acted on', () => {
  const ACT = [
    ['the row below is fine, just make this one weekly', '3x3', 'MM'],
    ['the column on the right is fine, just make this one weekly', '2x3', 'TL'],
    ['leave the top row alone and make this chart weekly', '2x3', 'BM'],
    ['make this one weekly, the other charts in this row can stay', '3x3', 'ML'],
  ]
  it.each(ACT)('"%s" (%s, clicked %s): the plan on the click runs there', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
  }, 40000)
})
