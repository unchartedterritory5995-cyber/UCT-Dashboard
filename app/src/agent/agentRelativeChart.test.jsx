// A chart named RELATIVE to the clicked one ("the one above this", "the chart to the right of this one", "the one next to this").
// Autotest u-target-02 (BROWSER-MOCK-MODEL, 11-07): BL clicked, "make the one above this weekly", the plan on TL, and the Agent asked
// "Which chart do you mean?" — the click was counted as the chart named and TL as unnamed. The click is the ANCHOR of a relative
// reference, never its target: the chart meant is the clicked chart's neighbour on that side. No click, no neighbour there, or two
// that fit → asked. A bare "this" still means the clicked chart. Through the REAL panel on the fixture board, the model scripted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { relativeChart } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// 2×2: c0 TL, c1 TR, c2 BL, c3 BR
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const WIDGETS = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const mountOn = (clicked) => {
  const m = p.mount(WIDGETS, SYMS, { decorate: label })
  if (clicked) p.select(clicked)
  return m
}
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const tfs = (b) => WIDGETS.map(w => tfOf(b, w.id)).join('')
const asked = () => /Which chart do you mean|Did you mean/.test(screen.getByTestId('agent-transcript').textContent)
// the model's plan on the chart the context labels `Chart (<id>)`
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

describe('relativeChart: the clicked chart is the anchor', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
  const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
  const hit = (t, sel) => relativeChart(t, C, sel)?.hits.map(c => c.ref) ?? null
  it.each([
    ['the one above this', 'c2', ['c0']], ['the chart below this one', 'c0', ['c2']], ['the one under it', 'c1', ['c3']],
    ['the one to the right of this', 'c0', ['c1']], ['the chart left of this one', 'c3', ['c2']], ['the cell right above this', 'c3', ['c1']],
    ['the one next to this', 'c2', ['c3']], ['the one beside the selected chart', 'c1', ['c0']],
  ])('%s (clicked %s) → %j', (t, sel, want) => expect(hit(t, sel)).toEqual(want))
  it('nothing on that side, or no click: no chart', () => {
    expect(hit('the one above this', 'c0')).toEqual([])
    expect(hit('the one above this', null)).toEqual([])
  })
  it('not a relative reference: null ("above 50", "this chart", "the top one")', () => {
    for (const t of ['alert me above 50', 'make this chart weekly', 'make the top one weekly', 'the right one']) expect(hit(t, 'c2')).toBeNull()
  })
})

describe('a chart named relative to the clicked one (u-target-02 family)', () => {
  it.each([['make the one above this weekly', 'c2', 'c0'], ['make the chart above this one weekly', 'c2', 'c0'],
    ['make the one to the right of this weekly', 'c0', 'c1'], ['make the one next to this weekly', 'c2', 'c3'],
    ['switch the chart below this one to weekly', 'c1', 'c3']])('%s (clicked %s): the plan on %s runs there; the clicked chart is unchanged', async (t, clicked, meant) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(meant))
    await say(t)
    expect(tfOf(b, meant)).toBe('W')
    expect(tfOf(b, clicked)).toBe('D')
    expect(asked()).toBe(false)
  }, 30000)
  it('NEGATIVE: the plan on the CLICKED chart is not run (it is the anchor, not the target)', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c2'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
  }, 30000)
  it('NEGATIVE: no chart on that side of the clicked one: asked, nothing changes', async () => {
    const { say, board: b } = mountOn('c0')
    p.st.envelopes.push(planOn('c2'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 30000)
  it('NEGATIVE: nothing clicked: no anchor, asked, nothing changes', async () => {
    const { say, board: b } = mountOn(null)
    p.st.envelopes.push(planOn('c0'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 30000)
  it('a bare "this" still means the clicked chart', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c2'))
    await say('make this one weekly for me please')
    expect(tfOf(b, 'c2')).toBe('W')
    expect(tfs(b)).toBe('DDWD')
  }, 30000)
})
