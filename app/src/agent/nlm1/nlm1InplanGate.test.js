// NLM-1 · the IN-PLAN key (nlm1/inplan.js, default OFF): with it OFF, none of the rules no sealed pass ever took fires;
// the rules sealed passes DID use, and the safety behaviours (an honest refusal, a question), still do. With it ON, every
// rule behaves as at 36957ddf7a (nlm1Followups / nlm1FollowupOps tests, and nlm1Workflows with the key on).
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { INPLAN_KEY, inplanOn, setInplan } from './inplan'
import { rewriteSameRequest, rewriteFollowUp, rewriteClauses, nlm1Rewrite } from './followups'
import { resolveFollowUpOps, rescopeOrdinal, swapOps, resolveCharts } from './followupOps'

await registerCatalog()

const cell = (x, y) => ({ x, y, w: 12, h: 10 })
function board() {
  const charts = [{ ref: 'c1', symbol: 'NVDA', tf: 'W', cell: cell(0, 0) }, { ref: 'c2', symbol: 'AMD', tf: 'D', cell: cell(12, 0) }]
  const cs = { c1: { indicatorInstances: [{ instanceId: 'i1', defId: 'rsi', inputs: { period: 14 } }] }, c2: { indicatorInstances: [{ instanceId: 'i2', defId: 'rsi', inputs: { period: 14 } }] } }
  return { charts: { list: () => charts, read: (r) => ({ ...charts.find(c => c.ref === r), cs: cs[r] || { indicatorInstances: [] }, label: `Chart (${charts.find(c => c.ref === r)?.symbol})` }) } }
}
const memoryOf = (ops, ind = null) => ({ lastTurn: () => ({ id: 1, ops, charts: [...new Set(ops.map(o => o.target))], undoIds: ['u1'] }), indicatorSet: () => (ind ? [ind] : null) })
const host = board()
const weekly = [{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } }]
const addRsi = [{ action: 'indicator.add', target: 'c1', args: { defId: 'rsi', inputs: null } }]

beforeEach(() => { localStorage.removeItem(INPLAN_KEY) })
afterAll(() => { localStorage.removeItem(INPLAN_KEY) })

describe('the key', () => {
  it('is OFF by default, and only "1" turns it on', () => {
    expect(inplanOn()).toBe(false)
    expect(setInplan(true)).toBe(true)
    expect(setInplan(false)).toBe(false)
    expect(setInplan(null)).toBe(false)
  })
})

describe('key OFF: the never-taken rules do not fire', () => {
  it('rewrites: multi-ticker-create, structure, same-on-new-chart, borrow-verb, it-is-named-chart, same-for-ticker', () => {
    expect(rewriteSameRequest('add AMD and QQQ charts, both with RSI')?.rule || '').not.toMatch(/multi-ticker-create/)
    expect(rewriteSameRequest('give AMD rsi')).toBeNull()                                   // structure (give)
    expect(rewriteSameRequest('add a chart for AMD and set its timeframe to weekly')).toBeNull()   // structure (possessive)
    expect(rewriteSameRequest('add rsi to NVDA, then open a chart for AMD and do the same there')?.rule || '').not.toBe('same-on-new-chart')
    expect(rewriteFollowUp('and QQQ on the right one', 'put TSLA on the left chart')).toBeNull()           // borrow-verb
    expect(rewriteFollowUp('make it weekly and add rsi', 'put TSLA on the right chart')).toBeNull()        // it-is-named-chart
    expect(rewriteFollowUp('same for QQQ', 'add a chart for AMD and put RSI on it')).toBeNull()           // same-for-ticker
  })
  it('ops: back-to-before, swap, style-last-added, ordinal-of-created', () => {
    expect(resolveFollowUpOps('go back to the previous timeframe', { host, memory: memoryOf(weekly), before: { c1: { symbol: 'NVDA', tf: 'M' }, c2: { symbol: 'AMD', tf: 'D' } } })).toBeNull()
    const sets = (p) => resolveCharts(p, { host })
    expect(swapOps('swap the two charts', { host, sets })).toBeNull()
    expect(swapOps('swap the tickers on the two charts', { host, sets })).toBeNull()
    expect(resolveFollowUpOps('make it orange', { host, memory: memoryOf(addRsi) })?.rule).not.toBe('style-last-added')
    expect(rescopeOrdinal('make the second one weekly', { host, order: ['c1', 'c2'] })).toBeNull()
  })
})

