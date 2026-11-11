// Phase 1 (Charts operator): what the Agent SAYS about indicator alerts is what the alert WILL do. Every case runs the real
// planner and runtime against an in-memory /api/indicator-alerts with the router's own shapes, and asserts the row the server
// ends up holding (or that none was posted), never the sentence. No model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildIndicatorAlertSource } from './host'
import { answerFor } from './discovery'
import { _resetIndicatorAlertCache, loadIndicatorAlerts, indicatorAlertLibraryKind, indicatorAlertKind } from './capabilities/indicatorAlerts'
import { installUserDefinitions } from '../components/chart/engine/nativeRegistry'
import { parseFormula, astHash } from '../components/chart/engine/ast/parse'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const ROUTE = '/api/indicator-alerts'
const LEVELS = [
  { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]
const SIG = 'u_aaaaaaaaaaaa', NUM = 'u_bbbbbbbbbbbb'
const plot = (value, label, inputs) => ({ value, label, conditions: LEVELS, default_threshold: null, inputs })
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: LEVELS, plots: [plot('rsi', 'RSI', { period: 14 })] },
  { indicator: 'macd', label: 'MACD', conditions: LEVELS, plots: [plot('macd', 'MACD line', { fast: 12, slow: 26, signal: 9 })] },
  { indicator: 'bb', label: 'BB', conditions: LEVELS, plots: [plot('bb.upper', 'BB upper', { period: 20, stddev: 2 })] },
  { indicator: 'stoch', label: 'Stochastic', conditions: LEVELS, plots: [plot('stoch', 'Stochastic %K', { k_period: 14, d_period: 3 })] },
  { indicator: `${SIG}`, label: 'Bullish Trend', source: 'user', conditions: LEVELS, plots: [{ ...plot(`${SIG}.value`, 'Bullish Trend', {}), output_type: 'condition' }] },
  { indicator: `${NUM}`, label: 'Trend Score', source: 'user', conditions: LEVELS, plots: [{ ...plot(`${NUM}.value`, 'Trend Score', {}), output_type: 'series' }] },
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
      if (body.indicator === 'vwap' && body.tf === 'D') return json({ detail: 'VWAP is only defined on an intraday timeframe' }, 400)
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
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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

