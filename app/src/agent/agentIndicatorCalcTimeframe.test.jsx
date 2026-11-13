// calc-TF family — "show a weekly RSI on this daily chart", "make the 50 SMA use the weekly", "put RSI back to the chart's
// timeframe": indicatorStyle.setCalcTimeframe, the Agent half of Indicators' `setCalculationTimeframe` (the Inspector's
// "Timeframe" select). Through the real registry, planner, runtime, the chart's ONE persist path and the read-back.
// Proves: one write of one leaf; the chart's own timeframe never moves; every refusal is the product's own reason; no-op is
// honest; exact Undo (CHART = the absent key); stale Undo refused; targeting (two RSIs, every chart); and the terminology
// split (calc vs show-on vs the chart's timeframe), including an unclear "put the RSI on weekly" that ASKS.
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { selectGroups, wordsSelect } from './routing'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { calcTimeframeOfWords } from './capabilities/indicatorControls'
import { loadIndicatorAlerts, _resetIndicatorAlertCache } from './capabilities/indicatorAlerts'
import { pendingLine } from './proposalWording'
import * as registry from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { withInstances, setInstanceCalculationTimeframe } from '../components/chart/engine/instanceControls'
import { CAPABILITY_WORDS } from '../components/chart/engine/calcTimeframeCapability'
import { adoptOverlayAverages } from '../components/chart/maAdoption'

registerBuiltins()
beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans(); _resetIndicatorAlertCache(); try { localStorage.clear() } catch { /* */ } })

