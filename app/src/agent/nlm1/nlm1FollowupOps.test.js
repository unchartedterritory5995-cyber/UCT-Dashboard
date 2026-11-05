// NLM-1 D2/D3.1 — the follow-up MECHANISMS on a fake 2×2 board: chart referent sets (positions, quantifiers, ordinals,
// tickers), repeat / additive copies of the last request, "back to" inversion from the pre-request snapshot, removal by
// position, ordinals over just-created charts. (End-to-end on the real panel: nlm1Workflows.test.jsx, workflows2.json.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { INPLAN_KEY } from './inplan'

// these units exercise EVERY rule, the in-plan ones included: the in-plan key (nlm1/inplan.js) is ON here — its OFF state
// is nlm1InplanGate.test.js
beforeAll(() => { localStorage.setItem(INPLAN_KEY, '1') })
afterAll(() => { localStorage.removeItem(INPLAN_KEY) })
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { resolveCharts, resolveFollowUpOps, rescopeOrdinal, snapshotOf } from './followupOps'
import { indicatorEditsRef } from '../capabilities/indicatorEdits'

await registerCatalog()

const cell = (x, y) => ({ x, y, w: 12, h: 10 })
function board(over = {}) {
  const charts = [
    { ref: 'c1', symbol: 'SPY', tf: 'W', cell: cell(0, 0) }, { ref: 'c2', symbol: 'QQQ', tf: 'D', cell: cell(12, 0) },
    { ref: 'c3', symbol: 'NVDA', tf: 'D', cell: cell(0, 10) }, { ref: 'c4', symbol: 'TSLA', tf: 'D', cell: cell(12, 10) },
  ].map(c => ({ ...c, ...(over[c.ref] || {}) }))
  const cs = { c1: { indicatorInstances: [{ instanceId: 'i1', defId: 'rsi', inputs: { period: 14 } }] }, c4: { indicatorInstances: [{ instanceId: 'i4', defId: 'rsi', inputs: { period: 14 } }] } }
  return { charts: { list: () => charts, read: (r) => ({ ...charts.find(c => c.ref === r), cs: cs[r] || { indicatorInstances: [] } }) } }
}
const memoryOf = (ops, { indicator = null } = {}) => ({
  lastTurn: () => ({ id: 1, ops, charts: [...new Set(ops.map(o => o.target))], undoIds: ['u1'] }),
  indicatorSet: () => (indicator ? [indicator] : null),
})

describe('chart referent sets', () => {
  const host = board()
  it('positions, quantifiers, ordinals, tickers', () => {
    expect(resolveCharts('the right one', { host })).toBeNull()                       // two "right" charts: no guess
    expect(resolveCharts('the top right', { host })).toEqual(['c2'])
    expect(resolveCharts('the bottom two', { host })).toEqual(['c3', 'c4'])
    expect(resolveCharts('the left two charts', { host })).toEqual(['c1', 'c3'])
    expect(resolveCharts('the other three', { host, last: ['c1'] })).toEqual(['c2', 'c3', 'c4'])
    expect(resolveCharts('the other two', { host, last: ['c1'] })).toBeNull()       // three others: the count must match
    expect(resolveCharts('the other two on the bottom', { host, last: ['c1'] })).toEqual(['c3', 'c4'])
    expect(resolveCharts('the first one', { host })).toEqual(['c1'])
    expect(resolveCharts('the first one', { host, created: ['c4', 'c3'] })).toEqual(['c4'])  // the request's new charts first
    expect(resolveCharts('NVDA', { host })).toEqual(['c3'])
    expect(resolveCharts('the top right and bottom left', { host })).toEqual(['c2', 'c3'])
    expect(resolveCharts('all of them', { host })).toEqual(['c1', 'c2', 'c3', 'c4'])
  })
})

describe('follow-ups as operations', () => {
  const host = board()
  const weekly = [{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } }]
  it('repeat on a set', () => {
    const r = resolveFollowUpOps('now the bottom two', { host, memory: memoryOf(weekly) })
    expect(r.ops).toEqual([{ action: 'chart.setTimeframe', target: 'c3', args: { timeframe: 'W' } }, { action: 'chart.setTimeframe', target: 'c4', args: { timeframe: 'W' } }])
    expect(resolveFollowUpOps('and the other three too', { host, memory: memoryOf(weekly) }).ops.map(o => o.target)).toEqual(['c2', 'c3', 'c4'])
    expect(resolveFollowUpOps('put that on TSLA as well', { host, memory: memoryOf(weekly) }).ops).toEqual([{ action: 'chart.setTimeframe', target: 'c4', args: { timeframe: 'W' } }])
  })
  it('additive: an indicator said as an addition goes on the charts the last request touched', () => {
    const r = resolveFollowUpOps('and macd too', { host, memory: memoryOf([{ action: 'indicator.add', target: 'c2', args: { defId: 'rsi', inputs: null } }]) })
    expect(r.ops).toEqual([{ action: 'indicator.add', target: indicatorEditsRef('c2'), args: expect.objectContaining({ defId: 'macd' }) }])
  })
  it('inversion: a value said, or the value before the last request', () => {
    expect(resolveFollowUpOps('back to daily', { host, memory: memoryOf(weekly) }).ops).toEqual([{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'D' } }])
    const before = snapshotOf(board({ c1: { tf: 'M' } }))
    expect(resolveFollowUpOps('go back to the previous timeframe', { host, memory: memoryOf(weekly), before }).ops).toEqual([{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'M' } }])
    expect(resolveFollowUpOps('put it back', { host, memory: memoryOf(weekly), before: snapshotOf(host) })).toBeNull()   // nothing changed since
  })
  it('removal by position: the indicator the conversation last added, found by what it IS', () => {
    const memory = memoryOf([{ action: 'indicator.add', target: 'c1', args: { defId: 'rsi' } }], { indicator: { chart: 'c1', instanceId: 'i1', defId: 'rsi' } })
    expect(resolveFollowUpOps('remove it from the bottom right one', { host, memory }).ops).toEqual([{ action: 'indicator.remove', target: indicatorEditsRef('c4'), args: { instance: 'i4' } }])
    expect(resolveFollowUpOps('take it off the top right', { host, memory })?.say).toMatch(/no rsi .*nothing was removed/i)   // not on that chart: said, never a guess
  })
  it('ordinals over just-created charts', () => {
    expect(rescopeOrdinal('make the second one weekly', { host, order: ['c3', 'c4'] }).ops).toEqual([{ action: 'chart.setTimeframe', target: 'c4', args: { timeframe: 'W' } }])
    expect(rescopeOrdinal('make the second one weekly', { host, order: ['c3'] })).toBeNull()      // fewer than two made: board order
  })
})
