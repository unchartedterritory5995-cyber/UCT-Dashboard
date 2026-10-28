// UCT Agent × Indicators P2 (AGENT-CONTRACT-P2-2026-10-27) — the Agent wrappers over `uct.indicators.mutation/1`
// (style, placement, panes, duplicate, copy) and `uct.indicators.definitions/1` (search, describe, duplicate,
// delete), against the REAL Indicators interfaces, planner, runtime and Undo — and end to end through the real
// panel on a two-chart board (multi-chart customisation and copying). No model unless a test scripts one.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { setDefinitionDeps } from './capabilities/definitions'
import { AuthContext } from '../context/AuthContext'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import * as R from '../components/chart/engine/nativeRegistry'
import { instancesOf } from '../components/chart/builder/agentSeams'
import { paneKeysOf } from '../components/chart/builder/agentPanes'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const CTX = { surface: 'charts' }
const VOL = { volumeSeparatePane: true, blankVolume: false }
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
// two default charts (EMA 9, EMA 20, SMA 50, SMA 200 — ovl:*), read and written like the workspace does
function board(stores = { c1: {}, c2: {} }) {
  const store = JSON.parse(JSON.stringify(stores))
  const META = { c1: ['Left chart (QQQ)', 'left', 'QQQ'], c2: ['Right chart (SPY)', 'right', 'SPY'], c3: ['Third chart (IWM)', null, 'IWM'] }
  const read = (ref) => (ref in store ? { ref, label: META[ref][0], position: META[ref][1], symbol: META[ref][2], tf: 'D', stored: store[ref], cs: load(store[ref]), linkedCount: 0 } : null)
  return {
    store,
    host: {
      charts: { list: () => Object.keys(store).map(read), read, commit: (ref, p) => { if ('settings' in p) store[ref] = JSON.parse(JSON.stringify(p.settings)); return true }, canManageIndicators: () => true, canCreateIndicator: () => true },
      persist: async () => ({ ok: true }), widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
    },
  }
}
const rows = (b, ref) => instancesOf(load(b.store[ref]), R).filter(r => !r.setting)
const inst = (b, ref, id) => load(b.store[ref]).indicatorInstances.find(i => i.instanceId === id)
const ixe = (ref) => `ixe:${ref}`
async function plan(host, ops, kinds = ['indicatorEdits']) {
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, kinds), ops, env, CTX), env }
}
async function run(host, ops, kinds) {
  const { p, env } = await plan(host, ops, kinds)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const res = await commitPlan(host, p, { env, ctx: CTX })
  expect(res.ok, JSON.stringify(res.failed)).toBe(true)
  return { p, res }
}
// a board whose left chart also carries RSI (added through the real add)
async function withRsi() {
  const b = board()
  await run(b.host, [{ action: 'indicator.add', target: ixe('c1'), args: { defId: 'rsi', inputs: null } }])
  const id = rows(b, 'c1').find(r => r.defId === 'rsi').instanceId
  return { b, id }
}
beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans() })

