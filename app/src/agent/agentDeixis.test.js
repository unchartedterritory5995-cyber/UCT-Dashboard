// UCT Agent — Context & Awareness, Slice 1B: agent/deixis.js + the host's selection mapping.
// End-to-end rails (real ChartsWorkspace + panel): pages/charts/ChartsWorkspace.thisChart.test.jsx.
import { describe, it, expect } from 'vitest'
import { pointsAtChart, resolveDeictic, screenDeicticOps } from './deixis'
import { buildChartSource } from './host'
import { buildContext, getCapability, getTargetKind } from './capabilities'
import { registerBuiltins } from './builtins'
import { mergeChartSettings } from '../components/chart/chartDefaults'

registerBuiltins()

// A host built by the REAL buildChartSource over adapters, as ChartsWorkspace builds it.
function makeHost({ widgets = [['L', 0, 'NVDA'], ['R', 12, 'AMD']], selected = null } = {}) {
  const ws = widgets.map(([id, x]) => ({ id, type: 'chart', x, y: 0, w: 12, h: 20, color: id }))
  const apis = new Map(widgets.map(([id, , sym]) => [`m-${id}`, { agent: {
    read: () => ({ chartId: id, tabId: null, groupKey: id, symbol: sym, tf: 'D', cs: mergeChartSettings(null), stored: null }),
  } }]))
  const state = { ws, selected }
  const charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => state.ws, selectedChart: () => state.selected })
  return { host: { charts }, state }
}
const chartKind = () => getTargetKind('chart')

describe('pointsAtChart', () => {
  it.each(['switch this chart to weekly', "what's going on with this stock", 'add RSI to the current chart', 'this one', 'the selected chart', 'my chart'])('%s', (t) => expect(pointsAtChart(t)).toBe(true))
  it.each(['switch to weekly', 'put it in Momentum', 'what is it', 'open the left chart', 'chart the S&P', 'move the right chart to weekly', 'the top chart', 'the other chart'])('%s → no', (t) => expect(pointsAtChart(t)).toBe(false))
  it('"this NVDA chart" points (a named ticker)', () => expect(pointsAtChart('switch this NVDA chart to weekly')).toBe(true))
  it('"it" only for a chart-kind op', () => {
    expect(pointsAtChart('make it weekly')).toBe(false)
    expect(pointsAtChart('make it weekly', { chartOp: true })).toBe(true)
  })
})

describe('host selection (buildChartSource)', () => {
  it('marks only the clicked chart, and only while it is still on the board', () => {
    const { host, state } = makeHost({ selected: 'R' })
    expect(host.charts.list().map(c => [c.ref, !!c.selected])).toEqual([['L', false], ['R', true]])
    expect(host.charts.selected()).toBe('R')
    state.ws = state.ws.filter(w => w.id !== 'R')                    // the chart was closed
    expect(host.charts.selected()).toBeNull()
    expect(host.charts.list().some(c => c.selected)).toBe(false)
  })
  it('context: `selected: true` on that chart only (omitted elsewhere)', () => {
    const { host } = makeHost({ selected: 'L' })
    const charts = buildContext(host, { surface: 'charts' }).context.charts
    expect(charts.map(c => c.selected)).toEqual([true, undefined])
  })
})

