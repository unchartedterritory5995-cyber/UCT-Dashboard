// COUNTED relations to the clicked chart (AUDIT on #988, LIVE): with c2 clicked, "make the chart two to the left weekly" applied a
// plan on the CLICK, and the correct plan got "Did you mean Chart (c2)?" — the anchor itself offered. The click is the ANCHOR of a
// counted relation too: "two / three / second / next-but-one" × left / right / above / below walks that many cells from it, one
// unique neighbour at a time. An overshoot resolves to NO chart and asks — never the anchor, and no ask ever offers the anchor.
// Over 1×3, 3×1 and 2×3 grids, built from the family. Through the REAL panel; plans scripted. Evidence: LOCAL native Windows Node
// v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
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
  ROW3: [w('r0', 0, 0), w('r1', 8, 0), w('r2', 16, 0)],                                   // 1×3
  COL3: [w('k0', 0, 0, 24, 6), w('k1', 0, 6, 24, 6), w('k2', 0, 12, 24, 6)],                // 3×1
  G23: [w('a0', 0, 0), w('a1', 8, 0), w('a2', 16, 0), w('b0', 0, 10), w('b1', 8, 10), w('b2', 16, 10)],   // 2×3
}
// the count words and the noun phrases they make, per direction (anchored on the click, or anchorless: the click is the anchor)
const SIDE = { left: 'to the left', right: 'to the right', above: 'above', below: 'below' }
const PHRASES = (n, side) => {
  const rel = SIDE[side]
  const word = { 2: 'two', 3: 'three' }[n]
  const out = [`the chart ${word} ${rel} of this one`.replace(' of this one', side === 'above' || side === 'below' ? ' this one' : ' of this one'),
    `the one ${word} ${rel}`]
  if (n === 2) out.push(`the second chart ${rel}${side === 'above' || side === 'below' ? ' this' : ' of this'}`, `the next-but-one chart ${rel}`)
  return out
}
// [grid, clicked, n, side, meant | null]
const CASES = [
  ['ROW3', 'r0', 2, 'right', 'r2'], ['ROW3', 'r2', 2, 'left', 'r0'], ['ROW3', 'r2', 3, 'left', null], ['ROW3', 'r1', 2, 'right', null],
  ['COL3', 'k0', 2, 'below', 'k2'], ['COL3', 'k2', 2, 'above', 'k0'], ['COL3', 'k2', 3, 'above', null],
  ['G23', 'b2', 2, 'left', 'b0'], ['G23', 'a0', 2, 'right', 'a2'], ['G23', 'b0', 2, 'above', null], ['G23', 'a1', 2, 'below', null],
]
const ROWS = CASES.flatMap(([g, sel, n, side, meant]) => PHRASES(n, side).map(np => [g, sel, np, meant]))

describe('relativeChart: counted relations from the click', () => {
  const snaps = (g) => GRIDS[g].map(c => ({ ref: c.id, cell: { x: c.x, y: c.y, w: c.w, h: c.h } }))
  it.each(ROWS)('%s, clicked %s: "%s" → %s', (g, sel, np, meant) => {
    const r = relativeChart(`make ${np} weekly`, snaps(g), sel)
    expect(r, np).not.toBeNull()
    expect(r.hits.map(c => c.ref)).toEqual(meant ? [meant] : [])
    expect(r.hits.map(c => c.ref)).not.toContain(sel)
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
// AUDIT (2): an ask never SUGGESTS the anchor ("Did you mean Chart (<click>)?") and never lists it among the choices
function noAnchorOffered(sel) {
  expect(transcript(), 'the anchor suggested').not.toContain(`Did you mean Chart (${sel})?`)
  const offered = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
  if (asked()) expect(offered, 'the anchor offered as a choice').not.toContain(`Chart (${sel})`)
}

describe('through the panel: the click is the anchor of a counted relation', () => {
  const MEANT = ROWS.filter(r => r[3])
  const NONE = ROWS.filter(r => !r[3])
  it.each(MEANT)('%s, clicked %s: "%s" — the plan on %s runs there; the click is unchanged; nothing asked', async (g, sel, np, meant) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(`make ${np} weekly`)
    const want = GRIDS[g].map(c => (c.id === meant ? 'W' : 'D')).join('')
    expect(tfs(m.board), transcript()).toBe(want)
    expect(asked()).toBe(false)
  }, 40000)
  it.each(ROWS)('%s, clicked %s: "%s" — a plan on the CLICK never runs; any ask leaves the anchor out', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    noAnchorOffered(sel)
  }, 40000)
  it.each(NONE)('%s, clicked %s: "%s" overshoots — no chart: asked, nothing changes, never the anchor', async (g, sel, np) => {
    const m = mountGrid(g, sel)
    const other = GRIDS[g].find(c => c.id !== sel).id
    p.st.envelopes.push(planOn(other))
    await m.say(`make ${np} weekly`)
    expect(tfs(m.board), transcript()).toBe('D'.repeat(GRIDS[g].length))
    expect(asked()).toBe(true)
    noAnchorOffered(sel)
  }, 40000)
})