describe('key OFF: what sealed passes used, and the safety behaviours, still work', () => {
  it('used rewrites: in-message-repeat (its internal "same for <ticker>"), same-on-chart, same-but-tf, add-to-it, clauses', () => {
    expect(rewriteSameRequest('make NVDA weekly and do the same with TSLA')).toMatchObject({ rule: 'in-message-repeat', steps: ['make NVDA weekly', 'make TSLA weekly'] })
    expect(rewriteFollowUp('now the right one too', 'make the left chart weekly')?.rule).toBe('same-on-chart')
    expect(rewriteFollowUp('same but weekly', 'add a chart for TSLA')?.rule).toBe('same-but-tf')
    expect(rewriteSameRequest('add rsi to the new one')?.text).toBe('put rsi on the new one')
    expect(rewriteClauses('make the left chart weekly and add rsi to the right chart')?.rule).toBe('clauses')
  })
  it('used ops: command-at-set, back-to-value, repeat-on-set, additive, referent-value, repeat-modified', () => {
    expect(resolveFollowUpOps('add macd to AMD', { host, memory: memoryOf([]) })?.rule).toBe('command-at-set')
    expect(resolveFollowUpOps('back to daily', { host, memory: memoryOf(weekly) })?.rule).toBe('back-to-value')
    expect(resolveFollowUpOps('put that on AMD as well', { host, memory: memoryOf(weekly) })?.rule).toBe('repeat-on-set')
    expect(resolveFollowUpOps('and macd too', { host, memory: memoryOf(addRsi) })?.rule).toBe('additive')
    expect(resolveFollowUpOps('and that one monthly', { host, memory: memoryOf(weekly) })?.rule).toBe('referent-value')
    expect(resolveFollowUpOps('same but monthly for AMD', { host, memory: memoryOf(weekly) })?.rule).toBe('repeat-modified')
  })
  it('safety stays ON: remove-not-there (an honest refusal) and remove-ambiguous (a question)', () => {
    const memory = memoryOf(addRsi, { chart: 'c1', instanceId: 'i1', defId: 'macd' })
    expect(resolveFollowUpOps('remove it from the right one', { host, memory })?.rule).toBe('remove-not-there')
    const twoRsi = { charts: { list: host.charts.list, read: (r) => ({ ...host.charts.read(r), cs: { indicatorInstances: [{ instanceId: 'a', defId: 'rsi', inputs: { period: 14 } }, { instanceId: 'b', defId: 'rsi', inputs: { period: 7 } }] } }) } }
    expect(resolveFollowUpOps('remove the rsi from the right one', { host: twoRsi, memory })?.rule).toBe('remove-ambiguous')
  })
})

describe('key OFF: the runtime-built names no sealed case fired (AUDIT classification) are dark too', () => {
  it('pipeline stages verbless-assign / with-indicator / quantifier / distribute-indicators at the top level', () => {
    expect(rewriteSameRequest('TSLA on the left chart, META on the right one')).toBeNull()
    expect(rewriteSameRequest('add a chart for AMD with RSI')).toBeNull()
    expect(rewriteSameRequest('add rsi to both')).toBeNull()
    expect(rewriteSameRequest('put RSI and MACD on it')).toBeNull()
  })
  it('same-on-charts (the plural); same-on-chart (used) stays', () => {
    expect(rewriteFollowUp('do the same for the bottom two', 'make the top left chart weekly')).toBeNull()
    expect(rewriteFollowUp('now the right one too', 'make the left chart weekly')?.rule).toBe('same-on-chart')
  })
  it('a <follow-up>+<same-request> composite', () => {
    expect(nlm1Rewrite('same but weekly', { prev: 'add a chart for TSLA with RSI', claims: () => true })?.rule).toBe('same-but-tf')
  })
  it('a USED rule keeps its internal path (clauses normalise their parts)', () => {
    expect(rewriteClauses('make the left chart weekly and add rsi to both')?.steps).toEqual(['make the left chart weekly', 'add rsi to both charts'])
  })
})

describe('key OFF: remove-on-charts is NOT gated (cross-turn; always a proposal)', () => {
  it('reads "remove it from the right one" as an indicator.remove of the indicator found by what it is', () => {
    const r = resolveFollowUpOps('remove it from the right one', { host, memory: memoryOf(addRsi, { chart: 'c1', instanceId: 'i1', defId: 'rsi' }) })
    expect(r?.rule).toBe('remove-on-charts')
    expect(r.ops).toEqual([{ action: 'indicator.remove', target: expect.stringContaining('c2'), args: { instance: 'i2' } }])
  })
})