// ── style ────────────────────────────────────────────────────────────────────────────────────────
describe('indicatorStyle.set — colour, line width, line style, plot style (I-1…I-3)', () => {
  it('"make the 9 green" — the EMA 9\'s colour input, through setColor; receipt; exact Undo', async () => {
    const b = board()
    expect(fastParse('make the 9 green')).toMatchObject({ kind: 'ops', ops: [{ action: 'indicatorStyle.set', args: { instance: '#9', property: 'color', value: 'green' } }] })
    const { res } = await run(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#9', property: 'color', value: 'green', output: null } }])
    expect(inst(b, 'c1', 'ovl:0').inputs.color).toBe('#2faf68')
    expect(res.lines[0]).toMatch(/Changed EMA 9's colour on Left chart \(QQQ\) to #2faf68/)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(inst(b, 'c1', 'ovl:0').inputs?.color ?? '#4ade80').toBe('#4ade80')
  })
  it('"make the 20 thicker and dashed" — two ops (lineWidth 1 → 2, lineStyle dashed), each with its own Undo', async () => {
    const b = board()
    expect(fastParse('make the 20 thicker')).toMatchObject({ kind: 'ops', ops: [{ action: 'indicatorStyle.set', args: { property: 'lineWidth', value: 'thicker' } }] })
    const w = await run(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#20', property: 'lineWidth', value: 'thicker', output: null } }])
    const s = await run(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#20', property: 'lineStyle', value: 'dashed', output: null } }])
    expect(inst(b, 'c1', 'ovl:1').presentation).toMatchObject({ lineWidth: 2, lineStyle: 'dashed' })
    expect(w.res.lines[0]).toMatch(/line width on Left chart \(QQQ\) — 1 → 2/)
    expect((await undoEntry(b.host, s.res.undo)).ok).toBe(true)
    expect(inst(b, 'c1', 'ovl:1').presentation.lineStyle ?? 'solid').toBe('solid')
  })
  it('an impossible value is refused with the real options; a colour that is not a colour is refused before Indicators is asked', async () => {
    const b = board()
    const bad = await plan(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#9', property: 'lineStyle', value: 'wavy', output: null } }])
    expect(bad.p.refusals[0].reason).toMatch(/solid, dashed, dotted/)
    const col = await plan(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#9', property: 'color', value: 'blurple', output: null } }])
    expect(col.p.refusals[0].reason).toMatch(/isn't a colour I know/)
  })
  it('plot style: the EMA drawn as a histogram (an option the Inspector offers)', async () => {
    const b = board()
    const { res } = await run(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#50', property: 'plotStyle', value: 'histogram', output: null } }])
    expect(res.lines[0]).toMatch(/line → histogram/)
  })
})

// ── placement and panes ──────────────────────────────────────────────────────────────────────────
describe('indicatorStyle.placeIn + pane.move / pane.resize (I-4…I-6, I-9)', () => {
  it('"put the 50 in its own pane", then "move it above price", then "make that pane bigger" — each exact Undo', async () => {
    const b = board()
    const place = await run(b.host, [{ action: 'indicatorStyle.placeIn', target: ixe('c1'), args: { instance: '#50', place: 'pane' } }])
    expect(rows(b, 'c1').find(r => r.instanceId === 'ovl:2').displayTarget).toBe('pane')
    expect(place.res.lines[0]).toMatch(/Moved SMA 50 in its own pane/)
    const before = paneKeysOf(load(b.store.c1), R, VOL).map(p => p.paneKey)
    expect(before[0]).toBe('price')
    const mv = await run(b.host, [{ action: 'pane.move', target: ixe('c1'), args: { pane: '#50', to: 'above', relativeTo: 'price' } }])
    expect(paneKeysOf(load(b.store.c1), R, VOL)[0].paneKey).toBe('ovl:2')
    expect(mv.res.lines[0]).toMatch(/now at the top/)
    const rs = await run(b.host, [{ action: 'pane.resize', target: ixe('c1'), args: { pane: '#50', size: 30 } }])
    expect(paneKeysOf(load(b.store.c1), R, VOL).find(p => p.paneKey === 'ovl:2').share).toBe(0.3)
    expect(rs.res.lines[0]).toMatch(/30% of the chart's height/)
    // newest first: size, order, placement — each undone exactly
    for (const r of [rs, mv, place]) expect((await undoEntry(b.host, r.res.undo)).ok).toBe(true)
    expect(rows(b, 'c1').find(r => r.instanceId === 'ovl:2').displayTarget).toBe('price')
  })
  it('instant phrases: "move rsi above price", "put rsi on the price pane", "make the rsi pane bigger"', () => {
    expect(fastParse('move rsi above price')).toMatchObject({ kind: 'ops', ops: [{ action: 'pane.move', args: { pane: 'rsi', to: 'above', relativeTo: 'price' } }] })
    expect(fastParse('put rsi on the price pane')).toMatchObject({ kind: 'ops', ops: [{ action: 'indicatorStyle.placeIn', args: { instance: 'rsi', place: 'price' } }] })
    expect(fastParse('make the rsi pane bigger')).toMatchObject({ kind: 'ops', ops: [{ action: 'pane.resize', args: { pane: 'rsi', size: 'bigger' } }] })
    expect(fastParse('make the chart green')).toBeNull()                                     // not an indicator: not ours
  })
  it('RSI in its own pane moves to the bottom and back; an indicator on the price pane is told to get its own pane first', async () => {
    const { b, id } = await withRsi()
    await run(b.host, [{ action: 'pane.move', target: ixe('c1'), args: { pane: 'rsi', to: 'top', relativeTo: null } }])
    expect(paneKeysOf(load(b.store.c1), R, VOL)[0].paneKey).toBe(id)
    const onPrice = await plan(b.host, [{ action: 'pane.move', target: ixe('c1'), args: { pane: '#9', to: 'up', relativeTo: null } }])
    expect(onPrice.p.refusals[0].reason).toMatch(/draws on the price pane/)
  })
})

// ── duplicate and copy across charts ─────────────────────────────────────────────────────────────
describe('indicatorCopy.duplicate / copyTo (I-7, I-8) — multi-chart', () => {
  it('duplicate the EMA 20: a second copy; Undo removes only the copy', async () => {
    const b = board()
    const n = rows(b, 'c1').length
    const { res } = await run(b.host, [{ action: 'indicatorCopy.duplicate', target: ixe('c1'), args: { instance: '#20' } }])
    expect(rows(b, 'c1')).toHaveLength(n + 1)
    expect(res.lines[0]).toMatch(/Added a copy of EMA 20/)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(rows(b, 'c1')).toHaveLength(n)
  })
  it('copy the left chart\'s RSI (set to 7) to the right chart — exact copy; what is already there is skipped and said; Undo removes the copy', async () => {
    const { b, id } = await withRsi()
    await run(b.host, [{ action: 'indicator.update', target: ixe('c1'), args: { instance: id, inputs: [{ key: 'period', value: 7 }] } }])
    const ops = [{ action: 'indicatorCopy.copyTo', target: ixe('c2'), args: { from: 'c1', instances: [] } }]
    const { res } = await run(b.host, ops)
    const copied = rows(b, 'c2').find(r => r.defId === 'rsi')
    expect(copied).toBeTruthy()
    expect(inst(b, 'c2', copied.instanceId).inputs).toMatchObject({ period: 7 })               // exactly as configured
    expect(res.lines[0]).toMatch(/Copied RSI.* on Right chart \(SPY\) · already there: EMA 9, EMA 20, SMA 50, SMA 200/)
    // a second copy finds everything there already
    const again = await plan(b.host, ops)
    expect(again.p.ok).toBe(true)
    expect(again.p.plans[0].patch).toBeNull()
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(rows(b, 'c2').find(r => r.defId === 'rsi')).toBeUndefined()
  })
  it('copy onto the same chart, or from a chart that is not there, is refused', async () => {
    const b = board()
    expect((await plan(b.host, [{ action: 'indicatorCopy.copyTo', target: ixe('c1'), args: { from: 'c1', instances: [] } }])).p.refusals[0].reason).toMatch(/same chart/)
    expect((await plan(b.host, [{ action: 'indicatorCopy.copyTo', target: ixe('c1'), args: { from: 'zz', instances: [] } }])).p.refusals[0].reason).toMatch(/isn't on the board/)
  })
})

// ── structured lookup (I-10) ─────────────────────────────────────────────────────────────────────
describe('structured indicator lookup (I-10)', () => {
  it('"#20" / "#20:ema" resolve through Indicators\' structured resolver; two of a length is a question with the real names', async () => {
    const b = board()
    await run(b.host, [{ action: 'indicatorCopy.duplicate', target: ixe('c1'), args: { instance: '#20:ema' } }])
    const amb = await plan(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: '#20', property: 'color', value: 'red', output: null } }])
    expect(amb.p.refusals[0].reason).toMatch(/More than one indicator on Left chart \(QQQ\) matches that — EMA 20 \(the first in the legend\) or EMA 20 \(the second in the legend\)/)
  })
})

// ── definitions ──────────────────────────────────────────────────────────────────────────────────
describe('definition.* — uct.indicators.definitions/1', () => {
  const MINE = 'u_aaaaaaaaaad1'
  let FIX
  beforeAll(() => {
    FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
    const res = R.installUserDefinitions([{ ...FIX.styled_markers, id: MINE, version: 2, meta: { ...(FIX.styled_markers.meta || {}), name: 'My Breakout Dots' } }])
    expect(res.errors).toEqual([])
  })
  // the server, in memory (soft delete = 404; a PUT over a tombstone resurrects the same id) — as Indicators' own tests
  function server() {
    const rows = new Map([[MINE, { def_id: MINE, version: 2, definition: { ...FIX.styled_markers, id: MINE }, repaint: null, live: true }]])
    return {
      rows,
      read: async (id) => { const r = rows.get(id); return r && r.live ? { ok: true, row: { ...r } } : { ok: false, status: 404, error: 'Not found' } },
      remove: async (id) => { const r = rows.get(id); if (!r || !r.live) return { ok: false, error: 'Not found' }; r.live = false; return { ok: true } },
      save: async (definition, id) => { const r = rows.get(id); if (!r) return { ok: false, status: 404 }; Object.assign(r, { definition, live: true, version: r.version + 1 }); return { ok: true, row: { def_id: id, version: r.version } } },
      fork: async () => ({ ok: false, error: 'not in this test' }),
    }
  }
  beforeEach(() => { setOwnedDefinitionSource(() => [MINE]) })
  afterEach(() => setDefinitionDeps({}))
  const lib = ['definitionLibrary']

  it('search and describe answer from the real registry (read-only)', async () => {
    const b = board()
    buildContext(b.host, CTX)
    const s = await getCapability('definition.search').answer(collectTargets(b.host, lib).get('definitions').snap, { query: 'rsi', kind: null })
    expect(s.table.rows[0].name).toMatch(/RSI|Relative Strength/i)
    const d = await getCapability('definition.describe').answer(collectTargets(b.host, lib).get('definitions').snap, { defId: 'macd' })
    expect(d).toMatch(/MACD/)
    expect(d).toMatch(/Settings:/)
  })
  it('delete one of mine — proposed, naming the chart that draws it; after approval it is deleted (404); Undo re-saves the same id', async () => {
    const srv = server()
    setDefinitionDeps(srv)
    const b = board({ c1: { indicatorInstances: [{ instanceId: `inst:${MINE}:1`, defId: MINE, defVersion: 2, inputs: {}, hidden: false }] }, c2: {} })
    const ops = [{ action: 'definition.delete', target: 'definitions', args: { defId: MINE } }]
    const { p } = await plan(b.host, ops, lib)
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/My Breakout Dots.*on 1 chart now/)
    const { res } = await run(b.host, ops, lib)
    expect(srv.rows.get(MINE).live).toBe(false)
    expect(res.lines[0]).toMatch(/Deleted your indicator “My Breakout Dots” — Left chart \(QQQ\) no longer draws it/)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(srv.rows.get(MINE).live).toBe(true)
  })
  it('a built-in cannot be deleted; another member\'s formula is unknown', async () => {
    const b = board()
    expect((await plan(b.host, [{ action: 'definition.delete', target: 'definitions', args: { defId: 'rsi' } }], lib)).p.refusals[0].reason).toMatch(/Built-in indicators cannot be deleted/)
    expect((await plan(b.host, [{ action: 'definition.delete', target: 'definitions', args: { defId: 'u_ffffffffffff' } }], lib)).p.refusals[0].reason).toMatch(/don’t know that indicator/)
  })
})

// ── end to end: the real panel, two charts ───────────────────────────────────────────────────────
describe('through the real panel — multi-chart indicator customisation and copying', () => {
  let turns, script
  const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
  beforeEach(() => {
    turns = []
    script = () => answer({ reply: 'ok' })
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { const body = JSON.parse(init.body); turns.push(body); return json(await script(body)) }
      if (url === '/api/agent/record') return json({ conversationId: 'c1' })
      if (url === '/api/agent/config') return json({ stream: false })
      if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
      return json({ conversations: [] })
    })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  function mount(b) {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
          <AgentPanel host={b.host} onClose={() => {}} />
        </AuthContext.Provider>
      </SWRConfig>,
    )
    const box = screen.getByLabelText('Message UCT Agent')
    const say = async (t) => {
      await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
      fireEvent.change(box, { target: { value: t } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
      await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
    }
    return { say, transcript: () => screen.getByTestId('agent-transcript').textContent }
  }
  const ixeOf = (body, chart) => (body.context.indicatorEdits || []).find(e => e.chart.startsWith(chart))?.ref

  it('E1 · "make the 9 green on both charts" (instant) → applied at once (no card), each chart\'s EMA 9 recoloured, one step per chart; Undo twice puts both back', async () => {
    const b = board()
    const { say } = mount(b)
    await say('make the 9 green on both charts')
    // ⭐ AUTO-APPLY (live test 2026-10-28): asked for → no card; run once per chart (each its own receipt and Undo)
    await waitFor(() => { expect(inst(b, 'c1', 'ovl:0').inputs?.color).toBe('#2faf68'); expect(inst(b, 'c2', 'ovl:0').inputs?.color).toBe('#2faf68') })
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(2))
    expect(turns).toHaveLength(0)
    await say('undo')
    await say('undo')
    await waitFor(() => { expect(inst(b, 'c1', 'ovl:0').inputs?.color ?? '#4ade80').toBe('#4ade80'); expect(inst(b, 'c2', 'ovl:0').inputs?.color ?? '#4ade80').toBe('#4ade80') })
  })

  it('E2 · model plan: "make the 20 red and dashed on the left chart" → two sequential changes, two receipts', async () => {
    const b = board()
    const { say, transcript } = mount(b)
    script = (body) => answer({ disposition: 'apply', ops: [
      { action: 'indicatorStyle.set', target: ixeOf(body, 'Left'), args: { instance: 'ovl:1', property: 'color', value: 'red', output: null } },
      { action: 'indicatorStyle.set', target: ixeOf(body, 'Left'), args: { instance: 'ovl:1', property: 'lineStyle', value: 'dashed', output: null } },
    ] })
    await say('make the 20 red and dashed on the left chart')
    await waitFor(() => expect(inst(b, 'c1', 'ovl:1').presentation?.lineStyle).toBe('dashed'))
    expect(inst(b, 'c1', 'ovl:1').inputs.color).toBe('#df4646')
    expect(transcript()).toMatch(/Changed EMA 20's colour on Left chart \(QQQ\) to #df4646/)
    expect(transcript()).toMatch(/line style on Left chart \(QQQ\) — solid → dashed/)
    expect(inst(b, 'c2', 'ovl:1').inputs?.color ?? '#f472b6').not.toBe('#df4646')            // the right chart untouched
  })

  it('E3 · model plan: "copy the left chart\'s indicators to the right chart" → the RSI arrives styled; receipt says what was already there', async () => {
    const { b, id } = await withRsi()
    await run(b.host, [{ action: 'indicatorStyle.set', target: ixe('c1'), args: { instance: id, property: 'color', value: 'orange', output: null } }])
    const { say, transcript } = mount(b)
    script = (body) => answer({ disposition: 'apply', ops: [{ action: 'indicatorCopy.copyTo', target: ixeOf(body, 'Right'), args: { from: (body.context.charts || []).find(c => c.label.startsWith('Left'))?.ref, instances: [] } }] })
    await say('copy the left chart\'s indicators to the right chart')
    await waitFor(() => expect(rows(b, 'c2').some(r => r.defId === 'rsi')).toBe(true))
    expect(transcript()).toMatch(/Copied RSI/)
    expect(transcript()).toMatch(/already there/)
  })

  it('E5 · "Add the 9 and 20 EMA, make the 9 green, move RSI into its own pane, and copy those indicators to my other charts" — three charts, sequential steps, each receipted; Undo walks back', async () => {
    // three charts with no averages yet (the defaults removed through the real runtime); the left chart's RSI on price
    const b = board({ c1: {}, c2: {}, c3: {} })
    b.host.charts.selected = () => 'c1'
    for (const c of ['c1', 'c2', 'c3']) for (const id of ['ovl:0', 'ovl:1', 'ovl:2', 'ovl:3']) await run(b.host, [{ action: 'indicator.remove', target: ixe(c), args: { instance: id } }])
    await run(b.host, [{ action: 'indicator.add', target: ixe('c1'), args: { defId: 'rsi', inputs: null } }])
    await run(b.host, [{ action: 'indicatorStyle.placeIn', target: ixe('c1'), args: { instance: 'rsi', place: 'price' } }])
    _resetProposedPlans()
    const live = (c) => rows(b, c).map(r => r.name).sort()
    expect(live('c1')).toEqual(['RSI (14)'])
    expect(live('c2')).toEqual([])
    const { say, transcript } = mount(b)
    script = (body) => {
      const ix = (c) => body.context.indicatorEdits.find(e => e.chart.startsWith(c)).ref
      const left = (body.context.charts || []).find(c => c.label.startsWith('Left')).ref
      return answer({ disposition: 'apply', ops: [
        { action: 'indicator.add', target: ix('Left'), args: { defId: 'movingAverage', inputs: [{ key: 'period', value: 9 }, { key: 'maType', value: 'ema' }] } },
        { action: 'indicator.add', target: ix('Left'), args: { defId: 'movingAverage', inputs: [{ key: 'period', value: 20 }, { key: 'maType', value: 'ema' }] } },
        { action: 'indicatorStyle.set', target: ix('Left'), args: { instance: '#9:ema', property: 'color', value: 'green', output: null } },
        { action: 'indicatorStyle.placeIn', target: ix('Left'), args: { instance: 'rsi', place: 'pane' } },
        { action: 'indicatorCopy.copyTo', target: ix('Right'), args: { from: left, instances: [] } },
        { action: 'indicatorCopy.copyTo', target: ix('Third'), args: { from: left, instances: [] } },
      ] })
    }
    await say('Add the 9 and 20 EMA, make the 9 green, move RSI into its own pane, and copy those indicators to my other charts.')
    await waitFor(() => expect(live('c3')).toEqual(['EMA 20', 'EMA 9', 'RSI (14)']), { timeout: 10000 })
    for (const c of ['c1', 'c2', 'c3']) {
      expect(live(c), c).toEqual(['EMA 20', 'EMA 9', 'RSI (14)'])
      const ema9 = rows(b, c).find(r => r.name === 'EMA 9')
      expect(inst(b, c, ema9.instanceId).inputs.color, c).toBe('#2faf68')                    // the green came with the copy
      expect(rows(b, c).find(r => r.defId === 'rsi').displayTarget, c).toBe('pane')
    }
    const t = transcript()
    for (const line of [/Added EMA 9 to Left chart|Added EMA 9 on Left chart/, /Added EMA 20/, /Changed EMA 9's colour on Left chart \(QQQ\) to #2faf68/, /Moved RSI \(14\) in its own pane on Left chart/, /Copied .*on Right chart/, /Copied .*on Third chart/]) expect(t).toMatch(line)
    // Undo walks the steps back, newest first: the third chart's copy goes first
    await say('undo')
    await waitFor(() => expect(live('c3')).toEqual([]))
    expect(live('c2')).toEqual(['EMA 20', 'EMA 9', 'RSI (14)'])
  }, 60000)

  it('E4 · "move rsi above price" (instant) on the chart with RSI', async () => {
    const b = board({ c1: {} })
    const { say } = mount(b)
    await say('add rsi')
    await waitFor(() => expect(rows(b, 'c1').some(r => r.defId === 'rsi')).toBe(true))
    const id = rows(b, 'c1').find(r => r.defId === 'rsi').instanceId
    await say('move rsi above price')
    await waitFor(() => expect(paneKeysOf(load(b.store.c1), R, VOL)[0].paneKey).toBe(id))
    expect(turns).toHaveLength(0)
  })
})
