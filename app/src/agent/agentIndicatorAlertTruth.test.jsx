// Phase 1 (Charts operator): what the Agent SAYS about indicator alerts is what the alert WILL do. Every case runs the real
// planner and runtime against an in-memory /api/indicator-alerts with the router's own shapes, and asserts the row the server
// ends up holding (or that none was posted), never the sentence. No model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildIndicatorAlertSource } from './host'
import { answerFor } from './discovery'
import { _resetIndicatorAlertCache, loadIndicatorAlerts, indicatorAlertKind } from './capabilities/indicatorAlerts'

registerBuiltins()
const CTX = { surface: 'charts' }
const ROUTE = '/api/indicator-alerts'
const LEVELS = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const plot = (value, label, inputs) => ({ value, label, conditions: LEVELS, default_threshold: null, inputs })
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: LEVELS, plots: [plot('rsi', 'RSI', { period: 14 })] },
  { indicator: 'macd', label: 'MACD', conditions: LEVELS, plots: [plot('macd', 'MACD line', { fast: 12, slow: 26, signal: 9 })] },
  { indicator: 'bb', label: 'BB', conditions: LEVELS, plots: [plot('bb.upper', 'BB upper', { period: 20, stddev: 2 })] },
  { indicator: 'stoch', label: 'Stochastic', conditions: LEVELS, plots: [plot('stoch', 'Stochastic %K', { k_period: 14, d_period: 3 })] },
]
function server() {
  const st = { rows: [], posts: [], seq: 100 }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  st.handle = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    if (u === `${ROUTE}/catalog`) return json({ catalog: CATALOG, refusals: [] })
    if (u === ROUTE && m === 'GET') return json({ alerts: st.rows })
    if (u === ROUTE && m === 'POST') {
      st.posts.push(body)
      const row = { id: ++st.seq, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
        params_json: body.params ?? null, active: true, instance_id: body.instance_id ?? null, scope: null, state: 'armed' }
      st.rows.push(row)
      return json({ id: row.id })
    }
    const t = /^\/api\/indicator-alerts\/(\d+)\/toggle$/.exec(u)
    if (t && m === 'POST') { const r = st.rows.find(x => x.id === Number(t[1])); r.active = !r.active; return json({ active: r.active }) }
    const d = /^\/api\/indicator-alerts\/(\d+)$/.exec(u)
    if (d && m === 'DELETE') { st.rows = st.rows.filter(x => x.id !== Number(d[1])); return json({ ok: true }) }
    return json({}, 404)
  }
  return st
}
let srv
function chartWith(instances, tf = 'D') {
  const c = { ref: 'c', label: 'Chart (NVDA)', symbol: 'NVDA', tf, cs: { indicatorInstances: instances } }
  return { charts: { list: () => [c], read: (ref) => (ref === 'c' ? c : null) }, indicatorAlerts: buildIndicatorAlertSource() }
}
const op = (action, target, args) => ({ action, target, args })
const KINDS = ['indicatorAlertLibrary', 'indicatorAlert']
async function plan(h, ops) {
  buildContext(h, CTX)
  await loadIndicatorAlerts(h, { force: true })
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, KINDS), ops, env, CTX), env }
}
const createArgs = (instance, extra = {}) => ({ instance, plot: null, condition: 'above', threshold: 70, ...extra })
async function create(h, args) {
  const { p, env } = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', args)])
  if (!p.ok) return { refused: p.refusals[0]?.reason }
  return { res: await commitPlan(h, p, { env, ctx: CTX }) }
}

beforeEach(() => { _resetIndicatorAlertCache(); srv = server(); vi.stubGlobal('fetch', vi.fn((u, i) => srv.handle(u, i))) })
afterEach(() => { vi.unstubAllGlobals() })

