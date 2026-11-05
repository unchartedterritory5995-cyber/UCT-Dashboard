// W1-B (Wave 1, BOARD B-03; announced to Indicators) — INDICATOR alerts through the product's own writers:
// hooks/useIndicatorAlerts.js createIndicatorAlert / toggleIndicatorAlert / deleteIndicatorAlert (reached through
// host.indicatorAlerts, never called around) over /api/indicator-alerts, the catalog the popover reads, the instance
// from the chart's indicators. Create is proposed and Undo deletes exactly what it made; toggle has an exact Undo;
// delete is permanent. The hook itself is not modified.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, manifestFor, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildIndicatorAlertSource } from './host'
import { routeManifest } from './routing'
import { _resetIndicatorAlertCache, loadIndicatorAlerts } from './capabilities/indicatorAlerts'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const ROUTE = '/api/indicator-alerts'

// ── the catalog as the evaluator serves it (indicator_alert_evaluator.alert_catalog), two indicators ──
const OSC = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const MACDC = [
  { value: 'cross_above', label: 'Crosses above level', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below level', needs_threshold: true },
  { value: 'cross_zero', label: 'Crosses zero line', needs_threshold: false },
]
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] },
  { indicator: 'macd', label: 'MACD', conditions: MACDC, default_threshold: null, plots: [
    { value: 'macd', label: 'MACD line', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD' },
    { value: 'macd.signal', label: 'MACD signal', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD' },
    { value: 'macd.hist', label: 'MACD histogram', conditions: MACDC, default_threshold: null, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD' },
  ] },
]
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 } }
const MACD = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }
const MA = { instanceId: 'inst:ma:1', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' } }

// ── an in-memory /api/indicator-alerts with the router's own shapes (indicator_alerts.py) ──
function server({ catalogFails = false } = {}) {
  const st = { rows: [], calls: [], seq: 100, catalogFails }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  st.handle = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    st.calls.push([m, u, body])
    if (u === `${ROUTE}/catalog`) return st.catalogFails ? json({ detail: 'nope' }, 500) : json({ catalog: CATALOG, refusals: [] })
    if (u === ROUTE && m === 'GET') return json({ alerts: st.rows })
    if (u === ROUTE && m === 'POST') {
      const row = { id: ++st.seq, user_id: 1, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
        params_json: body.params ?? null, active: true, instance_id: body.instance_id ?? null, scope: body.scope ?? null, state: 'armed', created_at: 1 }
      st.rows.push(row)
      return json({ id: row.id })
    }
    const t = /^\/api\/indicator-alerts\/(\d+)\/toggle$/.exec(u)
    if (t && m === 'POST') { const r = st.rows.find(x => x.id === Number(t[1])); if (!r) return json({ detail: 'not found' }, 404); r.active = !r.active; return json(r) }
    const d = /^\/api\/indicator-alerts\/(\d+)$/.exec(u)
    if (d && m === 'DELETE') { st.rows = st.rows.filter(x => x.id !== Number(d[1])); return json({ ok: true }) }
    return json({}, 404)
  }
  return st
}
let srv
function host(instances = [RSI, MACD, MA], { charts = null } = {}) {
  const list = charts || [{ ref: 'c', label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs: { indicatorInstances: instances } }]
  return { charts: { list: () => list, read: (ref) => list.find(c => c.ref === ref) || null }, indicatorAlerts: buildIndicatorAlertSource() }
}
const op = (action, target, args) => ({ action, target, args })
async function plan(h, ops, kinds = ['indicatorAlertLibrary', 'indicatorAlert']) {
  buildContext(h, CTX)
  await loadIndicatorAlerts(h, { force: true })
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, kinds), ops, env, CTX), env }
}
const refuse = async (h, args) => (await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', args)])).p.refusals[0]?.reason
const CREATE = { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70 }

beforeEach(() => {
  srv = server()
  _resetIndicatorAlertCache()
  globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))))
})
afterEach(() => { vi.restoreAllMocks() })

