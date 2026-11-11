// SHARED-CHANGE CLAUSES and ANCHORLESS RELATIONS (pl-exec, 2026-11-07, after pl-auto's unseen4 / unseen5 browser runs).
//  • "the TSLA chart to the hourly and this one too", "draw a line at 120 on this one and on the TSLA chart": one change said once,
//    for two charts each named in its own clause (the click, or a name). Each affirmative clause gets its own chart; the change
//    goes to both; asked only when a clause is genuinely ambiguous.
//  • "put a macd on the chart above" with a chart clicked: an anchorless relation reads from the click (decision 2026-11-07,
//    revisited after the owner's conversational-targeting decision); with no click it is asked.
// Tuning: pl-auto's own sentences. Held-out: agentClauseRelHeldOut (committed first). Paired: the plan on the meant charts
// lands; a plan on another chart never does. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { SHARED_HELD_OUT, ANCHORLESS_HELD_OUT } from './agentClauseRelHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['AVGO'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 12) => ({ id, type: 'chart', x, y, w, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const FOUR_SYMS = { 'N:c0': 'SPY', 'N:c1': 'NVDA', 'N:c2': 'AMD', 'N:c3': 'TSLA' }
const THREE = [cell('l', 0, 0, 8), cell('m', 8, 0, 8), cell('r', 16, 0, 8)]
const THREE_SYMS = { 'N:l': 'SPY', 'N:m': 'QQQ', 'N:r': 'IWM' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const ref = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const ieRef = (body, id) => (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`)?.ref
const OPS = {
  weekly: (body, id) => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: 'W' } }),
  monthly: (body, id) => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: 'M' } }),
  hourly: (body, id) => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: '60' } }),
  log: (body, id) => ({ action: 'chart.setScale', target: ref(body, id), args: { scale: 'log' } }),
  macd: (body, id) => ({ action: 'indicator.add', target: ieRef(body, id), args: { defId: 'macd', inputs: null } }),
  rsi: (body, id) => ({ action: 'indicator.add', target: ieRef(body, id), args: { defId: 'rsi', inputs: null } }),
  hideVolume: (body, id) => ({ action: 'volume.setState', target: ref(body, id), args: { state: 'hidden' } }),
  avgo: (body, id) => ({ action: 'chart.setSymbol', target: ref(body, id), args: { symbol: 'AVGO' } }),
}
const ON = {
  weekly: (b, id) => (w(b, id).opts?.tf || 'D') === 'W',
  monthly: (b, id) => (w(b, id).opts?.tf || 'D') === 'M',
  hourly: (b, id) => w(b, id).opts?.tf === '60',
  log: (b, id) => !!mergeChartSettings(w(b, id).opts?.settings || null).logScale,
  macd: (b, id) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === 'macd'),
  rsi: (b, id) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === 'rsi'),
  hideVolume: (b, id) => mergeChartSettings(w(b, id).opts?.settings || null).volume?.visible === false || w(b, id).opts?.settings?.showVolume === false || JSON.stringify(w(b, id).opts?.settings || {}).includes('"volume":{"visible":false'),
  avgo: (b, id, syms) => syms[`N:${id}`] === 'AVGO',
}
async function run({ board = 'FOUR', click, text, plan }) {
  const [widgets, syms] = board === 'THREE' ? [THREE, { ...THREE_SYMS }] : [FOUR, { ...FOUR_SYMS }]
  const m = p.mount(widgets, syms, { decorate: label })
  if (click) p.select(click)
  p.st.envelopes.length = 0
  p.st.envelopes.push((body) => p.env('apply', plan.map(([k, id]) => OPS[k](body, id))))
  const out = await m.say(text)
  return { b: m.board, out, ids: widgets.map(x => x.id), syms: m.board.state.groupSyms || syms }
}
const where = (r, k) => r.ids.filter(id => ON[k](r.b, id, r.syms))

describe('tuning (pl-auto unseen4 / unseen5): each clause its own chart, one change for both', () => {
  it('u4-clauses-08 "the TSLA chart to the hourly and this one too" (clicked TL): both hourly', async () => {
    const r = await run({ click: 'c0', text: 'the TSLA chart to the hourly and this one too', plan: [['hourly', 'c3'], ['hourly', 'c0']] })
    expect(where(r, 'hourly').sort(), r.out).toEqual(['c0', 'c3'])
  }, 40000)
  it('NEGATIVE u4-clauses-08 with one op aimed at a third chart: asked, nothing on it', async () => {
    const r = await run({ click: 'c0', text: 'the TSLA chart to the hourly and this one too', plan: [['hourly', 'c3'], ['hourly', 'c1']] })
    expect(where(r, 'hourly'), r.out).not.toContain('c1')
  }, 40000)
  it('u4-clauses-10 "this one and the one to its left on the weekly" (THREE, clicked R): R and M weekly', async () => {
    const r = await run({ board: 'THREE', click: 'r', text: 'this one and the one to its left on the weekly', plan: [['weekly', 'r'], ['weekly', 'm']] })
    expect(where(r, 'weekly').sort(), r.out).toEqual(['m', 'r'])
  }, 40000)
  it('NEGATIVE u4-clauses-10 with the second op on L: never lands on L', async () => {
    const r = await run({ board: 'THREE', click: 'r', text: 'this one and the one to its left on the weekly', plan: [['weekly', 'r'], ['weekly', 'l']] })
    expect(where(r, 'weekly'), r.out).not.toContain('l')
  }, 40000)
  it('u4-clauses-04 "hide volume on the middle chart and switch this one to AVGO" (THREE, clicked L): each on its own chart', async () => {
    const r = await run({ board: 'THREE', click: 'l', text: 'hide volume on the middle chart and switch this one to AVGO', plan: [['hideVolume', 'm'], ['avgo', 'l']] })
    expect(r.out).not.toMatch(/Did you mean|Which chart/)
    expect(r.out).toMatch(/AVGO/)
  }, 40000)
  it('NEGATIVE u4-clauses-04 with the symbol on the middle chart: asked', async () => {
    const r = await run({ board: 'THREE', click: 'l', text: 'hide volume on the middle chart and switch this one to AVGO', plan: [['hideVolume', 'm'], ['avgo', 'm']] })
    expect(r.out).toMatch(/Did you mean|Which chart|check this first/)
  }, 40000)
  it('u5-relation-controls-02 "put a macd on the chart above" (clicked BL): the MACD lands on TL', async () => {
    const r = await run({ click: 'c2', text: 'put a macd on the chart above', plan: [['macd', 'c0']] })
    expect(where(r, 'macd'), r.out).toEqual(['c0'])
  }, 40000)
  it('NEGATIVE u5-relation-controls-02 with the plan on the click: never lands there', async () => {
    const r = await run({ click: 'c2', text: 'put a macd on the chart above', plan: [['macd', 'c2']] })
    expect(where(r, 'macd'), r.out).toEqual([])
  }, 40000)
})

describe('held-out', () => {
  it.each(SHARED_HELD_OUT.map(c => [c.id, c]))('%s: the change on both clauses\' charts', async (_id, c) => {
    const r = await run({ click: c.click, text: c.text, plan: c.charts.map(id => [c.change, id]) })
    expect(where(r, c.change).sort(), r.out).toEqual([...c.charts].sort())
  }, 40000)
  it.each(SHARED_HELD_OUT.map(c => [c.id, c]))('%s NEGATIVE: one op moved to a chart neither clause names never lands', async (_id, c) => {
    const other = ['c0', 'c1', 'c2', 'c3'].find(id => !c.charts.includes(id))
    const r = await run({ click: c.click, text: c.text, plan: [[c.change, c.charts[0]], [c.change, other]] })
    expect(where(r, c.change), r.out).not.toContain(other)
  }, 40000)
  it.each(ANCHORLESS_HELD_OUT.filter(c => c.charts !== 'ask').map(c => [c.id, c]))('%s: the neighbour of the click', async (_id, c) => {
    const r = await run({ click: c.click, text: c.text, plan: [[c.change, c.charts[0]]] })
    expect(where(r, c.change), r.out).toEqual(c.charts)
  }, 40000)
  it.each(ANCHORLESS_HELD_OUT.filter(c => c.charts !== 'ask').map(c => [c.id, c]))('%s NEGATIVE: a plan on the click itself never lands', async (_id, c) => {
    const r = await run({ click: c.click, text: c.text, plan: [[c.change, c.click]] })
    expect(where(r, c.change), r.out).toEqual([])
  }, 40000)
  it.each(ANCHORLESS_HELD_OUT.filter(c => c.charts === 'ask').map(c => [c.id, c]))('%s: no click, asked; a plan on any chart does not land', async (_id, c) => {
    const r = await run({ click: null, text: c.text, plan: [[c.change, 'c0']] })
    expect(where(r, c.change), r.out).toEqual([])
    expect(r.out).toMatch(/Which chart|check this first|Click/)
  }, 40000)
})

// ⛔ AUDIT S2-A (ship-2): a bare "one" stands for the nearest noun before it. When that is a line, an alert or a level, "the one
// below / above" relates THAT thing, not a chart: the sentence acts on the click as before (no "Which chart?"). A chart word, or no
// noun at all, keeps the relation: with no click those still ask, never act.
describe('AUDIT S2-A: "the one below" after a line, an alert or a level is not a chart relation', () => {
  it.each([
    'make this chart weekly and delete the line and the one below',
    'make it weekly, the level I drew and the one above are both support',
  ])('"%s" (clicked BL): the click is weekly, no question', async (text) => {
    const r = await run({ click: 'c2', text, plan: [['weekly', 'c2']] })
    expect(r.out).not.toMatch(/Which chart/)
    expect(where(r, 'weekly'), r.out).toEqual(['c2'])
  }, 40000)
  it.each([
    ['make the chart above weekly', 'weekly'],
    ['log scale on the one to the right', 'log'],
    ['put a macd on the chart below', 'macd'],
  ])('"%s" with NO click still asks; a plan on any chart does not land', async (text, change) => {
    const r = await run({ click: null, text, plan: [[change, 'c0']] })
    expect(where(r, change), r.out).toEqual([])
    expect(r.out).toMatch(/Which chart|check this first|Click/)
  }, 40000)
})

// ⛔ AUDIT S2-B (round 2, a WRONG-CHART defect of S2-A): "one" stands for a thing ONLY when coordinated with it in the same noun
// phrase. After a preposition "the one <relation>" is the place, a chart; a word separated from "one" by a verb or a preposition
// is never its antecedent. Probe 7: the neighbour runs, a plan on the click is asked — never the click.
describe('AUDIT S2-B: "to the one below" is a chart; only coordination makes "one" a thing', () => {
  it.each([
    ['add RSI to the one below', 'rsi', 'c2'],
    ['put a MACD on the one to the right', 'macd', 'c1'],
    ['the rsi looks good here, now make the one below weekly', 'weekly', 'c2'],
  ])('"%s" (clicked TL): the plan on the neighbour lands', async (text, change, meant) => {
    const r = await run({ click: 'c0', text, plan: [[change, meant]] })
    expect(where(r, change), r.out).toEqual([meant])
  }, 40000)
  it.each([
    ['add RSI to the one below', 'rsi'],
    ['put a MACD on the one to the right', 'macd'],
    ['the rsi looks good here, now make the one below weekly', 'weekly'],
  ])('NEGATIVE "%s" (clicked TL): a plan on the CLICK never lands', async (text, change) => {
    const r = await run({ click: 'c0', text, plan: [[change, 'c0']] })
    expect(where(r, change), r.out).not.toContain('c0')
  }, 40000)
  it('an ambiguous move ("move the alert to the one below") asks; it never acts on the click', async () => {
    const r = await run({ click: 'c2', text: 'make this one weekly, then move the alert to the one below', plan: [['weekly', 'c2']] })
    expect(r.out).toMatch(/Which chart|Did you mean|check this first/)
    expect(where(r, 'weekly'), r.out).toEqual([])
  }, 40000)
})