describe('the planner is told indicator alerts exist', () => {
  it('alert.create sends an indicator alert to indicatorAlert.create, not to "unsupported"', () => {
    const hints = getCapability('alert.create').hints
    expect(hints).toMatch(/indicatorAlert\.create/)
    expect(hints).not.toMatch(/indicator[^.]*disposition unsupported/i)
  })
  it('"what can you do with indicators" no longer lists indicator alerts as a limitation', () => {
    const { text } = answerFor('indicators')
    expect(text).not.toMatch(/indicator alerts \(set them/)
    expect(text).toMatch(/alert on an indicator/)
  })
})

describe('indicatorAlert.toggle really pauses and resumes the alert', () => {
  const seed = () => srv.rows.push({ id: 7, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, state: 'armed' })
  async function pause(h) {
    const { p, env } = await plan(h, [op('indicatorAlert.toggle', '7', { active: false })])
    return commitPlan(h, p, { env, ctx: CTX })
  }
  it('pause turns the server row off and Undo turns it back on', async () => {
    seed()
    const h = chartWith([])
    const res = await pause(h)
    expect(srv.rows[0].active).toBe(false)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(srv.rows[0].active).toBe(true)
  })
  it('asked to resume an alert that is already on, it stays on (the route flips, so a blind toggle would pause it)', async () => {
    seed()
    await indicatorAlertKind.commit(chartWith([]), '7', { toggle: true, to: true, sig: null })
    expect(srv.rows[0].active).toBe(true)
  })
})

describe('an alert is only armed on what the evaluator can truly watch', () => {
  it('a custom timeframe (45m) has no stored bars: refused, and nothing reaches the server', async () => {
    const { refused } = await create(chartWith([{ instanceId: 'r', defId: 'rsi', inputs: { period: 14 } }], '45'), createArgs('r'))
    expect(refused).toMatch(/custom timeframe/)
    expect(srv.posts).toEqual([])
  })
  it('a native timeframe is armed on that timeframe', async () => {
    await create(chartWith([{ instanceId: 'r', defId: 'rsi', inputs: { period: 7 } }], '60'), createArgs('r'))
    expect(srv.rows).toMatchObject([{ indicator: 'rsi', tf: '60', params_json: { period: 7 } }])
  })
  it('a chart MACD 8/21/5 is armed as 8/21/5, not the catalog\'s 12/26/9 (chart keys are fastPeriod…, alert knobs fast…)', async () => {
    await create(chartWith([{ instanceId: 'm', defId: 'macd', inputs: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 } }]), createArgs('m'))
    expect(srv.rows[0].params_json).toEqual({ fast: 8, slow: 21, signal: 5 })
  })
  it('a chart Bollinger 30 / 2.5 is armed with both (stdDev → stddev)', async () => {
    await create(chartWith([{ instanceId: 'b', defId: 'bb', inputs: { period: 30, stdDev: 2.5 } }]), createArgs('b'))
    expect(srv.rows[0].params_json).toEqual({ period: 30, stddev: 2.5 })
  })
  it('a chart Stochastic 21/5 is armed with both (kPeriod → k_period)', async () => {
    await create(chartWith([{ instanceId: 's', defId: 'stoch', inputs: { kPeriod: 21, dPeriod: 5 } }]), createArgs('s', { threshold: 80 }))
    expect(srv.rows[0].params_json).toEqual({ k_period: 21, d_period: 5 })
  })
  it('a slow Stochastic (smoothK 3) has no alert knob: refused rather than armed on the fast line', async () => {
    const { refused } = await create(chartWith([{ instanceId: 's', defId: 'stoch', inputs: { smoothK: 3 } }]), createArgs('s', { threshold: 80 }))
    expect(refused).toMatch(/different line/)
    expect(srv.posts).toEqual([])
  })
  it('an indicator with only paint changed is still armed', async () => {
    await create(chartWith([{ instanceId: 'r', defId: 'rsi', inputs: { period: 14, color: '#112233' } }]), createArgs('r'))
    expect(srv.rows).toHaveLength(1)
  })
  it('an RSI calculated on the weekly, on a daily chart: refused, an alert on D would judge another line', async () => {
    const { refused } = await create(chartWith([{ instanceId: 'r', defId: 'rsi', inputs: {}, calculationTimeframe: 'W' }]), createArgs('r'))
    expect(refused).toMatch(/calculated on/)
    expect(srv.posts).toEqual([])
  })
})