describe('host.indicatorAlerts — the hook\'s own writers, nothing beside them', () => {
  it('create → the hook\'s POST; toggle → its POST /toggle; remove → its DELETE; list / catalog read the hook\'s routes', async () => {
    const src = buildIndicatorAlertSource()
    expect(await src.catalog()).toEqual(CATALOG)
    expect(await src.list()).toEqual([])
    const r = await src.create({ sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', params: { period: 7 }, instance_id: 'inst:rsi:1' })
    expect(r).toEqual({ ok: true, id: 101 })
    expect(srv.calls.find(c => c[0] === 'POST' && c[1] === ROUTE)[2]).toEqual({ sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', params: { period: 7 }, instance_id: 'inst:rsi:1' })
    await src.toggle(101)
    expect((await src.list())[0].active).toBe(false)
    await src.remove(101)
    expect(await src.list()).toEqual([])
    expect(srv.calls.map(c => `${c[0]} ${c[1]}`)).toEqual([`GET ${ROUTE}/catalog`, `GET ${ROUTE}`, `POST ${ROUTE}`, `POST ${ROUTE}/101/toggle`, `GET ${ROUTE}`, `DELETE ${ROUTE}/101`, `GET ${ROUTE}`])
    // the hook's own writers were what ran (each revalidates the listings through swr — no fetch of its own here)
    expect(globalThis.fetch.mock.calls.filter(c => String(c[0]).startsWith(ROUTE) && (c[1]?.method || 'GET') !== 'GET').map(c => c[1].credentials)).toEqual(['include', 'include', 'include'])
  })
})

describe('indicatorAlert.create — the popover\'s own payload from the chart\'s instance and the served catalog', () => {
  it('proposed (confirm); commit posts the same shape as the popover (symbol + timeframe of the chart; params = the instance\'s own inputs, not the catalog defaults; instance_id; no scope); read back; Undo deletes exactly it', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', CREATE)])
    expect(p.ok).toBe(true)
    expect(getCapability('indicatorAlert.create').risk).toBe('confirm')
    expect(p.lines).toEqual(['Indicator alert: NVDA RSI (RSI (7)) above threshold 70 on the D chart — watched with that indicator\'s own settings'])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    const post = srv.calls.find(c => c[0] === 'POST' && c[1] === ROUTE)[2]
    expect(post).toEqual({ sym: 'NVDA', indicator: 'rsi', condition: 'above', tf: 'D', params: { period: 7 }, instance_id: 'inst:rsi:1', threshold: 70 })
    expect(srv.rows.map(r => [r.id, r.active])).toEqual([[101, true]])
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(true)
    expect(srv.rows).toEqual([])
    expect(srv.calls.some(c => c[0] === 'DELETE' && c[1] === `${ROUTE}/101`)).toBe(true)
  })
  it('a multi-line indicator takes the plot the member names; a condition without a level posts no threshold', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', { instance: 'inst:macd:1', plot: 'macd.signal', condition: 'cross_zero', threshold: null })])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Indicator alert: NVDA MACD signal \(MACD\) crosses zero line on the D chart/)
    await commitPlan(h, p, { env })
    const post = srv.calls.find(c => c[0] === 'POST' && c[1] === ROUTE)[2]
    expect(post).toEqual({ sym: 'NVDA', indicator: 'macd.signal', condition: 'cross_zero', tf: 'D', params: { fast: 12, slow: 26, signal: 9 }, instance_id: 'inst:macd:1' })
  })
  it('refusals (nothing is posted): an unknown instance, an indicator the catalog does not offer, a multi-line indicator with no plot, a wrong plot, a wrong condition, a missing level, a duplicate, an unreadable catalog', async () => {
    const h = host()
    expect(await refuse(h, { ...CREATE, instance: 'inst:nope' })).toMatch(/no indicator “inst:nope” on your charts/)
    expect(await refuse(h, { ...CREATE, instance: 'inst:ma:1' })).toMatch(/Alerts aren't available for .* — UCT's alert catalog doesn't offer it/)
    expect(await refuse(h, { ...CREATE, instance: 'inst:macd:1' })).toMatch(/has several lines — which one\? macd \(MACD line\), macd\.signal \(MACD signal\), macd\.hist \(MACD histogram\)/)
    expect(await refuse(h, { ...CREATE, instance: 'inst:macd:1', plot: 'macd.wave' })).toMatch(/has no line “macd\.wave”/)
    expect(await refuse(h, { ...CREATE, condition: 'touch_upper' })).toMatch(/RSI can alert on above \(Above threshold\), .* — not “touch_upper”/)
    expect(await refuse(h, { ...CREATE, threshold: null })).toMatch(/Say the level for “Above threshold” on RSI/)
    srv.rows.push({ id: 7, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, params_json: { period: 7 } })
    expect(await refuse(h, CREATE)).toMatch(/already have an active alert for NVDA RSI above 70 \(D\)/)
    srv.rows = []
    _resetIndicatorAlertCache(); srv.catalogFails = true
    expect(await refuse(h, CREATE)).toMatch(/couldn't read which indicator alerts UCT offers/)
    expect(srv.calls.filter(c => c[0] === 'POST')).toEqual([])
  })
  it('the same instance id on two charts with different symbols is two different alerts — asked, never picked', async () => {
    const h = host(null, { charts: [
      { ref: 'a', label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs: { indicatorInstances: [RSI] } },
      { ref: 'b', label: 'Chart (AMD)', symbol: 'AMD', tf: 'W', cs: { indicatorInstances: [RSI] } },
    ] })
    expect(await refuse(h, CREATE)).toMatch(/on 2 charts with different symbols — say which chart/)
  })
})

describe('indicatorAlert.toggle / indicatorAlert.delete — one alert by id', () => {
  it('toggle pauses (the manager\'s own switch) and Undo resumes; delete is permanent (no Undo offered)', async () => {
    const h = host()
    srv.rows.push({ id: 5, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, params_json: null })
    const { p, env } = await plan(h, [op('indicatorAlert.toggle', '5', { active: false })])
    expect(p.lines).toEqual(['Paused the indicator alert NVDA RSI above 70 (D)'])
    const res = await commitPlan(h, p, { env })
    expect(srv.rows[0].active).toBe(false)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(srv.rows[0].active).toBe(true)
    const same = await plan(h, [op('indicatorAlert.toggle', '5', { active: true })])
    expect(same.p.noops ?? same.p.plans?.[0]?.noops ?? []).toBeTruthy()
    const d = await plan(h, [op('indicatorAlert.delete', '5', {})])
    expect(d.p.lines).toEqual(['Deleted the indicator alert NVDA RSI above 70 (D) (permanent)'])
    expect(getCapability('indicatorAlert.delete').undo).toBe('none')
    await commitPlan(h, d.p, { env: d.env })
    expect(srv.rows).toEqual([])
    expect(srv.calls.some(c => c[0] === 'DELETE' && c[1] === `${ROUTE}/5`)).toBe(true)
  })
})

describe('registry, context and routing', () => {
  it('three capabilities on their kinds; the context lists the library and each alert; "alert me when RSI crosses 70" routes the alerts group with them', async () => {
    expect(getCapability('indicatorAlert.create')).toMatchObject({ target: 'indicatorAlertLibrary', risk: 'confirm', undo: 'exact' })
    expect(getCapability('indicatorAlert.toggle')).toMatchObject({ target: 'indicatorAlert', risk: 'local', undo: 'exact' })
    expect(getCapability('indicatorAlert.delete')).toMatchObject({ target: 'indicatorAlert', risk: 'confirm', reversible: false, undo: 'none' })
    const h = host()
    srv.rows.push({ id: 5, sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'D', active: true, params_json: null })
    await loadIndicatorAlerts(h, { force: true })
    const { context } = buildContext(h, { ...CTX, message: 'show my alerts' })
    expect(context.indicatorAlertLibrary[0]).toMatchObject({ active: 1, paused: 0 })
    expect(context.indicatorAlerts[0]).toMatchObject({ symbol: 'NVDA', indicator: 'RSI', when: 'cross above 70', timeframe: 'D', status: 'active' })
    const r = routeManifest(manifestFor(CTX), 'Alert me when RSI crosses above 70 on NVDA', { limit: 60, budget: 55 })
    expect(r.routing.selected).toContain('indicatorAlerts')
    expect(r.manifest.some(c => c.name === 'indicatorAlert.create')).toBe(true)
    // a message nothing named still carries the screener (F-SB-1): the new group is a fillLast group, never a filler
    const none = routeManifest(manifestFor(CTX), "what's ripping this month", { limit: 60, budget: 55 })
    expect(none.routing.selected).toContain('screener')
  })
})

describe('through the REAL panel (panelHarness): one approval card, the hook\'s writer, a receipt, Undo', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"alert me when RSI goes above 70" (scripted) → exactly one card → Apply → the alert exists on the server → undo deletes it', async () => {
    const base = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : base(url, init)))
    const [widgets, syms] = ONE('NVDA')
    const { say, click, h } = p.mount([{ ...widgets[0], opts: { settings: { indicatorInstances: [RSI] } } }], syms)
    h.indicatorAlerts = buildIndicatorAlertSource()
    p.st.envelopes.push(p.env('propose', [{ action: 'indicatorAlert.create', target: 'indicatorAlerts', args: CREATE }]))
    const card = await say('alert me when RSI goes above 70')
    expect(card).toMatch(/Indicator alert: NVDA RSI \(RSI \(7\)\) above threshold 70 on the D chart/)
    expect(screen.getAllByTestId('agent-proposal').length).toBe(1)
    expect(srv.rows).toEqual([])                                               // proposed: nothing armed yet
    await click('Apply')
    // (the whole transcript: the helper's slice can start mid-word when timestamps re-render)
    expect(screen.getByTestId('agent-transcript').textContent).toMatch(/Indicator alert: NVDA RSI \(RSI \(7\)\) above threshold 70 on the D chart/)
    expect(srv.rows.map(r => [r.sym, r.indicator, r.condition, r.threshold, r.tf, r.instance_id, r.params_json])).toEqual([['NVDA', 'rsi', 'above', 70, 'D', 'inst:rsi:1', { period: 7 }]])
    expect(p.turns()).toBe(1)
    const undone = await say('undo')
    expect(undone).toMatch(/Undid/)
    expect(srv.rows).toEqual([])
    expect(p.turns()).toBe(1)
  }, 40000)
})