describe('the create receipt words the settings the server stored', () => {
  const macd = { instanceId: 'inst:macd:a', defId: 'macd', name: 'MACD', inputs: { fastPeriod: 8 } }
  const run = async (storeAs) => {
    const h = chartWith([macd])
    const made = []
    h.indicatorAlerts = { ...h.indicatorAlerts,
      list: async () => made,
      create: async (b) => { made.push({ id: 900, active: true, ...b, instance_id: b.instance_id, params_json: storeAs(b.params) }); return { ok: true, id: 900 } } }
    await loadIndicatorAlerts(h, { force: true })
    const c = { sym: 'NVDA', indicator: 'macd.macd', condition: 'above', tf: 'D', chartTf: 'D', threshold: 0, params: { fast: 8, slow: 26 }, instanceId: macd.instanceId, label: 'MACD', condLabel: 'above' }
    return (await indicatorAlertLibraryKind.commit(h, 'x', { create: [c] })).lines[0]
  }
  it('what was sent came back: it says so', async () => {
    expect(await run(p => ({ ...p, fast: '8' }))).toMatch(/watched with that indicator's own settings/)
  })
  it('the server changed a value: it names the stored one, never "own settings"', async () => {
    const line = await run(p => ({ ...p, slow: 21 }))
    expect(line).toMatch(/saved with slow 21 \(your chart: 26\)/)
    expect(line).not.toMatch(/own settings/)
  })
  it('the stored settings are absent: it says it could not read them back', async () => {
    expect(await run(() => null)).toMatch(/couldn't read back/)
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

describe('indicatorAlert.create on another timeframe', () => {
  const rsi = { instanceId: 'r', defId: 'rsi', inputs: { period: 7 } }
  it('"alert on the weekly RSI" from a daily chart arms on W, with the chart\'s settings', async () => {
    await create(chartWith([rsi]), createArgs('r', { timeframe: 'W' }))
    expect(srv.rows).toMatchObject([{ indicator: 'rsi', tf: 'W', params_json: { period: 7 } }])
  })
  it('a word reads as its code', async () => {
    await create(chartWith([rsi]), createArgs('r', { timeframe: 'weekly' }))
    expect(srv.rows[0].tf).toBe('W')
  })
  it('a timeframe with no stored bars (4h) is refused, with nothing posted', async () => {
    expect((await create(chartWith([rsi]), createArgs('r', { timeframe: '4h' }))).refused).toMatch(/custom timeframe/)
    expect(srv.posts).toEqual([])
  })
  it('a chart on a custom timeframe can still alert on a native one the member names', async () => {
    await create(chartWith([rsi], '45'), createArgs('r', { timeframe: 'D' }))
    expect(srv.rows[0].tf).toBe('D')
  })
  it('an RSI calculated on the weekly arms when the alert is on the weekly', async () => {
    await create(chartWith([{ ...rsi, calculationTimeframe: 'W' }]), createArgs('r', { timeframe: 'W' }))
    expect(srv.rows[0].tf).toBe('W')
  })
  it('the same alert on two timeframes is two alerts, not a duplicate', async () => {
    const h = chartWith([rsi])
    await create(h, createArgs('r'))
    await create(h, createArgs('r', { timeframe: 'W' }))
    expect(srv.rows.map(r => r.tf)).toEqual(['D', 'W'])
  })
  it('a pair the server refuses (VWAP on a calendar timeframe) leaves no row and reports no success', async () => {
    CATALOG.push({ indicator: 'vwap', label: 'VWAP', conditions: LEVELS, plots: [plot('vwap', 'VWAP', {})] })
    try {
      const { res } = await create(chartWith([{ instanceId: 'v', defId: 'vwap', inputs: {} }]), createArgs('v', { timeframe: 'D' }))
      expect(res.ok).toBe(false)
      expect(srv.rows).toEqual([])
    } finally { CATALOG.pop() }
  })
})

describe('indicatorAlert.create on a yes/no signal', () => {
  const sig = { instanceId: 'inst:s', defId: SIG, inputs: {} }
  const num = { instanceId: 'inst:n', defId: NUM, inputs: {} }
  const armed = (trigger, extra = {}) => ({ instance: 'inst:s', plot: null, condition: null, threshold: null, trigger, ...extra })
  // real stored definitions: the type comes from the tree (outputTypeOf), as it does for a member's own formula
  const doc = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8')).styled_markers
  const stored = (id, name, src) => { const { ast } = parseFormula(src); return { ...doc, id, meta: { ...doc.meta, name }, plots: [{ ...doc.plots[0], key: 'value' }], compute: { ...doc.compute, fn: astHash(ast), ast, source: src } } }
  beforeEach(() => { installUserDefinitions([stored(SIG, 'Bullish Trend', 'close > sma(close, 20)'), stored(NUM, 'Trend Score', 'sma(close, 5)')]) })
  it.each([['becomes_true', 'cross_above'], ['becomes_false', 'cross_below'], ['is_true', 'above']])('%s arms the popover\'s payload: policy + its compiled rule', async (trigger, condition) => {
    await create(chartWith([sig]), armed(trigger))
    expect(srv.posts).toMatchObject([{ indicator: `${SIG}.value`, trigger_policy: trigger, condition, threshold: 0.5, tf: 'D' }])
    expect(srv.rows).toHaveLength(1)
  })
  it('no trigger: it asks, never guesses', async () => {
    expect((await create(chartWith([sig]), armed(null))).refused).toMatch(/yes\/no signal/)
    expect(srv.posts).toEqual([])
  })
  it('a level on a yes/no is not a way round: a threshold without a trigger still asks', async () => {
    expect((await create(chartWith([sig]), armed(null, { condition: 'cross_above', threshold: 1 }))).refused).toMatch(/yes\/no signal/)
    expect(srv.posts).toEqual([])
  })
  it('a trigger on a numeric output is refused: a number is never read as a yes/no at 0.5', async () => {
    expect((await create(chartWith([num]), { instance: 'inst:n', plot: null, condition: null, threshold: null, trigger: 'becomes_true' })).refused).toMatch(/number on every bar/)
    expect(srv.posts).toEqual([])
  })
  it('a trigger on a shipped indicator is refused', async () => {
    expect((await create(chartWith([{ instanceId: 'r', defId: 'rsi', inputs: {} }]), createArgs('r', { trigger: 'becomes_true' }))).refused).toMatch(/number on every bar/)
    expect(srv.posts).toEqual([])
  })
  it('on another timeframe it arms there; a custom one is refused', async () => {
    await create(chartWith([sig]), armed('becomes_true', { timeframe: 'W' }))
    expect(srv.rows[0].tf).toBe('W')
    expect((await create(chartWith([sig]), armed('becomes_true', { timeframe: '45' }))).refused).toMatch(/custom timeframe/)
    expect(srv.rows).toHaveLength(1)
  })
  it('Undo deletes the signal alert; the same policy twice is a duplicate', async () => {
    const h = chartWith([sig])
    const { res } = await create(h, armed('becomes_true'))
    expect((await create(h, armed('becomes_true'))).refused).toMatch(/already have/)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(srv.rows).toEqual([])
  })
  it('the alert is listed by its policy, never as 0.5', async () => {
    const h = chartWith([sig])
    await create(h, armed('becomes_true'))
    const a = await getCapability('indicatorAlert.list').answer(null, { symbol: null, status: null })
    expect(a.table.rows).toMatchObject([{ when: 'becomes true' }])
  })
})

describe('indicatorAlert.list', () => {
  const list = async (args = {}) => { buildContext(chartWith([]), CTX); return getCapability('indicatorAlert.list').answer(null, { symbol: null, status: null, ...args }) }
  const row = (o) => ({ sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, state: 'armed', ...o })
  beforeEach(() => { srv.rows.push(row({ id: 1 }), row({ id: 2, sym: 'AMD', active: false }), row({ id: 3, sym: 'TSLA', state: 'needs_attention', state_detail: 'The bars stopped.' }), row({ id: 4, sym: 'META', instance_missing: true })) })
  it('reads the server\'s list now, every row (the context entry is capped)', async () => {
    srv.rows.push(...Array.from({ length: 40 }, (_, i) => row({ id: 10 + i })))
    expect((await list()).table.rows).toHaveLength(44)
  })
  it('active / paused / symbol filters', async () => {
    expect((await list({ status: 'paused' })).table.rows.map(r => r.symbol)).toEqual(['AMD'])
    expect((await list({ symbol: 'nvda' })).table.rows.map(r => r.symbol)).toEqual(['NVDA'])
    expect((await list({ status: 'active' })).table.rows).toHaveLength(3)
  })
  it('why an alert cannot fire is the server\'s own sentence; a lost instance is said', async () => {
    const r = (await list({ status: 'attention' })).table.rows
    expect(r.map(x => x.symbol)).toEqual(['TSLA', 'META'])
    expect(r[0].note).toBe('The bars stopped.')
    expect(r[1].note).toMatch(/gone/)
  })
  it('a list it cannot read is said, never shown as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await list()).toMatch(/couldn't read/)
  })
  it('none is said', async () => {
    srv.rows.length = 0
    expect(await list()).toMatch(/no indicator alerts/)
  })
  it('its table carries no last value', async () => {
    srv.rows[0].last_value = 123.45
    expect(JSON.stringify((await list()).table)).not.toMatch(/123/)
  })
})

describe('through the real panel (scripted model)', () => {
  function mounted() {
    const p = setupPanel()
    const base = globalThis.fetch
    globalThis.fetch = (u, i) => (String(u).startsWith(ROUTE) ? srv.handle(u, i) : base(u, i))
    const m = p.mount(...ONE('NVDA'))
    m.h.indicatorAlerts = buildIndicatorAlertSource()
    return { p, ...m, lib: (body) => body.context.indicatorAlertLibrary[0].ref }
  }
  it('"show my indicator alerts": the table shows the server\'s rows', async () => {
    srv.rows.push({ id: 1, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'W', active: false, state: 'armed' })
    const { p, say } = mounted()
    const out = await say('show my indicator alerts')
    expect(out).toMatch(/NVDA/)
    expect(out).toMatch(/paused/)
    expect(p.turns()).toBe(0)
  })
  it('"alert on the weekly RSI": a card first, nothing armed; Apply arms it on W; Undo deletes it', async () => {
    const { p, say, click, lib } = mounted()
    await say('add rsi')
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicatorAlert.create', target: lib(body), args: { instance: 'rsi', plot: null, condition: 'above', threshold: 70, crossWith: null, chart: null, trigger: null, timeframe: 'W' } }]))
    await say('alert me when the weekly rsi is over 70')
    expect(p.proposals()).toHaveLength(1)
    expect(srv.rows).toEqual([])
    await click(/^Apply/)
    await waitFor(() => expect(srv.rows).toMatchObject([{ indicator: 'rsi', tf: 'W' }]))
    await say('undo')
    await waitFor(() => expect(srv.rows).toEqual([]))
  })
})

// Round 3 (pl-exec): a level the indicator can never reach is refused from the indicator's OWN declared range (its definition's
// fixed pane scale), never a per-indicator list. An unbounded indicator (MACD) takes any level. Held-out levels from
// agentExecHeldOut3 (RANGE_HELD_OUT) are among the cases; the rest are this file's own.
import { RANGE_HELD_OUT } from './agentExecHeldOut3.test.js'
describe('an alert level inside the indicator\'s own range', () => {
  const rsi = { instanceId: 'r', defId: 'rsi', inputs: { period: 14 } }
  // (condition above unless said: at the ends a level that must be passed is exclusive — above 100 / below 0 can never fire)
  it.each([...RANGE_HELD_OUT.map(c => [c.threshold, c.ok, 'above']), [100, false, 'above'], [100, false, 'cross_above'], [0, false, 'below'], [0, false, 'cross_below'], [0, true, 'above'], [100, true, 'below'], [99.5, true, 'cross_above'], [100.5, false, 'below']])('RSI %s (%s, %s)', async (threshold, ok, condition) => {
    const { refused } = await create(chartWith([rsi]), createArgs('r', { threshold, condition }))
    if (ok) {
      expect(refused).toBeUndefined()
      expect(srv.rows).toMatchObject([{ indicator: 'rsi', threshold }])
    } else {
      expect(refused).toMatch(/RSI moves between 0 and 100, so .* can never be reached — nothing was created/)
      expect(srv.posts).toEqual([])
    }
  })
  it('the range comes from the definition, so an unbounded indicator (MACD) takes any level', async () => {
    const { refused } = await create(chartWith([{ instanceId: 'm', defId: 'macd', inputs: { fast: 12, slow: 26, signal: 9 } }]), createArgs('m', { threshold: 150 }))
    expect(refused).toBeUndefined()
  })
})

// Round 5 (pl-exec, C2-092): an alert on the member's own YES/NO signal with its trigger policy, through the REAL panel: one card,
// Apply arms the popover's payload (policy + its compiled rule) on the server, Undo deletes it. Held-out phrasings from
// agentExecHeldOut5 (SIGNAL_HELD_OUT); the model is scripted.
import { SIGNAL_HELD_OUT } from './agentExecHeldOut5.test.js'
import { cleanup as rtlCleanup, screen as rtlScreen } from '@testing-library/react'
describe('C2-092 through the REAL panel: a yes/no signal alert with its trigger', () => {
  const doc = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8')).styled_markers
  const stored = (id, name, src) => { const { ast } = parseFormula(src); return { ...doc, id, meta: { ...doc.meta, name }, plots: [{ ...doc.plots[0], key: 'value' }], compute: { ...doc.compute, fn: astHash(ast), ast, source: src } } }
  let p
  beforeEach(() => {
    installUserDefinitions([stored(SIG, 'Bullish Trend', 'close > sma(close, 20)')])
    p = setupPanel()
    const base = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(ROUTE) ? srv.handle(url, init) : base(url, init)))
  })
  afterEach(() => { rtlCleanup() })
  const COMPILED = { becomes_true: 'cross_above', becomes_false: 'cross_below', is_true: 'above' }
  it.each(SIGNAL_HELD_OUT.map(c => [c.text, c.trigger]))('"%s" → a card; Apply arms %s on the server; Undo removes it', async (text, trigger) => {
    const [widgets, syms] = ONE('NVDA')
    const { say, click, h } = p.mount([{ ...widgets[0], opts: { settings: { indicatorInstances: [{ instanceId: 'inst:s', defId: SIG, inputs: {} }] } } }], syms)
    h.indicatorAlerts = buildIndicatorAlertSource()
    p.st.envelopes.push(p.env('propose', [{ action: 'indicatorAlert.create', target: 'indicatorAlerts', args: { instance: 'inst:s', plot: null, condition: null, threshold: null, crossWith: null, chart: null, trigger, timeframe: null } }]))
    await say(text)
    expect(rtlScreen.getAllByTestId('agent-proposal').length).toBe(1)
    expect(srv.posts).toEqual([])
    await click('Apply')
    await waitFor(() => expect(srv.rows).toHaveLength(1))
    expect(srv.posts).toMatchObject([{ indicator: `${SIG}.value`, trigger_policy: trigger, condition: COMPILED[trigger], threshold: 0.5, tf: 'D' }])
    await say('undo')
    await waitFor(() => expect(srv.rows).toEqual([]))
  }, 40000)
})
