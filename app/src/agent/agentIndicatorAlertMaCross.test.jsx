// 2026-11-04 — moving-average crossover alerts through the EXISTING indicatorAlert.create.
// The canonical engine serves `ma_cross` in alert_catalog() (api/services/indicator_alert_evaluator.py; shape pinned
// by tests/test_alert_ma_cross.py::test_ma_cross_is_a_catalog_entry_with_its_params_and_two_crossings). The Agent
// builds the canonical body from the chart's OWN two averages: {indicator: 'ma_cross', condition, params: {ma_type,
// fast, slow, direction, confirm: 'close'}} — no threshold, no second path. docs/alerts/MA-CROSS-DESIGN.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { buildIndicatorAlertSource } from './host'
import { _resetIndicatorAlertCache, loadIndicatorAlerts } from './capabilities/indicatorAlerts'
import { indicatorsOn } from './capabilities/indicators'
import { CHART_DEFAULTS } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const ROUTE = '/api/indicator-alerts'

const OSC = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const CROSS = [
  { value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false },
  { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false },
]
// the served shapes: rsi, price_vs_ma (no definition), and the new ma_cross entry exactly as alert_catalog() serves it
const MA_CROSS = {
  indicator: 'ma_cross', label: 'MA Cross', conditions: CROSS, default_threshold: null, plots: [{
    value: 'ma_cross', label: 'MA Cross', conditions: CROSS, default_threshold: null, inputs: { ma_type: 'ema', fast: 9, slow: 20 },
    instance_label: 'EMA(9) vs EMA(20)', input_options: { ma_type: ['ema', 'sma'] }, instance_defs: ['movingAverage'],
  }],
}
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 } }] },
  { indicator: 'price_vs_ma', label: 'Price vs MA', conditions: OSC.slice(0, 2), default_threshold: null, plots: [{ value: 'price_vs_ma', label: 'Price vs MA', conditions: OSC.slice(0, 2), default_threshold: null, inputs: { period: 50, type: 'sma' } }] },
  MA_CROSS,
]

function server(catalog = CATALOG) {
  const st = { rows: [], calls: [], seq: 100 }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  st.handle = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    st.calls.push([m, u, body])
    if (u === `${ROUTE}/catalog`) return json({ catalog, refusals: [] })
    if (u === ROUTE && m === 'GET') return json({ alerts: st.rows })
    if (u === ROUTE && m === 'POST') {
      // the server stores params as a JSON STRING (params_json) — the Agent must read it back either way
      const row = { id: ++st.seq, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
        params_json: body.params ? JSON.stringify(body.params) : null, active: true, instance_id: body.instance_id ?? null, scope: null, state: 'armed' }
      st.rows.push(row)
      return json({ id: row.id })
    }
    const del = u.match(/\/api\/indicator-alerts\/(\d+)$/)
    if (del && m === 'DELETE') { st.rows = st.rows.filter(r => String(r.id) !== del[1]); return json({ ok: true }) }
    const tog = u.match(/\/api\/indicator-alerts\/(\d+)\/toggle$/)
    if (tog && m === 'POST') { const r = st.rows.find(x => String(x.id) === tog[1]); if (r) r.active = !r.active; return json({ ok: true, active: r?.active }) }
    return json({}, 404)
  }
  return st
}
let srv
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 } }
// a real chart blob: the shipped default averages (cs.overlays → adopted EMA 9 / EMA 20 / SMA 50 / SMA 200) + RSI
const chartCs = (extra = []) => ({ overlays: JSON.parse(JSON.stringify(CHART_DEFAULTS.overlays)), indicatorInstances: [RSI, ...extra] })
const NVDA = (cs = chartCs()) => [{ ref: 'c', label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs }]
function host(charts = NVDA()) {
  return { charts: { list: () => charts, read: (ref) => charts.find(c => c.ref === ref) || null }, indicatorAlerts: buildIndicatorAlertSource() }
}
/** The id of the chart's own average named `name` ("EMA 9") — the id the indicators entry hands the model. */
const idOf = (name, cs = chartCs()) => {
  const inst = indicatorsOn(cs).find(i => i.name === name)
  if (!inst) throw new Error(`no ${name} on the test chart`)
  return inst.instanceId
}
const op = (args) => ({ action: 'indicatorAlert.create', target: 'indicatorAlerts', args })
async function plan(h, args) {
  buildContext(h, CTX)
  await loadIndicatorAlerts(h, { force: true })
  const env = await prepareOps([op(args)])
  return { p: planOps(collectTargets(h, ['indicatorAlertLibrary', 'indicatorAlert']), [op(args)], env, CTX), env }
}
const refusal = async (h, args) => (await plan(h, args)).p.refusals?.[0]?.reason || null
const posts = () => srv.calls.filter(c => c[0] === 'POST' && c[1] === ROUTE).map(c => c[2])
async function posted(h, args) {
  const { p, env } = await plan(h, args)
  expect(p.refusals || []).toEqual([])
  expect(p.ok).toBe(true)
  expect((await commitPlan(h, p, { env })).ok).toBe(true)
  return posts()
}
const fresh = (catalog) => { srv = server(catalog); _resetIndicatorAlertCache() }