// ── A DUPLICATE is the same alert WATCHING THE SAME THING: the settings it is evaluated with count, read as the server reads them ──
describe('indicatorAlert.create — a duplicate compares the effective settings, never just the name', () => {
  const RSI14 = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 14 } }
  const RSI_DEFAULT = { instanceId: 'inst:rsi:3', defId: 'rsi', inputs: {} }
  const MACD_8 = { instanceId: 'inst:macd:2', defId: 'macd', inputs: { fastPeriod: 8 } }
  const MACD_8_21 = { instanceId: 'inst:macd:3', defId: 'macd', inputs: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 } }
  const row = (o) => ({ id: 7, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, params_json: { period: 7 }, ...o })
  const wants = (instance, extra = {}) => ({ ...CREATE, instance, ...extra })
  const DUP = /already have an active alert/
  const allowed = async (h, args) => (await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', args)])).p.ok

  it('RSI(7) above 70 does not block RSI(14) above 70: proposed, armed with its own period, both on the server, the receipt lands', async () => {
    const h = host([RSI, RSI14])
    srv.rows.push(row())
    const { p, env } = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', wants('inst:rsi:2'))])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Indicator alert: NVDA RSI/)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(srv.rows.map(r => r.params_json)).toEqual([{ period: 7 }, { period: 14 }])
  })
  it('…and the other way round: RSI(14) does not block RSI(7)', async () => {
    srv.rows.push(row({ params_json: { period: 14 } }))
    expect(await allowed(host([RSI, RSI14]), wants('inst:rsi:1'))).toBe(true)
  })
  it.each([
    ['the same period', { period: 7 }, 'inst:rsi:1'],
    ['the same period stored as text', { period: '7' }, 'inst:rsi:1'],
    ['the same period stored as JSON text', '{"period":7}', 'inst:rsi:1'],
    ['a stored knob the plot does not declare', { period: 7, legacy: 1 }, 'inst:rsi:1'],
    ['a stored null: the default, and the chart is on the default', null, 'inst:rsi:2'],
    ['a stored empty object: the default', {}, 'inst:rsi:3'],
    ['a stored null knob: the default', { period: null }, 'inst:rsi:2'],
  ])('a genuine duplicate is still refused: %s', async (_n, params_json, instance) => {
    srv.rows.push(row({ params_json }))
    expect(await refuse(host([RSI, RSI14, RSI_DEFAULT]), wants(instance))).toMatch(DUP)
  })
  it('a stored null is the DEFAULT period, so it does not block a non-default one', async () => {
    srv.rows.push(row({ params_json: null }))
    expect(await allowed(host([RSI, RSI14]), wants('inst:rsi:1'))).toBe(true)
  })
  it('several knobs: a partly stored row reads the rest from the defaults; any one knob differing is a different alert', async () => {
    const h = host([MACD, MACD_8, MACD_8_21])
    const m = (instance) => ({ ...CREATE, instance, plot: 'macd.signal', condition: 'cross_zero', threshold: null })
    srv.rows.push(row({ indicator: 'macd.signal', condition: 'cross_zero', threshold: null, params_json: { fast: 8 } }))
    expect(await refuse(h, m('inst:macd:2'))).toMatch(DUP)
    expect(await allowed(h, m('inst:macd:1'))).toBe(true)
    expect(await allowed(h, m('inst:macd:3'))).toBe(true)
  })
  it('what already made two alerts different still does: symbol, level, condition, timeframe; a PAUSED twin never blocks', async () => {
    const h = host([RSI])
    for (const o of [{ sym: 'AMD' }, { threshold: 80 }, { condition: 'below' }, { tf: 'W' }, { active: false }]) {
      srv.rows.length = 0
      srv.rows.push(row(o))
      expect(await allowed(h, CREATE)).toBe(true)
    }
  })
  it('in one request: 7 and 14 are two alerts; the same one twice is refused', async () => {
    const h = host([RSI, RSI14])
    const two = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', wants('inst:rsi:1')), op('indicatorAlert.create', 'indicatorAlerts', wants('inst:rsi:2'))])
    expect(two.p.ok).toBe(true)
    expect(two.p.plans[0].patch.create.map(c => c.params)).toEqual([{ period: 7 }, { period: 14 }])
    const same = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', wants('inst:rsi:1')), op('indicatorAlert.create', 'indicatorAlerts', wants('inst:rsi:1'))])
    expect(same.p.ok).toBe(false)
    expect(same.p.refusals[0].reason).toMatch(DUP)
  })
  it('the check at commit: a twin armed in another tab since the card refuses; an alert on another period does not', async () => {
    const h = host([RSI])
    const first = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', CREATE)])
    srv.rows.push(row())
    expect((await commitPlan(h, first.p, { env: first.env })).ok).toBe(false)
    expect(srv.rows).toHaveLength(1)

    srv.rows.length = 0
    const second = await plan(h, [op('indicatorAlert.create', 'indicatorAlerts', CREATE)])
    srv.rows.push(row({ id: 8, params_json: { period: 21 } }))
    expect((await commitPlan(h, second.p, { env: second.env })).ok).toBe(true)
    expect(srv.rows).toHaveLength(2)
  })
  it('what the member reads tells them apart: the list and the refusal use the server\'s instance label', async () => {
    const h = host([RSI])
    srv.rows.push(row({ instance_label: 'RSI(7)' }), row({ id: 8, params_json: { period: 14 }, instance_label: 'RSI(14)' }))
    const a = await getCapability('indicatorAlert.list').answer(null, { symbol: null, status: null })
    expect(a.table.rows.map(r => r.indicator)).toEqual(['RSI(7)', 'RSI(14)'])
    expect(await refuse(h, CREATE)).toBe('You already have an active alert for NVDA RSI(7) above 70 (D).')
  })
})
