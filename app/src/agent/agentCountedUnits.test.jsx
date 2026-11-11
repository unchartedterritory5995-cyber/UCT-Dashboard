// COUNTED relations with a UNIT noun (AUDIT on #988, held-out probe 13): "<count> charts / places / spots … to the left" on a 1×3 row
// applied a plan on the CLICK, and the right plan got "Did you mean Chart (<click>)?". Built from the family: counts (words and
// digits) × unit nouns (charts / cells / panes / panels / places / spots / positions / slots, and "over") × directions × grids.
// Belt and braces: whenever the words carry a count and a direction, the clicked chart (the ANCHOR) is never applied, never
// offered, and never named in a "Did you mean" headline — whether or not the walk resolves. Evidence: LOCAL native Windows Node
// v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans through the real panel).
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

const w = (id, x, y, ww = 8, hh = 10) => ({ id, x, y, w: ww, h: hh })
const GRIDS = {
  ROW3: [w('r0', 0, 0), w('r1', 8, 0), w('r2', 16, 0)],
  COL3: [w('k0', 0, 0, 24, 6), w('k1', 0, 6, 24, 6), w('k2', 0, 12, 24, 6)],
  G23: [w('a0', 0, 0), w('a1', 8, 0), w('a2', 16, 0), w('b0', 0, 10), w('b1', 8, 10), w('b2', 16, 10)],
}
const UNITS = ['charts', 'cells', 'panes', 'panels', 'places', 'spots', 'positions', 'slots']
const COUNT = { 2: ['two', '2'], 3: ['three', '3'] }
const SIDE = { left: 'to the left', right: 'to the right', above: 'above', below: 'below' }
// [grid, clicked, n, side, meant | null]
const CASES = [
  ['ROW3', 'r0', 2, 'right', 'r2'], ['ROW3', 'r2', 2, 'left', 'r0'], ['ROW3', 'r2', 3, 'left', null], ['ROW3', 'r1', 2, 'left', null],
  ['COL3', 'k0', 2, 'below', 'k2'], ['COL3', 'k2', 3, 'above', null],
  ['G23', 'b2', 2, 'left', 'b0'], ['G23', 'a1', 2, 'right', null],
]
// a phrasing per case, rotating units, word / digit, "over", anchored / anchorless (built here, not listed)
const ROWS = CASES.flatMap(([g, sel, n, side, meant], i) => COUNT[n].flatMap((cw, j) => {
  const unit = UNITS[(i * 2 + j) % UNITS.length]
  const over = (side === 'left' || side === 'right') && (i + j) % 2 ? ' over' : ''
  const rel = SIDE[side]
  const anchored = (side === 'left' || side === 'right') ? `${rel} of this one` : `${rel} this one`
  return [[g, sel, `the chart ${cw} ${unit}${over} ${anchored}`, meant], [g, sel, `the one ${cw} ${unit}${over} ${rel}`, meant]]
}))

describe('relativeChart: a count with a unit noun walks from the click', () => {
  const snaps = (g) => GRIDS[g].map(c => ({ ref: c.id, cell: { x: c.x, y: c.y, w: c.w, h: c.h } }))
  it.each(ROWS)('%s, clicked %s: "%s" → %s', (g, sel, np, meant) => {
    const r = relativeChart(`make ${np} weekly`, snaps(g), sel)
    expect(r, np).not.toBeNull()
    expect(r.hits.map(c => c.ref)).toEqual(meant ? [meant] : [])
  })
})

const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart do you mean|Did you mean/.test(transcript())
const mountGrid = (g, sel) => {
  const widgets = GRIDS[g].map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
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

describe('through the panel: a counted relation with a unit noun', () => {
  it.each(ROWS.filter(r => r[3]))('%s, clicked %s: "%s" — the plan on %s runs there; nothing asked', async (g, sel, np, meant) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe(GRIDS[g].map(c => (c.id === meant ? 'W' : 'D')).join(''))
    expect(asked()).toBe(false)
  }, 40000)
  it.each(ROWS)('%s, clicked %s: "%s" — a plan on the CLICK never runs; the anchor is never offered', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    anchorNeverOffered(sel)
  }, 40000)
  it.each(ROWS.filter(r => !r[3]))('%s, clicked %s: "%s" overshoots — asked without the anchor; nothing changes', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(GRIDS[g].find(c => c.id !== sel).id))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    anchorNeverOffered(sel)
  }, 40000)
})

// AUDIT (2): ANY count + direction in the words keeps the anchor out, even when no relation is recognised ("move it 2 over",
// "the panel 3 spaces left of here" with an unplaceable shape): never applied, never offered
describe('belt and braces: a count and a direction anywhere in the words', () => {
  const ODD = ['make the chart 2 spaces left of here weekly', 'put the one a couple over to the right on weekly', 'make it the chart 3 over weekly']
  it.each(ODD)('"%s" (ROW3, r1 clicked): a plan on the click never runs; the anchor is never offered', async (t) => {
    const m = mountGrid('ROW3', 'r1')
    p.st.envelopes.push(planOn('r1'))
    await m.say(t)
    expect(tfs(m.board), transcript()).toBe('DDD')
    anchorNeverOffered('r1')
  }, 40000)
})
