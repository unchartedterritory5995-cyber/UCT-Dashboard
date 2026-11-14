// indicatorAlert.create — "Only on this chart" (the Indicator Alerts popover's own checkbox, Phase C Task 12) as an optional
// `chartOnly` arg. What it IS, from the code: the popover sends `scope: <chartId>` only when the box is ticked (omitted =
// GLOBAL, `_clean_scope` stores NULL); `chartId` is ChartWidget's `paneChartId` — the widget id, `${widgetId}:${tabId}` for
// an extra chart tab — or a Multi Chart cell's id (components/chart/alertScope.js, now ONE definition). Server-side the scope
// is a DISPLAY filter (`GET ?scope=` = global + that chart): the evaluator is scope-blind, so the alert notifies like any
// other. The Agent sends the popover's shape, READS BACK the stored scope, and never claims one the server did not keep.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildIndicatorAlertSource, alertScopeOfRef } from './host'
import { _resetIndicatorAlertCache, loadIndicatorAlerts, SCOPE_NOT_KEPT } from './capabilities/indicatorAlerts'
import { alertScopeId } from '../components/chart/alertScope'
import { setupPanel, ONE, TWO } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const ROUTE = '/api/indicator-alerts'
const OSC = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const CATALOG = [{ indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] }]
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }

// the router's own shapes (indicator_alerts.py): POST stores body.scope as given (blank = NULL), GET returns every row
function server({ dropScope = false, forceScope = null } = {}) {
  const st = { rows: [], calls: [], seq: 100 }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  st.handle = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    st.calls.push([m, u, body])
    if (u === `${ROUTE}/catalog`) return json({ catalog: CATALOG, refusals: [] })
    if (u === ROUTE && m === 'GET') return json({ alerts: st.rows })
    if (u === ROUTE && m === 'POST') {
      const scope = forceScope ?? (dropScope ? null : (String(body.scope ?? '').trim() || null))
      const row = { id: ++st.seq, user_id: 1, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
        params_json: body.params ?? null, active: true, instance_id: body.instance_id ?? null, scope, state: 'armed', created_at: 1 }
      st.rows.push(row)
      return json({ id: row.id })
    }
    const d = /^\/api\/indicator-alerts\/(\d+)$/.exec(u)
    if (d && m === 'DELETE') { st.rows = st.rows.filter(x => x.id !== Number(d[1])); return json({ ok: true }) }
    return json({}, 404)
  }
  return st
}
let srv
const chart = (ref, symbol, extra = {}) => ({ ref, label: `Chart (${symbol})`, symbol, tf: 'D', cs: { indicatorInstances: [RSI] }, ...extra })
function host(charts = [chart('w1', 'NVDA')]) {
  return { charts: { list: () => charts, read: (ref) => charts.find(c => c.ref === ref) || null }, indicatorAlerts: buildIndicatorAlertSource() }
}
const create = (args) => ({ action: 'indicatorAlert.create', target: 'indicatorAlerts', args: { instance: 'inst:rsi:1', plot: null, condition: 'cross_above', threshold: 70, crossWith: null, chart: null, trigger: null, timeframe: null, chartOnly: null, ...args } })
async function plan(h, ops) {
  buildContext(h, CTX)
  await loadIndicatorAlerts(h, { force: true })
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['indicatorAlertLibrary', 'indicatorAlert']), ops, env, CTX), env }
}
const posts = () => srv.calls.filter(c => c[0] === 'POST' && c[1] === ROUTE).map(c => c[2])

beforeEach(() => {
  srv = server()
  _resetIndicatorAlertCache()
  globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('chartOnly: the popover\'s own `scope`, read back; default unchanged', () => {
  it('chartOnly true, one chart: POST carries scope = the chart\'s id; the receipt says only on that chart; Undo deletes exactly it', async () => {
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: true })])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Indicator alert: NVDA RSI .* crosses above 70 on the D chart — only on Chart \(NVDA\) \(listed in that chart's alerts; it notifies you like any alert\)/)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(posts()).toHaveLength(1)
    expect(posts()[0].scope).toBe('w1')
    expect(srv.rows.map(r => r.scope)).toEqual(['w1'])
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(true)
    expect(srv.rows).toEqual([])
    expect(srv.calls.filter(c => c[0] === 'DELETE')).toHaveLength(1)
  })
  it.each([[null], [false]])('chartOnly %s: byte-for-byte the global alert — no `scope` key, no "only on" words', async (v) => {
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: v })])
    expect(p.lines[0]).not.toMatch(/only on/)
    await commitPlan(h, p, { env })
    expect('scope' in posts()[0]).toBe(false)
    expect(srv.rows[0].scope).toBe(null)
  })
  it('an arg shape from before chartOnly existed (key left out) validates and stays global', async () => {
    const { chartOnly: _c, ...old } = create({}).args
    const h = host()
    const { p, env } = await plan(h, [{ action: 'indicatorAlert.create', target: 'indicatorAlerts', args: old }])
    expect(p.ok).toBe(true)
    await commitPlan(h, p, { env })
    expect('scope' in posts()[0]).toBe(false)
  })
  it('a chart TAB: the scope is `${widgetId}:${tabId}` — the id ChartWidget hands the popover for that tab', async () => {
    const h = host([chart('w1', 'NVDA'), chart('w2~t9', 'AMD', { cs: { indicatorInstances: [{ ...RSI, instanceId: 'inst:rsi:2' }] } })])
    const { p, env } = await plan(h, [create({ instance: 'inst:rsi:2', chartOnly: true })])
    expect(p.lines[0]).toMatch(/only on Chart \(AMD\)/)
    await commitPlan(h, p, { env })
    expect(posts()[0].scope).toBe('w2:t9')
  })
})

