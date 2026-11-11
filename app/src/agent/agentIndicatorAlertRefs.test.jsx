// LT-13 (live 2026-11-03): "mark when the 9 ema crosses above the 20 on this chart" → "Add an indicator alert" refused
// with "There's no indicator 'EMA 9'…" although EMA 9 and EMA 20 were on the chart: the model named the indicator,
// not its id. indicatorAlert.create now reads a HUMAN reference ("EMA 9", "9 ema", "the 20", "RSI") as the chart's
// own instance — deterministically, exactly one match — and asks when several match. Nothing else about the alert
// changes: a reference posts byte-for-byte what the instance's id posts.
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

// the served catalog's shapes (indicator_alert_evaluator.alert_catalog): rsi, macd; NO moving-average entry (as served)
const OSC = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const MACDC = [...OSC, { value: 'cross_zero', label: 'Crosses zero line', needs_threshold: false }]
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 } }] },
  { indicator: 'macd', label: 'MACD', conditions: MACDC, default_threshold: null, plots: [
    { value: 'macd', label: 'MACD line', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 } },
    { value: 'macd.signal', label: 'MACD signal', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 } },
  ] },
]

function server() {
  const st = { rows: [], calls: [], seq: 100 }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  st.handle = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    st.calls.push([m, u, body])
    if (u === `${ROUTE}/catalog`) return json({ catalog: CATALOG, refusals: [] })
    if (u === ROUTE && m === 'GET') return json({ alerts: st.rows })
    if (u === ROUTE && m === 'POST') {
      const row = { id: ++st.seq, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
        params_json: body.params ?? null, active: true, instance_id: body.instance_id ?? null, scope: null, state: 'armed' }
      st.rows.push(row)
      return json({ id: row.id })
    }
    return json({}, 404)
  }
  return st
}
let srv
// a real chart blob: the shipped default averages (cs.overlays → adopted EMA 9 / EMA 20 / SMA 50 / SMA 200) + RSI + MACD
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 } }
const MACD = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }
const chartCs = (extra = []) => ({ overlays: JSON.parse(JSON.stringify(CHART_DEFAULTS.overlays)), indicatorInstances: [RSI, MACD, ...extra] })
const NVDA = (cs = chartCs()) => [{ ref: 'c', label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs }]
function host(charts = NVDA()) {
  return { charts: { list: () => charts, read: (ref) => charts.find(c => c.ref === ref) || null }, indicatorAlerts: buildIndicatorAlertSource() }
}
const op = (args) => ({ action: 'indicatorAlert.create', target: 'indicatorAlerts', args })
async function plan(h, args) {
  buildContext(h, CTX)
  await loadIndicatorAlerts(h, { force: true })
  const env = await prepareOps([op(args)])
  return { p: planOps(collectTargets(h, ['indicatorAlertLibrary', 'indicatorAlert']), [op(args)], env, CTX), env }
}
const refusal = async (h, args) => (await plan(h, args)).p.refusals[0]?.reason || null
const posts = () => srv.calls.filter(c => c[0] === 'POST' && c[1] === ROUTE).map(c => c[2])
async function posted(h, args) {
  const { p, env } = await plan(h, args)
  expect(p.ok).toBe(true)
  expect((await commitPlan(h, p, { env })).ok).toBe(true)
  return posts()
}
const fresh = () => { srv = server(); _resetIndicatorAlertCache() }

beforeEach(() => {
  fresh()
  globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : Promise.resolve(new Response('{}', { status: 200 }))))
})
afterEach(() => { vi.restoreAllMocks() })

describe('LT-13 — indicatorAlert.create resolves a human indicator reference to the chart\'s own instance', () => {
  it('the real chart shapes: the default averages are adopted instances named "EMA 9", "EMA 20", "SMA 50", "SMA 200"', () => {
    const names = indicatorsOn(chartCs()).filter(i => !i.setting).map(i => i.name)
    expect(names).toEqual(expect.arrayContaining(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200', 'RSI (7)', 'MACD']))
  })

  it('a reference posts EXACTLY what the instance id posts (the id is the only thing resolved)', async () => {
    const byId = await posted(host(), { instance: 'inst:rsi:1', plot: null, condition: 'cross_above', threshold: 70 })
    expect(byId).toEqual([{ sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', tf: 'D', params: { period: 7 }, instance_id: 'inst:rsi:1', threshold: 70 }])
    for (const ref of ['RSI', 'rsi 7', 'the RSI', 'RSI (7)', '7 rsi', 'rsi7']) {
      fresh()
      expect(await posted(host(), { instance: ref, plot: null, condition: 'cross_above', threshold: 70 }), ref).toEqual(byId)
    }
    fresh()
    expect(await posted(host(), { instance: 'MACD', plot: 'macd.signal', condition: 'cross_zero', threshold: null }))
      .toEqual([{ sym: 'NVDA', indicator: 'macd.signal', condition: 'cross_zero', tf: 'D', params: { fast: 12, slow: 26, signal: 9 }, instance_id: 'inst:macd:1' }])
  })

  it('the LT-13 sentence: "EMA 9" / "9 ema" / "ema9" / "the 20" ARE found on the chart, and refused honestly: UCT\'s alert catalog has no moving-average alert', async () => {
    for (const ref of ['EMA 9', '9 ema', 'ema9', 'the 9 ema', 'the 20', 'EMA 20', '9-period EMA']) {
      const why = await refusal(host(), { instance: ref, plot: null, condition: 'cross_above', threshold: 20 })
      expect(why, ref).toMatch(/^Alerts aren't available for EMA (9|20) — UCT's alert catalog doesn't offer it/)
    }
    expect(posts()).toEqual([])
  })

  it('ambiguous references are asked, never picked', async () => {
    const sma20 = { instanceId: 'inst:ma:20', defId: 'movingAverage', inputs: { period: 20, maType: 'sma' } }
    expect(await refusal(host(NVDA(chartCs([sma20]))), { instance: 'the 20', plot: null, condition: 'above', threshold: 1 }))
      .toBe('“the 20” could be EMA 20 or SMA 20 on your chart — say which indicator the alert is for.')
    expect(await refusal(host(), { instance: 'ema', plot: null, condition: 'above', threshold: 1 }))
      .toBe('“ema” could be EMA 9 or EMA 20 on your chart — say which indicator the alert is for.')
    const rsi2 = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 7 } }
    expect(await refusal(host(NVDA(chartCs([rsi2]))), { instance: 'RSI', plot: null, condition: 'above', threshold: 70 }))
      .toBe('“RSI” could be more than one RSI (7) on your chart — say which indicator the alert is for.')
    // the same reference on two charts with different symbols: the existing "which chart" question
    const two = [...NVDA(), { ref: 'b', label: 'Chart (AMD)', symbol: 'AMD', tf: 'D', cs: chartCs() }]
    expect(await refusal(host(two), { instance: 'RSI', plot: null, condition: 'above', threshold: 70 })).toMatch(/on 2 charts with different symbols — say which chart/)
    expect(posts()).toEqual([])
  })

  it('absent references keep the explicit refusal (nothing is guessed, nothing is posted)', async () => {
    for (const ref of ['EMA 50', 'the 13', 'stochastic', 'inst:nope', 'volume', 'bollinger', 'the']) {
      expect(await refusal(host(), { instance: ref, plot: null, condition: 'above', threshold: 1 }), ref)
        .toBe(`There's no indicator “${ref}” on your charts — use an id from the indicators entry, or add the indicator to a chart first.`)
    }
    expect(posts()).toEqual([])
  })
})