describe('resolveDeictic', () => {
  it('selection → that chart; none → ask with every chart as a choice; single chart → it', () => {
    const { host, state } = makeHost({ selected: 'R' })
    const kind = chartKind()
    expect(resolveDeictic({ host, kind, candidates: host.charts.list(), text: 'switch this chart to weekly' })).toEqual({ ref: 'R' })
    state.selected = null
    const r = resolveDeictic({ host, kind, candidates: host.charts.list(), text: 'switch this chart to weekly' })
    expect(r.ask.choices.map(c => c.ref)).toEqual(['L', 'R'])
    const solo = makeHost({ widgets: [['S', 0, 'SPY']] })
    expect(resolveDeictic({ host: solo.host, kind, candidates: solo.host.charts.list(), text: 'this chart' })).toEqual({ ref: 'S' })
  })
  it('a named symbol beats the selection ("this NVDA chart")', () => {
    const { host } = makeHost({ selected: 'R' })
    expect(resolveDeictic({ host, kind: chartKind(), candidates: host.charts.list(), text: 'switch this NVDA chart to weekly' })).toEqual({ ref: 'L' })
  })
  it('not deictic → null (the caller\'s own rule decides, unchanged)', () => {
    const { host } = makeHost({ selected: 'R' })
    expect(resolveDeictic({ host, kind: chartKind(), candidates: host.charts.list(), text: 'switch to weekly' })).toBeNull()
  })
})

describe('screenDeicticOps (model plans)', () => {
  const op = (target) => ({ action: 'chart.setTimeframe', target, args: { timeframe: 'W' } })
  it('a plan on another chart → asked; on the selected chart → passes; no deictic words → passes', () => {
    const { host } = makeHost({ selected: 'L' })
    expect(screenDeicticOps({ host, ops: [op('R')], text: 'put this stock on weekly', getTargetKind, getCapability }).ask.text).toMatch(/^Did you mean .*\(NVDA\)\?$/)
    expect(screenDeicticOps({ host, ops: [op('L')], text: 'put this stock on weekly', getTargetKind, getCapability })).toBeNull()
    expect(screenDeicticOps({ host, ops: [op('R')], text: 'put the right one on weekly', getTargetKind, getCapability })).toBeNull()
  })
  it('no selection on a multi-chart board → asked, whatever the model picked', () => {
    const { host } = makeHost()
    expect(screenDeicticOps({ host, ops: [op('L')], text: 'make it weekly', getTargetKind, getCapability }).ask).toBeTruthy()
  })
  it('same-plan aliases and single-chart boards pass', () => {
    const { host } = makeHost()
    expect(screenDeicticOps({ host, ops: [{ action: 'chart.setTimeframe', target: 'new1', args: { timeframe: 'W' } }], text: 'make this chart weekly', getTargetKind, getCapability })).toBeNull()
    const solo = makeHost({ widgets: [['S', 0, 'SPY']] })
    expect(screenDeicticOps({ host: solo.host, ops: [op('S')], text: 'make this chart weekly', getTargetKind, getCapability })).toBeNull()
  })
})

// OWNER DECISION 2026-10-12: a BARE chart command uses the valid clicked chart; otherwise ask.
describe('bare chart commands (no "this") on a multi-chart board', () => {
  it('use the clicked chart while it is valid; no click → null (the caller asks)', () => {
    const { host, state } = makeHost({ selected: 'R' })
    const kind = chartKind()
    expect(resolveDeictic({ host, kind, candidates: host.charts.list(), text: 'switch to weekly', chartOp: true })).toEqual({ ref: 'R', implicit: true })
    state.selected = null
    expect(resolveDeictic({ host, kind, candidates: host.charts.list(), text: 'switch to weekly', chartOp: true })).toBeNull()
  })
  it('a clicked chart that was CLOSED (or belongs to another layout) is not valid → null, never another chart', () => {
    const { host, state } = makeHost({ selected: 'R' })
    state.ws = state.ws.filter(w => w.id !== 'R')
    state.ws.push({ id: 'X', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'X' })
    expect(host.charts.selected()).toBeNull()
    expect(resolveDeictic({ host, kind: chartKind(), candidates: host.charts.list(), text: 'switch to weekly', chartOp: true })).toBeNull()
  })
  it('the model-path screen is unchanged: only deictic words are screened', () => {
    const { host } = makeHost({ selected: 'L' })
    expect(screenDeicticOps({ host, ops: [{ action: 'chart.setTimeframe', target: 'R', args: { timeframe: 'W' } }], text: 'switch the right chart to weekly', getTargetKind, getCapability })).toBeNull()
  })
})