describe('targeting: exactly one chart — named, the only one with it, or the clicked one; else ask', () => {
  const two = (sel = null) => host([chart('w1', 'NVDA', sel === 'w1' ? { selected: true } : {}), chart('w2', 'NVDA', sel === 'w2' ? { selected: true } : {})])
  it('the same RSI on two charts, none named or clicked: asks which chart, nothing POSTed', async () => {
    const h = two()
    const { p } = await plan(h, [create({ chartOnly: true })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/That indicator is on 2 charts — which chart should this alert be listed on\? .* Nothing was created\./)
    expect(posts()).toEqual([])
  })
  it('the clicked chart ("this chart") decides; the named chart ("that chart" → its ref) decides', async () => {
    const a = two('w2')
    const r1 = await plan(a, [create({ chartOnly: true })])
    await commitPlan(a, r1.p, { env: r1.env })
    expect(posts().at(-1).scope).toBe('w2')
    srv = server()
    _resetIndicatorAlertCache()
    const b = two('w2')
    const r2 = await plan(b, [create({ chartOnly: true, chart: 'w1' })])
    await commitPlan(b, r2.p, { env: r2.env })
    expect(posts().at(-1).scope).toBe('w1')
  })
  it('a global alert on two same-symbol charts still needs no chart (unchanged)', async () => {
    const { p } = await plan(two(), [create({})])
    expect(p.ok).toBe(true)
  })
  it('alertScopeOfRef = alertScopeId: board chart, chart tab, grid cell', () => {
    expect(alertScopeOfRef('w1')).toBe(alertScopeId('w1')); expect(alertScopeOfRef('w1')).toBe('w1')
    expect(alertScopeOfRef('w1~t2')).toBe(alertScopeId('w1', 't2')); expect(alertScopeOfRef('w1~t2')).toBe('w1:t2')
    expect(alertScopeOfRef('cell-3')).toBe('cell-3')
    expect(alertScopeOfRef('')).toBe(null)
  })
  it('ChartWidget hands the popover alertScopeId — one definition (source rail)', () => {
    const src = readFileSync(resolve(__dirname, '../pages/charts/widgets/ChartWidget.jsx'), 'utf8')
    expect(src).toMatch(/const paneChartId = alertScopeId\(chartId, isMainTab \|\| !activeExtra \? null : activeExtra\.id\)/)
    expect(src).not.toMatch(/`\$\{chartId\}:\$\{activeExtra\.id\}`/)
  })
})

describe('honest: never claimed unless the server keeps it; never overwrites', () => {
  it('the server stores it GLOBAL (scope dropped): not a receipt — the created alert is taken back, no Undo, said plainly', async () => {
    srv = server({ dropScope: true })
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: true })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.undo ?? null).toBe(null)
    expect(JSON.stringify(res)).toContain('saved that alert for every chart')
    expect(srv.rows).toEqual([])                                               // compensated: deleted what it created
    expect(SCOPE_NOT_KEPT).toMatch(/nothing was created/)
  })
  it('the server stores a DIFFERENT chart\'s scope: refused the same way', async () => {
    srv = server({ forceScope: 'w9' })
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: true })])
    expect((await commitPlan(h, p, { env })).ok).toBe(false)
    expect(srv.rows).toEqual([])
  })
  it('a global request the server stored WITH a scope: refused too (the scope is never invented or ignored)', async () => {
    srv = server({ forceScope: 'w1' })
    const h = host()
    const { p, env } = await plan(h, [create({})])
    expect((await commitPlan(h, p, { env })).ok).toBe(false)
    expect(srv.rows).toEqual([])
  })
  it('an identical active alert already exists (global or chart-only): refused as a duplicate — no POST, nothing deleted or changed', async () => {
    for (const scope of [null, 'w1']) {
      srv = server()
      _resetIndicatorAlertCache()
      srv.rows.push({ id: 7, user_id: 1, sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'D', params_json: { period: 14 }, active: true, instance_id: 'inst:rsi:1', scope, state: 'armed', created_at: 1 })
      const before = JSON.stringify(srv.rows)
      const { p } = await plan(host(), [create({ chartOnly: true })])
      expect(p.ok).toBe(false)
      expect(p.refusals[0].reason).toMatch(/already have an active alert/)
      expect(posts()).toEqual([])
      expect(srv.calls.filter(c => c[0] === 'DELETE')).toEqual([])
      expect(JSON.stringify(srv.rows)).toBe(before)
    }
  })
  it('create is POST-only: no PUT / PATCH ever reaches the alert routes', async () => {
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: true })])
    const res = await commitPlan(h, p, { env })
    await undoEntry(h, res.undo)
    expect(srv.calls.filter(c => !['GET', 'POST', 'DELETE'].includes(c[0]))).toEqual([])
  })
})