beforeEach(() => {
  fresh()
  globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : Promise.resolve(new Response('{}', { status: 200 }))))
})
afterEach(() => { vi.restoreAllMocks() })

describe('MA cross — "alert me when the 9 ema crosses above the 20 on this chart"', () => {
  it('the chart\'s own averages are the movingAverage instances the catalog entry declares', () => {
    const avgs = indicatorsOn(chartCs()).filter(i => i.defId === 'movingAverage').map(i => [i.name, i.inputs.period, i.inputs.maType])
    expect(avgs).toEqual(expect.arrayContaining([['EMA 9', 9, 'ema'], ['EMA 20', 20, 'ema'], ['SMA 50', 50, 'sma'], ['SMA 200', 200, 'sma']]))
  })

  it('produces the CANONICAL body: ma_cross, cross_above, {ema, 9, 20, above, close}, no threshold, the EMA 9 instance', async () => {
    expect(await posted(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: idOf('EMA 20') }))
      .toEqual([{ sym: 'NVDA', indicator: 'ma_cross', condition: 'cross_above', tf: 'D',
        params: { ma_type: 'ema', fast: 9, slow: 20, direction: 'above', confirm: 'close' }, instance_id: idOf('EMA 9') }])
  })

  it('plot "ma_cross" named explicitly posts the same body', async () => {
    const a = await posted(host(), { instance: idOf('EMA 9'), plot: 'ma_cross', condition: 'cross_above', threshold: null, crossWith: idOf('EMA 20') })
    expect(a[0].params).toEqual({ ma_type: 'ema', fast: 9, slow: 20, direction: 'above', confirm: 'close' })
  })

  it('the slower line crossing is stored fast-vs-slow: "the 200 crosses below the 50" = SMA 50 crosses ABOVE SMA 200', async () => {
    expect(await posted(host(), { instance: idOf('SMA 200'), plot: null, condition: 'cross_below', threshold: null, crossWith: idOf('SMA 50') }))
      .toEqual([{ sym: 'NVDA', indicator: 'ma_cross', condition: 'cross_above', tf: 'D',
        params: { ma_type: 'sma', fast: 50, slow: 200, direction: 'above', confirm: 'close' }, instance_id: idOf('SMA 50') }])
  })

  it('a stray threshold is dropped (the zero is declared server-side)', async () => {
    const a = await posted(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_below', threshold: 20, crossWith: idOf('EMA 20') })
    expect(a[0]).not.toHaveProperty('threshold')
    expect(a[0].condition).toBe('cross_below')
    expect(a[0].params.direction).toBe('below')
  })

  it('refuses honestly, and posts nothing', async () => {
    const r = async (args) => refusal(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: null, ...args })
    expect(await r({})).toMatch(/^Which average should EMA 9 cross/)
    expect(await r({ crossWith: idOf('SMA 50') })).toMatch(/different kinds of average/)
    expect(await r({ crossWith: idOf('EMA 9') })).toMatch(/two different moving averages/)
    expect(await r({ crossWith: 'inst:rsi:1' })).toMatch(/isn't a moving average/)
    expect(await r({ crossWith: 'inst:nope' })).toMatch(/There's no indicator “inst:nope”/)
    expect(await r({ condition: 'above' })).toMatch(/can alert on cross_above .* not “above”/)
    const ema9b = { instanceId: 'inst:ma:9b', defId: 'movingAverage', inputs: { period: 9, maType: 'ema', source: 'close' } }
    expect(await refusal(host(NVDA(chartCs([ema9b]))), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:ma:9b' }))
      .toMatch(/same period, so they can't cross/)
    const wma = { instanceId: 'inst:ma:w', defId: 'movingAverage', inputs: { period: 30, maType: 'wma', source: 'close' } }
    expect(await refusal(host(NVDA(chartCs([wma]))), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:ma:w' }))
      .toMatch(/EMA and SMA averages only|different kinds of average/)
    const onRsi = { instanceId: 'inst:ma:r', defId: 'movingAverage', inputs: { period: 30, maType: 'ema', source: 'rsi:inst:rsi:1' } }
    expect(await refusal(host(NVDA(chartCs([onRsi]))), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:ma:r' }))
      .toMatch(/averages of the close/)
    // a line drawn with an OFFSET crosses on a different bar than the alert judges: refused
    const shifted = { instanceId: 'inst:ma:s', defId: 'movingAverage', inputs: { period: 30, maType: 'ema', source: 'close' }, presentation: { offset: 3 } }
    expect(await refusal(host(NVDA(chartCs([shifted]))), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:ma:s' }))
      .toMatch(/is drawn with an offset/)
    const zero = { ...shifted, instanceId: 'inst:ma:z', presentation: { offset: 0 } }
    expect(await refusal(host(NVDA(chartCs([zero]))), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:ma:z' }))
      .toBeNull()
    // two charts: the averages must be on the SAME one
    const amd = { ref: 'b', label: 'Chart (AMD)', symbol: 'AMD', tf: 'D', cs: { overlays: [], indicatorInstances: [{ instanceId: 'inst:amd:ema50', defId: 'movingAverage', inputs: { period: 50, maType: 'ema', source: 'close' } }] } }
    expect(await refusal(host([...NVDA(), amd]), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: 'inst:amd:ema50' }))
      .toMatch(/same chart/)
    // crossWith on a one-line alert is a mistake, said so
    expect(await refusal(host(), { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70, crossWith: idOf('EMA 20') }))
      .toMatch(/only for a moving-average cross/)
    expect(posts()).toEqual([])
  })

  it('an arg shape from before crossWith (key absent) still validates for every other alert', async () => {
    expect(await posted(host(), { instance: 'inst:rsi:1', plot: null, condition: 'cross_above', threshold: 70 }))
      .toEqual([{ sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', tf: 'D', params: { period: 7 }, instance_id: 'inst:rsi:1', threshold: 70 }])
  })

  it('a catalog WITHOUT ma_cross keeps the old honest refusal for an average', async () => {
    fresh(CATALOG.slice(0, 2))
    expect(await refusal(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: idOf('EMA 20') }))
      .toMatch(/^Alerts aren't available for EMA 9/)
  })

  it('duplicates are per PAIR: EMA 9/20 and SMA 50/200 above are two alerts; the same pair twice is refused', async () => {
    await posted(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: idOf('EMA 20') })
    await posted(host(), { instance: idOf('SMA 50'), plot: null, condition: 'cross_above', threshold: null, crossWith: idOf('SMA 200') })
    expect(posts().length).toBe(2)
    expect(await refusal(host(), { instance: idOf('EMA 20'), plot: null, condition: 'cross_below', threshold: null, crossWith: idOf('EMA 9') }))
      .toMatch(/already have an active alert for NVDA EMA 9 \/ EMA 20/)
  })
})

describe('MA cross — managed through the existing pause / resume / delete', () => {
  async function created() {
    await posted(host(), { instance: idOf('EMA 9'), plot: null, condition: 'cross_above', threshold: null, crossWith: idOf('EMA 20') })
    return String(srv.rows[0].id)
  }
  it('the alert reads as its pair in the Agent\'s alert list', async () => {
    await created()
    const h = host()
    buildContext(h, CTX)
    await loadIndicatorAlerts(h, { force: true })
    const ctx = buildContext(h, { ...CTX, message: 'my alerts' })
    const list = JSON.stringify(ctx)
    expect(list).toMatch(/EMA 9 \/ EMA 20/)
  })
  it('pause, resume and delete go through the hook\'s own routes', async () => {
    const id = await created()
    const h = host()
    buildContext(h, CTX)
    await loadIndicatorAlerts(h, { force: true })
    const ref = id                         // an indicatorAlert target is the alert's own id
    const toggle = async (active) => {
      const ops = [{ action: 'indicatorAlert.toggle', target: ref, args: { active } }]
      const env = await prepareOps(ops)
      const p = planOps(collectTargets(h, ['indicatorAlertLibrary', 'indicatorAlert']), ops, env, CTX)
      expect(p.ok).toBe(true)
      expect((await commitPlan(h, p, { env })).ok).toBe(true)
    }
    await toggle(false)
    expect(srv.rows[0].active).toBe(false)
    await toggle(true)
    expect(srv.rows[0].active).toBe(true)
    const ops = [{ action: 'indicatorAlert.delete', target: ref, args: {} }]
    const env = await prepareOps(ops)
    const p = planOps(collectTargets(h, ['indicatorAlertLibrary', 'indicatorAlert']), ops, env, CTX)
    expect(p.ok).toBe(true)
    expect((await commitPlan(h, p, { env })).ok).toBe(true)
    expect(srv.rows.find(r => String(r.id) === id)).toBeUndefined()
    expect(srv.calls.some(c => c[0] === 'POST' && c[1] === `${ROUTE}/${id}/toggle`)).toBe(true)
    expect(srv.calls.some(c => c[0] === 'DELETE' && c[1] === `${ROUTE}/${id}`)).toBe(true)
  })
})
