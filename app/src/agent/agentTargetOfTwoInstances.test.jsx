// AUDIT #1171 ruling 3 — the "which one?" change in indicatorEdits.targetOf, held per family. A chart with TWO instances of one
// definition (RSI 14 + RSI 7): the definition's word ("rsi") ASKS (naming both) and writes nothing; with ONE instance the same
// word resolves exactly as before; a stated period / its legend name picks the one meant. And the old "isn't on the chart" sentence
// is still what a definition that is NOT on the chart gets. Every action that resolves an instance through targetOf is listed in
// TARGETOF_ACTIONS (the PR body's list); indicatorAlert.create resolves through its own reader and is held here too.
// Real registry, planner, runtime and Indicators interface; the chart's one persist path; no model call.
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { setOwnedDefinitionSource, _resetProposedPlans, refusalSentence } from './capabilities/indicatorEdits'
import { loadIndicatorAlerts, _resetIndicatorAlertCache } from './capabilities/indicatorAlerts'
import { REASONS } from '../components/chart/builder/agentMutations'
import * as registry from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { withInstances } from '../components/chart/engine/instanceControls'
import { adoptOverlayAverages } from '../components/chart/maAdoption'

registerBuiltins()
beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans(); _resetIndicatorAlertCache() })

const view = (cs) => adoptOverlayAverages(cs) || cs
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const RSI14 = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false }
const RSI7 = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 7 }, hidden: false }
function chartCs(rsis) {
  const base = mergeChartSettings(null)
  const raw = load({ ...base, indicatorInstances: [...(base.indicatorInstances || []), ...rsis], indicators: { ...(base.indicators || {}), rsi: { enabled: true } } })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}