describe('through the REAL AgentPanel: a card, Apply, the stored scope, Undo', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  const mountWith = (board) => {
    const base = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : base(url, init)))
    const [widgets, syms] = board
    const m = p.mount(widgets.map(w => ({ ...w, opts: { settings: { indicatorInstances: [RSI] } } })), syms)
    m.h.indicatorAlerts = buildIndicatorAlertSource()
    return m
  }
  it.each([
    'alert me when RSI crosses 70 on this chart only',
    'set an RSI cross above 70 alert just for this chart',
    'only on this chart: tell me when the RSI crosses above 70',
  ])('"%s" → one card naming the chart → Apply → stored with this chart\'s scope → undo removes it', async (say0) => {
    const { say, click } = mountWith(ONE('NVDA'))
    p.st.envelopes.push(p.env('propose', [create({ chartOnly: true })]))
    const card = await say(say0)
    expect(card).toMatch(/only on Chart \(NVDA\)/)
    expect(srv.rows).toEqual([])
    await click('Apply')
    expect(srv.rows.map(r => r.scope)).toEqual(['c'])
    expect(screen.getByTestId('agent-transcript').textContent).toMatch(/only on Chart \(NVDA\)/)
    await say('undo')
    expect(srv.rows).toEqual([])
  }, 40000)
  it('"alert me when RSI crosses 70" (no scope words, chartOnly null): the global alert, as before', async () => {
    const { say, click } = mountWith(ONE('NVDA'))
    p.st.envelopes.push(p.env('propose', [create({})]))
    const card = await say('alert me when RSI crosses 70')
    expect(card).not.toMatch(/only on/)
    await click('Apply')
    expect(srv.rows.map(r => r.scope)).toEqual([null])
  }, 40000)
  it('two charts, "on that chart only" with the model naming the right chart: that chart\'s scope', async () => {
    const { say, click } = mountWith(TWO('NVDA', 'AMD'))
    p.st.envelopes.push(p.env('propose', [create({ chartOnly: true, chart: 'cr' })]))
    const card = await say('alert me when RSI crosses 70 on the AMD chart only')
    expect(card).toMatch(/AMD RSI .* only on/)
    await click('Apply')
    expect(srv.rows.map(r => [r.sym, r.scope])).toEqual([['AMD', 'cr']])
  }, 40000)
  it('two charts with the same RSI, none clicked, "this chart only": asked which chart, nothing created', async () => {
    const { say } = mountWith(TWO('NVDA', 'NVDA'))
    p.st.envelopes.push(p.env('propose', [create({ chartOnly: true })]))
    const out = await say('alert me when RSI crosses 70 on this chart only')
    expect(out).toMatch(/which chart should this alert be listed on/)
    expect(srv.calls.filter(c => c[0] === 'POST')).toEqual([])
  }, 40000)
})

describe('landed (the runtime\'s own read-back) compares the stored scope too', () => {
  it('a row with the right alert but the wrong scope is not landed; the right scope is', async () => {
    const { indicatorAlertLibraryKind: kind } = await import('./capabilities/indicatorAlerts')
    const c = { sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'D', params: { period: 14 }, scope: 'w1' }
    const row = (scope) => ({ id: '1', sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'D', params: { period: 14 }, active: true, scope })
    expect(kind.landed({ alerts: [row(null)] }, { create: [c] })).toBe(false)
    expect(kind.landed({ alerts: [row('w2')] }, { create: [c] })).toBe(false)
    expect(kind.landed({ alerts: [row('w1')] }, { create: [c] })).toBe(true)
    expect(kind.landed({ alerts: [row(null)] }, { create: [{ ...c, scope: undefined }] })).toBe(true)
  })
})

