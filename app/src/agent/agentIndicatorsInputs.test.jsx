// INDICATORS PHASE 2.5 — Agent side of the parameterised add (docs/indicators/agent-seams-2026-10-11.md §1,
// docs/agent/handoffs/INDICATORS-HANDOFF.md §1). "Add a 20 EMA" through the Agent's own fast path,
// planner, runtime and Undo, onto the REAL Indicators interface (`agentMutations` add with `inputs`,
// the settings dialog's own `checkInstanceInput`) and the REAL registry. The host is the chart's one
// persist path (a JSON round trip), as in agentIndicatorsM2.test.jsx.
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, manifestFor, shapeError } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import {
  setOwnedDefinitionSource, _resetProposedPlans, refusalSentence, addableRows, settingsOfWords, inputsOfArgs,
} from './capabilities/indicatorEdits'
import * as registry from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { addInstance, setInstanceInput } from '../components/chart/engine/instanceControls'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { REASONS } from '../components/chart/builder/agentMutations'

registerBuiltins()
beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans(); try { localStorage.clear() } catch { /* */ } })

const view = (cs) => adoptOverlayAverages(cs) || cs
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const chartCs = () => load(mergeChartSettings(null))
function host(cs) {
  const store = { L: JSON.parse(JSON.stringify(cs)) }
  const writes = []
  const snap = () => ({ ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA', tf: 'D', cs: load(store.L), stored: store.L })
  return {
    store, writes,
    charts: {
      list: () => [snap()],
      read: (ref) => (ref === 'L' ? snap() : null),
      commit: (ref, patch) => { writes.push([ref, patch]); store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true,
      canCreateIndicator: () => true,
      openCreateIndicator: () => ({ ok: true }),
    },
    persist: async () => ({ ok: true }),
  }
}
const CTX = { surface: 'charts', createIndicator: true }
const op = (action, args) => ({ action, target: 'ixe:L', args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return planOps(collectTargets(h, ['indicatorEdits', 'indicators', 'chart']), ops, env, CTX)
}
async function run(h, ops) {
  const p = await plan(h, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { p, res: await commitPlan(h, p, { env: {}, ctx: CTX }) }
}
const added = (before, after, defId) => {
  const had = new Set((before.indicatorInstances || []).map(i => i.instanceId))
  return (load(after).indicatorInstances || []).filter(i => i.defId === defId && !had.has(i.instanceId) && !i.deleted)
}
const fast = (text) => {
  const f = fastParse(text, { host: host(chartCs()) })
  return f && f.kind === 'ops' && f.ops.length === 1 ? f.ops[0] : null
}

describe('⭐ the brief\'s sentences, through the fast path (no model call)', () => {
  const cases = [
    ['Add a 20 EMA.', 'indicator.add', { defId: 'movingAverage', inputs: [{ key: 'period', value: 20 }, { key: 'maType', value: 'ema' }] }],
    ['Add RSI with length 7.', 'indicator.add', { defId: 'rsi', inputs: [{ key: 'period', value: 7 }] }],
    ['Add a 200-period simple moving average.', 'indicator.add', { defId: 'movingAverage', inputs: [{ key: 'period', value: 200 }, { key: 'maType', value: 'sma' }] }],
    ['Add VWAP.', 'indicator.add', { defId: 'vwap', inputs: null }],
    ['Remove RSI.', 'indicator.remove', { instance: 'rsi' }],
    ['add rsi 7', 'indicator.add', { defId: 'rsi', inputs: [{ key: 'period', value: 7 }] }],
    ['put a 50-day moving average on my chart', 'indicator.add', { defId: 'movingAverage', inputs: [{ key: 'period', value: 50 }, { key: 'maType', value: 'sma' }] }],   // Gate C: owner MA default (SMA for 50+),
    ['add ema 9', 'indicator.add', { defId: 'movingAverage', inputs: [{ key: 'period', value: 9 }, { key: 'maType', value: 'ema' }] }],
    ['add MACD', 'indicator.add', { defId: 'macd', inputs: null }],
  ]
  for (const [text, action, args] of cases) {
    it(text, () => {
      const o = fast(text)
      expect(o, text).toBeTruthy()
      expect(o.action).toBe(action)
      expect(o.args).toEqual(args)
      // the fast path's args pass the same shape gate a model's would
      expect(shapeError(o.action, o.args, CTX)).toBeNull()
    })
  }
  it('anything it cannot map onto ONE declared key goes to the model, never a guess', () => {
    // MACD has three lengths, none called `period`; Bollinger by a near-name; a type that is not an MA option
    expect(settingsOfWords('macd 8')).toBeNull()
    expect(settingsOfWords('20 bollinger')).toBeNull()
    expect(settingsOfWords('20 zlema')).toBeNull()
    expect(fast('add macd 8 21 5')).toBeNull()
  })
  it('two settings requests in one sentence are two adds, each with its own settings', () => {
    const f = fastParse('add a 20 ema and a 50 sma', { host: host(chartCs()) })
    expect(f.ops.map(o => o.args)).toEqual([
      { defId: 'movingAverage', inputs: [{ key: 'period', value: 20 }, { key: 'maType', value: 'ema' }] },
      { defId: 'movingAverage', inputs: [{ key: 'period', value: 50 }, { key: 'maType', value: 'sma' }] },
    ])
  })
})

describe('⭐ add with settings — planned, applied, read back, receipted, undone', () => {
  it('"Add a 20 EMA": the stored instance carries period 20 + EMA, equal to the settings dialog\'s own writes', async () => {
    const before = chartCs()
    const h = host(before)
    const { p, res } = await run(h, [{ ...fast('Add a 20 EMA'), target: 'ixe:L' }])
    expect(p.lines[0]).toMatch(/20/)
    expect(p.lines[0]).toMatch(/EMA/)
    expect(res.ok).toBe(true)
    const [inst] = added(before, h.store.L, 'movingAverage')
    expect(inst.inputs).toMatchObject({ period: 20, maType: 'ema' })
    // the receipt states the settings AS STORED
    expect(res.lines[0]).toMatch(/^Added .*20.* on Left chart \(NVDA\) — .*period 20.*EMA.*\.$/)
    // byte-equal to Add to Chart + the settings dialog
    let ui = addInstance(view(before), 'movingAverage', registry)
    const id = added(before, ui, 'movingAverage')[0].instanceId
    ui = setInstanceInput(ui, id, 'period', 20, registry)
    ui = setInstanceInput(ui, id, 'maType', 'ema', registry)
    expect(load(h.store.L).indicatorInstances.find(i => i.instanceId === inst.instanceId).inputs)
      .toEqual(load(JSON.parse(JSON.stringify(ui))).indicatorInstances.find(i => i.instanceId === id).inputs)
    // one Undo removes the whole configured add
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(true)
    expect(added(before, h.store.L, 'movingAverage')).toEqual([])
  })

  it('a model-planned add with string values ("7") stores the coerced number', async () => {
    const before = chartCs()
    const h = host(before)
    const { res } = await run(h, [op('indicator.add', { defId: 'rsi', inputs: [{ key: 'period', value: '7' }] })])
    expect(res.ok).toBe(true)
    expect(added(before, h.store.L, 'rsi')[0].inputs.period).toBe(7)
    expect(res.lines[0]).toMatch(/period 7/)
  })

  it('"Add RSI" (no settings) is unchanged: defaults, no settings in the receipt', async () => {
    const before = chartCs()
    const h = host(before)
    const { res } = await run(h, [{ ...fast('Add RSI'), target: 'ixe:L' }])
    expect(res.ok).toBe(true)
    expect(added(before, h.store.L, 'rsi')[0].inputs.period).toBe(14)
    expect(res.lines[0]).toMatch(/^Added .* on Left chart \(NVDA\)\.$/)
  })
})

describe('⛔ a setting that is not allowed: refused by name, nothing written, nothing created', () => {
  const bad = [
    ['an out-of-range length (RSI 0)', { defId: 'rsi', inputs: [{ key: 'period', value: 0 }] }, /period/i, /from 2 to 100/],
    ['past the maximum (EMA 900)', { defId: 'movingAverage', inputs: [{ key: 'period', value: 900 }, { key: 'maType', value: 'ema' }] }, /period/i, /from 1 to 500/],
    ['a fraction where a whole number is declared', { defId: 'rsi', inputs: [{ key: 'period', value: 7.5 }] }, /whole number/, null],
    ['a setting the indicator does not have', { defId: 'rsi', inputs: [{ key: 'length', value: 7 }] }, /no setting "length"/, null],
    ['a type the indicator does not offer', { defId: 'movingAverage', inputs: [{ key: 'maType', value: 'zlema' }] }, /maType/, /SMA, EMA/],
    ['the same setting twice', { defId: 'rsi', inputs: [{ key: 'period', value: 7 }, { key: 'period', value: 9 }] }, /given twice/, null],
  ]
  for (const [name, args, why, allowed] of bad) {
    it(name, async () => {
      const before = chartCs()
      const h = host(before)
      const p = await plan(h, [op('indicator.add', args)])
      expect(p.ok).toBe(false)
      const reason = p.refusals.map(r => r.reason).join(" ")
      expect(reason).toMatch(why)
      if (allowed) expect(reason).toMatch(allowed)
      expect(reason).toMatch(/Nothing was changed/)
      expect(h.writes).toEqual([])
      expect(h.store.L).toEqual(JSON.parse(JSON.stringify(before)))
    })
  }
  it('the fast path\'s "EMA 900" reaches the same refusal (deterministic, no model)', async () => {
    const h = host(chartCs())
    const p = await plan(h, [{ ...fast('add a 900 ema'), target: 'ixe:L' }])
    expect(p.ok).toBe(false)
    expect(JSON.stringify(p.refusals)).toMatch(/from 1 to 500/)
    expect(h.writes).toEqual([])
  })
  it('the refusal sentence carries the declared range or options', () => {
    expect(refusalSentence({ reason: REASONS.BAD_INPUT, detail: { why: 'x', input: { key: 'period', label: 'Period', type: 'int', min: 1, max: 500 } } }))
      .toBe('I didn\'t add it: x. Period takes a whole number from 1 to 500. Nothing was changed.')
  })
})

describe('⭐ the wire and the catalog', () => {
  it('indicator.add declares inputs as a closed, nullable list of {key, value}', () => {
    const cap = manifestFor(CTX).find(c => c.name === 'indicator.add')
    expect(cap.args.required.sort()).toEqual(['defId', 'inputs'])
    expect(cap.args.properties.inputs.type).toEqual(['array', 'null'])
    expect(cap.args.properties.inputs.items.required.sort()).toEqual(['key', 'value'])
    expect(cap.hints.length).toBeLessThanOrEqual(1000)
    expect(shapeError('indicator.add', { defId: 'rsi', inputs: null }, CTX)).toBeNull()
    expect(shapeError('indicator.add', { defId: 'rsi', inputs: { period: 7 } }, CTX)).toMatch(/wrong kind/)
  })
  it('the catalog the model reads states each indicator\'s settable inputs off its definition', () => {
    const ma = addableRows().find(r => r.defId === 'movingAverage')
    expect(ma.settings).toMatch(/period int 1-500 \(5\)/)
    expect(ma.settings).toMatch(/maType sma\|ema\|/)
    // colours and sources are not offered
    expect(ma.settings).not.toMatch(/source|color/i)
    expect(addableRows().find(r => r.defId === 'obv').settings).toBeUndefined()
    expect(JSON.stringify(addableRows()).length).toBeLessThan(12000)
  })
  it('inputsOfArgs: null and [] are the defaults; a non-list is refused', () => {
    expect(inputsOfArgs(null)).toEqual({ ok: true, inputs: undefined })
    expect(inputsOfArgs([])).toEqual({ ok: true, inputs: undefined })
    expect(inputsOfArgs({ period: 7 }).ok).toBe(false)
  })
})
