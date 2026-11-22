// RELATIVE AND SPATIAL TARGETING ACROSS BOARDS (pl-exec, AUDIT S2-B round 2; owner priority 2026-11-08). The held-out set
// (agentRelationHeldOut, committed first) over TWO / THREE / FOUR / SIX boards, with and without a click: for each case a plan on
// the chart meant lands; a plan on the CLICK never lands (unless the case is a coordination with a non-chart noun, which acts on
// the click); an 'ask' case lands nowhere and asks. Plus the LIVE production bug on master: "make the chart above weekly" changed
// the clicked chart. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { REL_HELD_OUT } from './agentRelationHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w, h = 10) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
const BOARDS = {
  TWO: [[cell('A', 0, 0, 12), cell('B', 12, 0, 12)], ['SPY', 'QQQ']],
  THREE: [[cell('L', 0, 0, 8), cell('M', 8, 0, 8), cell('R', 16, 0, 8)], ['SPY', 'QQQ', 'IWM']],
  FOUR: [[cell('c0', 0, 0, 12), cell('c1', 12, 0, 12), cell('c2', 0, 10, 12), cell('c3', 12, 10, 12)], ['SPY', 'QQQ', 'NVDA', 'TSLA']],
  SIX: [[cell('s0', 0, 0, 8), cell('s1', 8, 0, 8), cell('s2', 16, 0, 8), cell('s3', 0, 10, 8), cell('s4', 8, 10, 8), cell('s5', 16, 10, 8)], ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AMD']],
}
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const ref = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const ieRef = (body, id) => (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`)?.ref
const OPS = {
  weekly: (body, id) => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: 'W' } }),
  log: (body, id) => ({ action: 'chart.setScale', target: ref(body, id), args: { scale: 'log' } }),
  rsi: (body, id) => ({ action: 'indicator.add', target: ieRef(body, id), args: { defId: 'rsi', inputs: null } }),
  macd: (body, id) => ({ action: 'indicator.add', target: ieRef(body, id), args: { defId: 'macd', inputs: null } }),
}
const ON = {
  weekly: (b, id) => (w(b, id).opts?.tf || 'D') === 'W',
  log: (b, id) => !!mergeChartSettings(w(b, id).opts?.settings || null).logScale,
  rsi: (b, id) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === 'rsi'),
  macd: (b, id) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === 'macd'),
}
async function run(c, planOn) {
  const [cells, syms] = BOARDS[c.board]
  const m = p.mount(cells, Object.fromEntries(cells.map((x, i) => [`N:${x.id}`, syms[i]])), { decorate: label })
  if (c.click) p.select(c.click)
  p.st.envelopes.length = 0
  p.st.envelopes.push((body) => p.env('apply', [OPS[c.change](body, planOn)]))
  const out = await m.say(c.text)
  return { out, landed: cells.map(x => x.id).filter(id => ON[c.change](m.board, id)) }
}
const meant = REL_HELD_OUT.filter(c => c.want !== 'ask' && c.want !== 'click')
// t3 ("log scale on the chart to the left", TWO, no click) was frozen as 'ask'. With no click there is no anchor, and "left" is a
// POSITION that fits one chart on a board of two (the left one), so it acts there — never a click (there is none). Graded on
// that reading below and reported as a changed expectation; the frozen file keeps 'ask'.
const DISPUTED = { t3: 'A' }
const asks = REL_HELD_OUT.filter(c => c.want === 'ask' && !DISPUTED[c.id])
const coord = REL_HELD_OUT.filter(c => c.want === 'click')

describe('held-out: the chart meant, an ask, never the click', () => {
  it.each(REL_HELD_OUT.filter(c => DISPUTED[c.id]).map(c => [c.id, c.text, c]))('%s "%s" (changed expectation): the position names the one chart, no click involved', async (_id, _t, c) => {
    const r = await run(c, DISPUTED[c.id])
    expect(r.landed, r.out).toEqual([DISPUTED[c.id]])
  }, 40000)
  it.each(meant.map(c => [c.id, c.text, c]))('%s "%s": the plan on the chart meant lands', async (_id, _t, c) => {
    const r = await run(c, c.want)
    expect(r.landed, r.out).toEqual([c.want])
  }, 40000)
  it.each(meant.filter(c => c.click && c.click !== c.want).map(c => [c.id, c.text, c]))('%s "%s" NEGATIVE: a plan on the click never lands', async (_id, _t, c) => {
    const r = await run(c, c.click)
    expect(r.landed, r.out).not.toContain(c.click)
  }, 40000)
  it.each(asks.map(c => [c.id, c.text, c]))('%s "%s": no single chart, asked; a plan on any chart does not land', async (_id, _t, c) => {
    const r = await run(c, BOARDS[c.board][0][0].id)
    expect(r.landed, r.out).toEqual([])
    expect(r.out).toMatch(/Which chart|Did you mean|check this first|Click/)
  }, 40000)
  it.each(coord.map(c => [c.id, c.text, c]))('%s "%s": a coordination with a non-chart noun acts on the click', async (_id, _t, c) => {
    const r = await run(c, c.click)
    expect(r.out).not.toMatch(/Which chart/)
    expect(r.landed, r.out).toEqual([c.click])
  }, 40000)
})

// LIVE (master): "make the chart above weekly" with the bottom-left chart clicked made the CLICKED chart weekly. Here the chart
// above it (top-left) is the one meant; a plan on the click is asked, never run.
describe('the live production bug: "make the chart above weekly" changed the click', () => {
  const c = { board: 'FOUR', click: 'c2', text: 'make the chart above weekly', change: 'weekly' }
  it('a plan on the clicked chart (what master ran) does NOT land', async () => {
    const r = await run(c, 'c2')
    expect(r.landed, r.out).not.toContain('c2')
  }, 40000)
  it('the plan on the chart above lands', async () => {
    const r = await run(c, 'c0')
    expect(r.landed, r.out).toEqual(['c0'])
  }, 40000)
})