// AUDIT #1263 item 2: the DEFAULT path (no chartOnly) sends the POST body master sent, byte for byte. The bodies below were
// RECORDED by running exactly these asks through master c2a8e1773f's indicatorAlerts.js (__fixtures__/indicatorAlertMasterBodies.json,
// captured with CAPTURE_MASTER_BODIES=<file> on that file); this branch must build the identical JSON text.
import MASTER_BODIES from './__fixtures__/indicatorAlertMasterBodies.json'
const MACD = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }
const MACDC = [{ value: 'cross_above', label: 'Crosses above level', needs_threshold: true }, { value: 'cross_zero', label: 'Crosses zero line', needs_threshold: false }]
const DEFAULT_ASKS = {
  'rsi above 70': { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70 },
  'rsi cross above 30 weekly': { instance: 'inst:rsi:1', plot: null, condition: 'cross_above', threshold: 30, timeframe: 'W' },
  'macd signal crosses zero': { instance: 'inst:macd:1', plot: 'macd.signal', condition: 'cross_zero', threshold: null },
}
describe('the default path: the POST body is byte-identical to master\'s', () => {
  it.each(Object.keys(DEFAULT_ASKS))('"%s"', async (name) => {
    CATALOG.push({ indicator: 'macd', label: 'MACD', conditions: MACDC, default_threshold: null, plots: [
      { value: 'macd', label: 'MACD line', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD' },
      { value: 'macd.signal', label: 'MACD signal', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD' }] })
    try {
      const h = host([chart('w1', 'NVDA', { cs: { indicatorInstances: [RSI, MACD] } })])
      const args = DEFAULT_ASKS[name]
      const { p, env } = await plan(h, [{ action: 'indicatorAlert.create', target: 'indicatorAlerts', args }])
      expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
      await commitPlan(h, p, { env })
      const sent = srv.calls.filter(c => c[0] === 'POST' && c[1] === ROUTE).map(c => c[2])
      expect(sent).toHaveLength(1)
      const out = globalThis.process?.env?.CAPTURE_MASTER_BODIES
      if (out) {
        const fs = await import('node:fs')
        const have = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {}
        fs.writeFileSync(out, JSON.stringify({ ...have, [name]: JSON.stringify(sent[0]) }, null, 1) + '\n')
        return
      }
      expect(JSON.stringify(sent[0])).toBe(MASTER_BODIES[name])
    } finally { CATALOG.splice(1) }
  })
})

// AUDIT #1263 item 1: the read-back mismatch is cleaned up by the EXACT id the POST returned, and the reply is true
describe('mismatch cleanup: exact id, and an honest reply when the cleanup itself fails', () => {
  const lookalike = { id: 7, user_id: 1, sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'D', params_json: { period: 14 }, active: false, instance_id: 'inst:rsi:1', scope: 'w2', state: 'armed', created_at: 1 }
  it('an identical-looking alert already listed on another chart survives; only the new id is deleted', async () => {
    srv = server({ dropScope: true })
    srv.rows.push({ ...lookalike })
    const h = host([chart('w1', 'NVDA'), chart('w2', 'NVDA')])
    const { p, env } = await plan(h, [create({ chartOnly: true, chart: 'w1' })])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    const newId = srv.seq
    expect(srv.calls.filter(c => c[0] === 'DELETE').map(c => c[1])).toEqual([`${ROUTE}/${newId}`])
    expect(srv.rows).toEqual([lookalike])
    expect(JSON.stringify(res)).toMatch(/nothing was created/)
  })
  it('the DELETE fails: the reply says an alert WAS created, how it is listed, and names it — never "nothing was created"', async () => {
    srv = server({ dropScope: true })
    const handle = srv.handle
    srv.handle = async (url, init = {}) => ((init.method || '').toUpperCase() === 'DELETE' ? (srv.calls.push(['DELETE', String(url), null]), new Response('{"detail":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } })) : handle(url, init))
    const h = host()
    const { p, env } = await plan(h, [create({ chartOnly: true })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.undo ?? null).toBe(null)
    const said = JSON.stringify(res)
    expect(said).toMatch(/An alert WAS created, but not as asked \(only on Chart \(NVDA\)\), and I couldn't take it back: NVDA RSI .*\(listed on every chart\)\. It is in your Indicator Alerts/)
    expect(said).not.toMatch(/nothing was created|Nothing was created|nothing was left changed/)
    expect(srv.rows).toHaveLength(1)
  })
})