const ACTION = 'indicatorStyle.setCalcTimeframe'
const view = (cs) => adoptOverlayAverages(cs) || cs
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
function chartCs(extra = []) {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema' }, hidden: false },
      { instanceId: 'inst:vwap:1', defId: 'vwap', inputs: {}, hidden: false },
      ...extra,
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true } },
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}
/** A host with the chart's ONE persist path; `tfMoves` simulates a writer that moved the CHART's timeframe instead. */
function host(specs, { lostWrite = false, tfMoves = false } = {}) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(s.cs))]))
  const tf = Object.fromEntries(specs.map(s => [s.ref, s.tf || 'D']))
  const writes = []
  const snap = (s) => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: tf[s.ref], cs: load(store[s.ref]), stored: store[s.ref] })
  const h = {
    store, tf, writes,
    charts: {
      list: () => specs.map(snap),
      read: (ref) => { const s = specs.find(x => x.ref === ref); return s ? snap(s) : null },
      commit: (ref, patch) => { writes.push([ref, patch]); if (!lostWrite) store[ref] = JSON.parse(JSON.stringify(patch.settings)); if (tfMoves) tf[ref] = 'W'; return true },
      canManageIndicators: () => true,
      canCreateIndicator: () => true,
    },
    persist: async () => ({ ok: true }),
  }
  return h
}
const L = (cs = chartCs(), tf = 'D') => ({ ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA', cs, tf })
const R = (cs = chartCs(), tf = 'D') => ({ ref: 'R', label: 'Right chart (AAPL)', position: 'right', symbol: 'AAPL', cs, tf })
const CTX = { surface: 'charts', createIndicator: true }
const op = (chart, instance, timeframe) => ({ action: ACTION, target: `ixe:${chart}`, args: { instance, timeframe } })
const calcOf = (h, ref, id) => (h.store[ref]?.indicatorInstances || []).find(i => i.instanceId === id)?.calculationTimeframe
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

describe('C1 / C8 — a weekly RSI on a daily chart: one write, one leaf, the chart stays daily', () => {
  it('stores calculationTimeframe W on THAT instance only; the receipt is from the read-back; Undo puts CHART back (absent key)', async () => {
    const before = chartCs()
    const h = host([L(before)])
    const { p, res } = await run(h, [op('L', 'inst:rsi:1', 'weekly')])
    expect(pendingLine(p.lines[0])).toMatch(/^Calculate RSI/)
    expect(res.ok, res.reason).toBe(true)
    expect(res.lines[0]).toMatch(/^Calculated RSI.* on Left chart \(NVDA\) on weekly bars \(was the chart's own timeframe\) — the chart itself stays on Daily\.$/)
    expect(h.writes.length).toBe(1)
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBe('W')
    expect(h.tf.L).toBe('D')
    const others = (cs) => load(cs).indicatorInstances.filter(i => i.instanceId !== 'inst:rsi:1')
    expect(others(h.store.L)).toEqual(others(before))
    expect('visibility' in h.store.L.indicatorInstances.find(i => i.instanceId === 'inst:rsi:1')).toBe(false)
    const u = await undoEntry(h, res.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(u.lines[0]).toMatch(/^Put RSI.* back on its previous calculation timeframe\.$/)
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBeUndefined()
    expect(load(h.store.L).indicatorInstances).toEqual(load(before).indicatorInstances)
  })
  it('the 50 SMA uses the weekly (the adopted classic average)', async () => {
    const h = host([L()])
    const sma = load(h.store.L).indicatorInstances.find(i => i.defId === 'movingAverage' && i.inputs?.period === 50)
    const { res } = await run(h, [op('L', '#50:sma', 'W')])
    expect(res.ok, res.reason).toBe(true)
    expect(calcOf(h, 'L', sma.instanceId)).toBe('W')
  })
  it('⛔ a write that does not land is not done (no Undo); a chart timeframe that moved is not done either', async () => {
    const lost = host([L()], { lostWrite: true })
    const a = await run(lost, [op('L', 'inst:rsi:1', 'W')])
    expect(a.res.ok).toBe(false)
    expect(a.res.undo || null).toBeNull()
    const moved = host([L()], { tfMoves: true })
    const b = await run(moved, [op('L', 'inst:rsi:1', 'W')])
    expect(b.res.ok, JSON.stringify(b.res)).toBe(false)
    expect(JSON.stringify(b.res)).toMatch(/did not land/)
  })
})

describe('C3 — back to the chart\'s own timeframe', () => {
  it('removes the key with exact Undo; already CHART is an honest no-op with no write and no Undo', async () => {
    const h = host([L(load(setInstanceCalculationTimeframe(chartCs(), 'inst:rsi:1', 'W', registry)))])
    const { res } = await run(h, [op('L', 'inst:rsi:1', 'the chart\'s timeframe')])
    expect(res.lines[0]).toMatch(/^Calculated RSI.* on the chart's own timeframe again \(was weekly bars\)\.$/)
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBeUndefined()
    const u = await undoEntry(h, res.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBe('W')
    const n = h.writes.length
    const again = await plan(h, [op('L', 'inst:rsi:1', 'weekly')])
    expect(again.changed).toBe(false)
    expect(again.noops[0]).toMatch(/already calculated on weekly bars/)
    const h2 = host([L()])
    const none = await plan(h2, [op('L', 'inst:rsi:1', 'chart')])
    expect(none.changed).toBe(false)
    expect(none.noops[0]).toMatch(/already calculated on the chart's own timeframe/)
    expect(h.writes.length).toBe(n)
    expect(h2.writes.length).toBe(0)
  })
})

describe('C2 / C4 — refusals in the product\'s own words; never coerced, never "done", never "already"', () => {
  const refused = async (h, ops) => { const p = await plan(h, ops); expect(p.ok).toBe(false); expect(h.writes.length).toBe(0); return p.refusals.map(r => r.reason || r.message || r).join(' ') }
  it('a session indicator (VWAP): CAPABILITY_WORDS.session', async () => {
    const why = await refused(host([L()]), [op('L', 'inst:vwap:1', 'W')])
    expect(why).toContain(CAPABILITY_WORDS.session.replace(/\.$/, ''))
    expect(why).not.toMatch(/already|Calculated/)
  })
  it('an indicator reading another (EMA of RSI): it inherits its source\'s frame', async () => {
    const why = await refused(host([L()]), [op('L', 'inst:movingAverage:9', 'W')])
    expect(why).toMatch(/same timeframe as its source/)
  })
  it('a LOWER frame than the chart: the select\'s own note', async () => {
    const why = await refused(host([L()]), [op('L', 'inst:rsi:1', '5 minute')])
    expect(why).toMatch(/A 5m calculation can't be shown on a 1D chart/)
  })
  it.each(['4 hour', 'quarterly', '13 minute', '2 days'])('an unsupported frame "%s" asks with the real choices, never coerced', async (tf) => {
    const why = await refused(host([L()]), [op('L', 'inst:rsi:1', tf)])
    expect(why).toMatch(/1-minute, 5-minute, 15-minute, 30-minute, 1-hour, daily, weekly or monthly bars, or on the chart's own timeframe/)
    expect(calcTimeframeOfWords(tf)).toEqual({ unknown: true })
  })
})

describe('C5 — targeting', () => {
  const two = () => chartCs([{ instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 7 }, hidden: false }])
  it('two RSIs: "rsi" asks which; the named one changes and only it', async () => {
    const h = host([L(two())])
    const p = await plan(h, [op('L', 'rsi', 'W')])
    expect(p.ok).toBe(false)
    expect(JSON.stringify(p.refusals), JSON.stringify(p.refusals)).toMatch(/More than one indicator|Say which/)
    expect(JSON.stringify(p.refusals)).toMatch(/RSI.*RSI/)
    // by its stated period ("the 7 RSI" → #7)
    const { res } = await run(h, [op('L', '#7', 'W')])
    expect(res.ok).toBe(true)
    expect(calcOf(h, 'L', 'inst:rsi:2')).toBe('W')
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBeUndefined()
  })
  it('every chart: one op per chart, each its own read-back', async () => {
    const h = host([L(), R()])
    // useAgent runs a fanOut capability once per chart, each its own plan / persist / read-back / Undo
    for (const c of ['L', 'R']) { const { res } = await run(h, [op(c, 'inst:rsi:1', 'W')]); expect(res.ok, res.reason).toBe(true) }
    expect(h.writes.map(w => w[0])).toEqual(['L', 'R'])
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBe('W')
    expect(calcOf(h, 'R', 'inst:rsi:1')).toBe('W')
  })
  it('the capability fans out (every / except rules are the shared fan-out ones)', () => {
    expect(getCapability(ACTION).fanOut).toBe(true)
    expect(getCapability(ACTION).target).toBe('indicatorEdits')
  })
})

describe('C7 — stale Undo and alerts', () => {
  it('Undo after the member changed the frame by hand is refused, never clobbering it', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('L', 'inst:rsi:1', 'W')])
    h.store.L = JSON.parse(JSON.stringify(setInstanceCalculationTimeframe(load(h.store.L), 'inst:rsi:1', 'M', registry)))
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(calcOf(h, 'L', 'inst:rsi:1')).toBe('M')
  })
  it('an ACTIVE alert armed from that RSI on daily bars: the receipt says it now watches a different line (the alert is untouched)', async () => {
    await loadIndicatorAlerts({ indicatorAlerts: { list: () => [{ id: 1, sym: 'NVDA', indicator: 'rsi', tf: 'D', active: true, instance_id: 'inst:rsi:1' }] } })
    const h = host([L()])
    const { res } = await run(h, [op('L', 'inst:rsi:1', 'W')])
    expect(res.ok).toBe(true)
    expect(res.lines.join(' ')).toMatch(/your alert on RSI.* still runs on daily bars, so it now watches a different line than the chart draws — the alert was not changed/)
  })
})

describe('C6 — calc vs show-on vs the chart\'s timeframe: none steals another', () => {
  const action = (m) => { const r = fastParse(m); return r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0].action : r?.kind || null }
  it.each([
    ['calculate the rsi on weekly', ACTION], ['compute the 50 sma on weekly', ACTION], ['make the rsi use daily bars', ACTION],
    ['make the 50 sma use the weekly', ACTION], ['put rsi back to the chart\'s timeframe', ACTION], ['reset the rsi timeframe', ACTION],
    ['switch the chart to weekly', 'chart.setTimeframe'], ['switch to daily', 'chart.setTimeframe'], ['weekly', 'chart.setTimeframe'],
  ])('"%s" → %s', (m, want) => { expect(action(m)).toBe(want) })
  it('the calc phrases carry the right args', () => {
    expect(fastParse('calculate the rsi on weekly').ops[0].args).toEqual({ instance: 'rsi', timeframe: 'weekly' })
    expect(fastParse('compute the 50 sma on weekly').ops[0].args).toEqual({ instance: '#50:sma', timeframe: 'weekly' })
    expect(fastParse('put rsi back to the chart\'s timeframe').ops[0].args).toEqual({ instance: 'rsi', timeframe: 'chart' })
  })
  it('"only show it on weekly" is the visibility op (showOn), never the calc op', () => {
    for (const m of ['show rsi only on weekly charts', 'only show it on the daily']) {
      const r = fastParse(m)
      expect(r?.kind === 'ops' ? r.ops.map(o => o.action) : []).not.toContain(ACTION)
      expect(wordsSelect('indicatorSetup', m)).toBe(true)
    }
  })
  it('an unclear "put the RSI on weekly" ASKS in fixed words — no op, no model guess', () => {
    for (const m of ['put the rsi on weekly', 'make the rsi weekly', 'set rsi to daily']) {
      const r = fastParse(m)
      expect(r?.kind, m).toBe('say')
      expect(r.text).toMatch(/calculated on (weekly|daily) bars on this chart .* shown only on (weekly|daily) charts, or the chart itself switched/)
      expect(r.text).toMatch(/Nothing was changed\.$/)
    }
    // inside a longer request it is not answered here (the model sees the whole message)
    expect(fastParse('put the rsi on weekly and add macd')?.kind).not.toBe('say')
  })
  it('routing: calc phrasings select indicatorSetup; plain chart-timeframe phrasings do not', () => {
    for (const m of ['show a weekly rsi on this daily chart', 'make the 50 sma use the weekly', 'calculate rsi on the weekly', 'put rsi back to the chart\'s timeframe', 'have the macd use weekly bars'])
      expect(selectGroups(m).selected, m).toContain('indicatorSetup')
    for (const m of ['switch the chart to weekly', 'switch to daily', 'weekly', 'show me the daily chart', 'go to the monthly'])
      expect(wordsSelect('indicatorSetup', m), m).toBe(false)
  })
})