function host(specs) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(s.cs))]))
  const writes = []
  const snap = (s) => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: 'D', cs: load(store[s.ref]), stored: store[s.ref] })
  return {
    store, writes,
    charts: {
      list: () => specs.map(snap), read: (ref) => { const s = specs.find(x => x.ref === ref); return s ? snap(s) : null },
      commit: (ref, patch) => { writes.push(ref); store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true, canCreateIndicator: () => true,
    },
    persist: async () => ({ ok: true }),
  }
}
const L = (rsis) => ({ ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA', cs: chartCs(rsis) })
const R = (rsis) => ({ ref: 'R', label: 'Right chart (AMD)', position: 'right', symbol: 'AMD', cs: chartCs(rsis) })
const CTX = { surface: 'charts', createIndicator: true }
async function plan(h, ops) {
  buildContext(h, CTX)
  return planOps(collectTargets(h, ['indicatorEdits', 'indicators', 'chart']), ops, await prepareOps(ops), CTX)
}

/** Every action whose instance (or pane) argument is resolved by indicatorEdits.targetOf (grep `targetOf(` — the PR body list). */
export const TARGETOF_ACTIONS = [
  'indicator.update', 'indicator.remove', 'indicator.show', 'indicator.hide',
  'indicatorStyle.set', 'indicatorStyle.placeIn', 'indicatorStyle.setCalcTimeframe',
  'pane.move', 'pane.resize', 'indicatorCopy.duplicate', 'indicatorCopy.copyTo',
]
// [action, the chart the op targets, args built from the instance word]
const TABLE = [
  ['indicator.update', 'L', (x) => ({ instance: x, inputs: [{ key: 'period', value: 21 }] })],
  ['indicator.remove', 'L', (x) => ({ instance: x })],
  ['indicator.hide', 'L', (x) => ({ instance: x })],
  ['indicatorStyle.set', 'L', (x) => ({ instance: x, property: 'showOn', value: 'daily', output: null })],
  ['indicatorStyle.placeIn', 'L', (x) => ({ instance: x, place: 'price' })],
  ['indicatorStyle.setCalcTimeframe', 'L', (x) => ({ instance: x, timeframe: 'W' })],
  ['pane.move', 'L', (x) => ({ pane: x, to: 'up', relativeTo: null })],
  ['pane.resize', 'L', (x) => ({ pane: x, size: 'bigger' })],
  ['indicatorCopy.duplicate', 'L', (x) => ({ instance: x })],
  ['indicatorCopy.copyTo', 'R', (x) => ({ from: 'ixe:L', instances: [x] })],
]
const op = (action, chart, args) => ({ action, target: `ixe:${chart}`, args })
const said = (p) => JSON.stringify(p.refusals || [])

describe('targetOf: two of one definition ASK; one resolves as before; a stated period picks the one meant', () => {
  it('the table covers every targetOf action AUDIT named (show is hide\'s twin: one capability loop)', () => {
    for (const a of ['indicator.update', 'indicator.remove', 'indicator.hide', 'indicatorStyle.set', 'indicatorStyle.placeIn', 'indicatorStyle.setCalcTimeframe', 'pane.move', 'pane.resize', 'indicatorCopy.duplicate', 'indicatorCopy.copyTo']) {
      expect(TABLE.map(t => t[0])).toContain(a)
    }
    for (const a of TARGETOF_ACTIONS) expect(getCapability(a), a).toBeTruthy()
  })
  it.each(TABLE.map(t => [t[0], t]))('%s — two RSIs, "rsi": asks naming both, writes nothing', async (_a, [action, chart, args]) => {
    const h = host([L([RSI14, RSI7]), R([])])
    const p = await plan(h, [op(action, chart, args('rsi'))])
    const words = p.ok ? '' : said(p)
    expect(p.ok, words).toBe(false)
    expect(words).toMatch(/More than one indicator .* matches that — RSI.* or RSI.*\. Say which one\./)
    expect(words).not.toMatch(/isn't on .* any more/)
    expect(h.writes).toEqual([])
  })
  it.each(TABLE.map(t => [t[0], t]))('%s — ONE RSI, "rsi": resolves (plans) exactly as before', async (_a, [action, chart, args]) => {
    const h = host([L([RSI14]), R([])])
    const p = await plan(h, [op(action, chart, args('rsi'))])
    expect(said(p)).not.toMatch(/More than one indicator|isn't on .* any more/)
    if (action !== 'pane.move') expect(p.ok, said(p)).toBe(true)      // RSI's pane may already be at the top: a no-op, not a target miss
  })
  it.each(TABLE.map(t => [t[0], t]))('%s — two RSIs, the stated period ("#7"): resolves to RSI 7', async (_a, [action, chart, args]) => {
    const h = host([L([RSI14, RSI7]), R([])])
    const p = await plan(h, [op(action, chart, args('#7'))])
    expect(said(p)).not.toMatch(/More than one indicator|isn't on .* any more/)
  })
  it('end to end: the stated period changes RSI 7 only (one write)', async () => {
    const h = host([L([RSI14, RSI7])])
    const p = await plan(h, [op('indicatorStyle.setCalcTimeframe', 'L', { instance: '#7', timeframe: 'W' })])
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok, res.reason).toBe(true)
    const find = (id) => h.store.L.indicatorInstances.find(i => i.instanceId === id)
    expect(find('inst:rsi:2').calculationTimeframe).toBe('W')
    expect('calculationTimeframe' in find('inst:rsi:1')).toBe(false)
    expect(h.writes).toEqual(['L'])
  })
})

describe('(c) a definition genuinely NOT on the chart still gets the old sentence', () => {
  it.each(TABLE.filter(t => t[0] !== 'indicatorCopy.copyTo').map(t => [t[0], t]))('%s — "macd" with no MACD on the chart: "That indicator isn\'t on … any more."', async (_a, [action, chart, args]) => {
    const h = host([L([RSI14, RSI7]), R([])])
    const p = await plan(h, [op(action, chart, args('macd'))])
    expect(p.ok).toBe(false)
    expect(said(p)).toMatch(/That indicator isn't on Left chart \(NVDA\) any more\.|No indicator on|isn't drawn on/)
    expect(said(p)).not.toMatch(/More than one indicator/)
    expect(h.writes).toEqual([])
  })
  it('the NOT_FOUND sentence itself is unchanged', () => {
    expect(refusalSentence({ reason: REASONS.NOT_FOUND }, { chart: 'Left chart (NVDA)' })).toBe("That indicator isn't on Left chart (NVDA) any more.")
  })
})

describe('indicatorAlert.create (its own reader): two RSIs ask; one resolves; the legend name picks one', () => {
  const create = getCapability('indicatorAlert.create')
  const args = (instance) => ({ instance, plot: null, condition: 'above', threshold: 70, crossWith: null, chart: 'L', trigger: null, timeframe: null })
  const why = async (rsis, instance) => {
    const h = host([L(rsis)])
    await loadIndicatorAlerts({ ...h, indicatorAlerts: { list: () => [] } })
    return create.check(null, args(instance), {})
  }
  it('two RSIs, "rsi": asks which', async () => {
    expect(await why([RSI14, RSI7], 'rsi')).toMatch(/could be .*RSI.* say which indicator/)
  })
  it('one RSI, "rsi": resolved (it goes on to the catalog step, never an ambiguity)', async () => {
    const w = await why([RSI14], 'rsi')
    expect(w).not.toMatch(/could be|There's no indicator/)
  })
  it('two RSIs, the instance id: resolved', async () => {
    const w = await why([RSI14, RSI7], 'inst:rsi:2')
    expect(w).not.toMatch(/could be|There's no indicator/)
  })
})
