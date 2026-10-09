// INDICATORS M2 — Agent acceptance (docs/agent/M2-INDICATORS-PLAN.md §5, contract
// docs/indicators/AGENT-INTEGRATION-HANDOFF.md §14–§15). The REAL Indicators mutation interface,
// the REAL registry and the same chart fixture as agentMutations.test.js, driven through the
// Agent's own planner + runtime + Undo. The host simulates the chart's persist path: a JSON
// round trip (a stored copy), a refused save, a lost write, a missing read-back.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerBuiltins } from './builtins'
import { buildContext, manifestFor, getCapability, MANIFEST_CONTRACT } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { routeManifest, selectGroups, groupOfAction } from './routing'
import { protectionRefusal } from './protectedLayouts'
import { setOwnedDefinitionSource, _resetProposedPlans, refusalSentence } from './capabilities/indicatorEdits'
import * as registry from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { addInstance, withInstances } from '../components/chart/engine/instanceControls'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { instancesOf } from '../components/chart/builder/agentSeams'
import { REASONS } from '../components/chart/builder/agentMutations'

registerBuiltins()
const SAVED = 'u_aaaaaaaaaab2'
beforeAll(() => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  registry.installUserDefinitions([{ ...FIX.styled_markers, id: SAVED, version: 4 }])
})
let OWNED = [SAVED]
beforeEach(() => { OWNED = [SAVED]; setOwnedDefinitionSource(() => OWNED); _resetProposedPlans(); try { localStorage.clear() } catch { /* */ } })

const view = (cs) => adoptOverlayAverages(cs) || cs
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
/** RSI, an MA reading RSI, a header value reading RSI, MACD hidden (agentMutations.test.js's chart). */
function chartCs(extra = []) {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: true },
      ...extra,
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
    header: { ...(base.header || {}), infoValues: [{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }] },
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}

/** A host with the chart's ONE persist path: commit → stored (JSON round trip) → persist ACK → read-back. */
function host(specs, { access = {}, persist = () => ({ ok: true }), lostWrite = false, noReadBack = false } = {}) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(s.cs))]))
  const writes = []
  const snap = (s) => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: 'D', cs: load(store[s.ref]), stored: noReadBack ? undefined : store[s.ref] })
  const h = {
    store, writes, access, opts: { lostWrite, noReadBack },
    charts: {
      list: () => specs.map(snap),
      read: (ref) => { const s = specs.find(x => x.ref === ref); if (!s) return null; const r = snap(s); return h.opts.noReadBack ? { ...r, cs: null, stored: null } : r },
      commit: (ref, patch) => { writes.push([ref, patch]); if (!h.opts.lostWrite) store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: (ref) => h.access[ref] !== false,
      canCreateIndicator: () => true,
      openCreateIndicator: () => ({ ok: true, prefilled: false, draft: false, editing: false }),
    },
    persist: async () => persist(),
  }
  return h
}
const L = (cs = chartCs()) => ({ ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA', cs })
const R = (cs = chartCs()) => ({ ref: 'R', label: 'Right chart (AAPL)', position: 'right', symbol: 'AAPL', cs })
const CTX = { surface: 'charts', createIndicator: true }
const ix = (chart) => `ixe:${chart}`
const op = (action, chart, args) => ({ action, target: ix(chart), args })
const ids = (cs) => (view(cs).indicatorInstances || []).filter(i => !i.deleted).map(i => i.instanceId)

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

// ── add / remove / show / hide ───────────────────────────────────────────────────────
describe('M2 add / remove / show / hide — through the Indicators interface only', () => {
  it('add RSI: the stored chart equals Add to Chart (addInstance) byte for byte; receipt only after the read-back; Undo removes exactly it', async () => {
    const before = chartCs()
    const h = host([L(before)])
    const { p, res } = await run(h, [op('indicator.add', 'L', { defId: 'rsi' })])
    expect(p.lines[0]).toMatch(/^Add (RSI|Relative Strength Index).* to Left chart \(NVDA\)$/)
    expect(res.ok).toBe(true)
    expect(res.lines[0]).toMatch(/^Added RSI.* on Left chart \(NVDA\) \(saved\)\.$/)
    const want = JSON.parse(JSON.stringify(addInstance(view(before), 'rsi', registry)))
    expect(load(h.store.L).indicatorInstances).toEqual(load(want).indicatorInstances)
    expect(res.undo).toBeTruthy()
    const u = await undoEntry(h, res.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(u.lines[0]).toMatch(/^Removed the RSI.* I added on Left chart \(NVDA\) \(saved\)\.$/)
    expect(ids(h.store.L)).toEqual(ids(before))
  })
  it('remove RSI: always a PROPOSAL that names what it disconnects; Undo restores the SAME ids and reconnects them', async () => {
    const before = chartCs()
    const h = host([L(before)])
    expect(getCapability('indicator.remove').risk).toBe('confirm')
    const p = await plan(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Remove RSI.* from Left chart \(NVDA\) — this disconnects /)
    expect(p.lines[0]).toMatch(/EMA 9's source input/)
    expect(p.lines[0]).toMatch(/a header value reading it/)
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(true)
    expect(res.lines[0]).toMatch(/^Removed RSI.* on Left chart \(NVDA\) \(saved\) — disconnected /)
    expect(ids(h.store.L)).not.toContain('inst:rsi:1')
    const u = await undoEntry(h, res.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(u.lines[0]).toMatch(/^Restored RSI.* with its original identity and reconnected /)
    expect(load(h.store.L).indicatorInstances).toEqual(load(before).indicatorInstances)       // same ids, order, inputs (the MA reads inst:rsi:1 again)
    expect(load(h.store.L).header.infoValues).toEqual(load(before).header.infoValues)
  })
  it('hide RSI / show MACD use the canonical visibility writer; an already-hidden indicator is a no-op, not a write', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    expect(res.lines[0]).toMatch(/^Hid RSI.* on Left chart \(NVDA\) \(saved\)\.$/)
    expect(instancesOf(load(h.store.L), registry).find(i => i.instanceId === 'inst:rsi:1').hidden).toBe(true)
    const u = await undoEntry(h, res.undo)
    expect(u.lines[0]).toMatch(/^Put RSI.* back to shown \(saved\)\.$/)
    const n = h.writes.length
    const noop = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:macd:1' })])
    expect(noop.ok).toBe(true)
    expect(noop.changed).toBe(false)
    expect(noop.noops[0]).toMatch(/already hidden/)
    const { res: shown } = await run(h, [op('indicator.show', 'L', { instance: 'inst:macd:1' })])
    expect(shown.lines[0]).toMatch(/^Showed MACD.* \(saved\)\.$/)
    expect(h.writes.length).toBe(n + 1)
  })
  it('a classic average (ovl:) can be removed and restored exactly; it is never ADDED this way (and nor is Volume Profile)', async () => {
    const before = chartCs()
    const ovl = instancesOf(before, registry).find(r => r.instanceId.startsWith('ovl:'))
    expect(ovl).toBeTruthy()
    const h = host([L(before)])
    const { res } = await run(h, [op('indicator.remove', 'L', { instance: ovl.instanceId })])
    expect(res.ok).toBe(true)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(load(h.store.L).indicatorInstances).toEqual(load(before).indicatorInstances)
    for (const defId of ['volumeProfile', 'ma', 'Volume Profile']) {
      const p = await plan(h, [op('indicator.add', 'L', { defId })])
      expect(p.ok, defId).toBe(false)
      expect(p.refusals[0].reason).toMatch(/Classic overlay averages and Volume Profile are added from Chart Settings/)
    }
  })
  it('unknown and foreign definitions are refused before any proposal; the member\'s own saved one is added', async () => {
    const h = host([L()])
    for (const defId of ['u_ffffffffffff', 'nonsense']) {
      const p = await plan(h, [op('indicator.add', 'L', { defId })])
      expect(p.ok).toBe(false)
      expect(p.refusals[0].reason).toBe(refusalSentence({ reason: REASONS.UNKNOWN_DEFINITION }))
    }
    OWNED = []
    expect((await plan(h, [op('indicator.add', 'L', { defId: SAVED })])).ok).toBe(false)     // not (or no longer) the member's
    OWNED = [SAVED]
    _resetProposedPlans()
    const { res } = await run(h, [op('indicator.add', 'L', { defId: SAVED })])
    expect(res.ok).toBe(true)
  })
})

// ── targets ──────────────────────────────────────────────────────────────────────────
describe('M2 targets: multiple charts, duplicate names, exact identity', () => {
  it('two charts: each has its own `manage` ref; a removal on the right chart touches only the right chart', async () => {
    const h = host([L(), R()])
    const ctx = buildContext(h, CTX).context.indicators
    expect(ctx.map(e => e.manage)).toHaveLength(2)
    expect(new Set(ctx.map(e => e.manage)).size).toBe(2)
    expect(ctx[0].indicators.find(i => /RSI/.test(i.name)).id).toBe('inst:rsi:1')
    const left = JSON.stringify(h.store.L)
    const { res } = await run(h, [op('indicator.hide', 'R', { instance: 'inst:rsi:1' })])
    expect(res.lines[0]).toMatch(/on Right chart \(AAPL\)/)
    expect(JSON.stringify(h.store.L)).toBe(left)
  })
  it('duplicate names: a name matching two instances is refused with both candidates; the exact id works', async () => {
    const two = chartCs([{ instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 14 }, hidden: false }])
    const h = host([L(two)])
    const name = instancesOf(two, registry).find(i => i.instanceId === 'inst:rsi:1').name
    expect(instancesOf(two, registry).filter(i => i.name === name)).toHaveLength(2)
    const p = await plan(h, [op('indicator.hide', 'L', { instance: name })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/More than one indicator .* matches that — .*inst:rsi:1.*inst:rsi:2/)
    const { res } = await run(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:2' })])
    expect(res.ok).toBe(true)
    const rows = instancesOf(load(h.store.L), registry)
    expect(rows.find(i => i.instanceId === 'inst:rsi:2').hidden).toBe(true)
    expect(rows.find(i => i.instanceId === 'inst:rsi:1').hidden).toBe(false)
  })
  it('a nonexistent instance id is "not on the chart"; Volume is not an indicator target', async () => {
    const h = host([L()])
    expect((await plan(h, [op('indicator.remove', 'L', { instance: 'inst:nope:1' })])).refusals[0].reason).toMatch(/isn't on Left chart/)
    expect((await plan(h, [op('indicator.hide', 'L', { instance: 'volume' })])).ok).toBe(false)
  })
})

// ── permission ───────────────────────────────────────────────────────────────────────
describe('M2 permission — at plan, at Apply, at Undo', () => {
  it('a read-only chart is refused at plan; with no manageable chart the four actions are not offered at all', async () => {
    const h = host([L()], { access: { L: false } })
    expect((await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])).refusals[0].reason).toMatch(/can't be changed from here/)
    const names = (ctx) => manifestFor(ctx).map(c => c.name).filter(n => n.startsWith('indicator.'))
    expect(names({ ...CTX, manageIndicators: false })).toEqual(['indicator.list', 'indicator.openCreate'])
    expect(names({ ...CTX, manageIndicators: true })).toEqual(expect.arrayContaining(['indicator.add', 'indicator.remove', 'indicator.show', 'indicator.hide']))
  })
  it('access lost between plan and Apply → refused at Apply ("permission … changed"), nothing written', async () => {
    const h = host([L()])
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    h.access.L = false
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/permission to change indicators on Left chart \(NVDA\) changed/)
    expect(h.writes).toEqual([])
  })
  it('access lost before Undo → Undo refused, nothing written', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    const n = h.writes.length
    h.access.L = false
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/could not be undone .*permission/)
    expect(h.writes.length).toBe(n)
  })
})

// ── stale state ──────────────────────────────────────────────────────────────────────
describe('M2 stale state — the proposal\'s pins, not a re-plan', () => {
  it('a new reader of the target appears between the proposal and the approval → refused (dependents), nothing written', async () => {
    const h = host([L()])
    const proposal = await plan(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])          // what the member saw
    expect(proposal.ok).toBe(true)
    // another window adds a second MA reading RSI
    const cur = load(h.store.L)
    h.store.L = JSON.parse(JSON.stringify(withInstances(cur, [...cur.indicatorInstances, { instanceId: 'inst:movingAverage:10', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 20, maType: 'sma', color: '#00ff00' }, hidden: false }], registry)))
    // the member presses Apply → useAgent re-plans; the pinned proposal plan is what Apply checks
    const again = await plan(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    const res = await commitPlan(h, again, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/indicators that read this one on Left chart \(NVDA\) changed while I was working/)
    expect(h.writes).toEqual([])
  })
  it('the target itself edited after the plan → refused (indicator); a theme change elsewhere does not block', async () => {
    const h = host([L()])
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    const cur = load(h.store.L)
    h.store.L = JSON.parse(JSON.stringify({ ...cur, background: '#123456' }))           // unrelated
    const ok = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(ok.ok).toBe(true)
    _resetProposedPlans()
    const p2 = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:macd:1' })])
    expect(p2.changed).toBe(false)                                                     // MACD is hidden already
    const p3 = await plan(h, [op('indicator.show', 'L', { instance: 'inst:rsi:1' })])
    const c3 = load(h.store.L)
    h.store.L = JSON.parse(JSON.stringify(withInstances(c3, c3.indicatorInstances.map(i => (i.instanceId === 'inst:rsi:1' ? { ...i, inputs: { ...i.inputs, period: 21 } } : i)), registry)))
    const r3 = await commitPlan(h, p3, { env: {}, ctx: CTX })
    expect(r3.ok).toBe(false)
    expect(r3.failed[0].reason).toMatch(/changed while I was working/)
  })
  it('Undo after a conflicting edit (the severed input re-pointed) → refused as no longer exact; never a re-add', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    const cur = load(h.store.L)
    h.store.L = JSON.parse(JSON.stringify(withInstances(cur, cur.indicatorInstances.map(i => (i.instanceId === 'inst:movingAverage:9' ? { ...i, inputs: { ...i.inputs, source: 'close' } } : i)), registry)))
    const n = h.writes.length
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/can no longer be undone exactly/)
    expect(h.writes.length).toBe(n)
    expect(ids(h.store.L)).not.toContain('inst:rsi:1')
  })
})

// ── persistence ──────────────────────────────────────────────────────────────────────
describe('M2 persistence — "done" only on a confirmed read-back', () => {
  it('a refused save (conflict) → not done, no Undo; the receipt says so', async () => {
    const h = host([L()], { persist: () => ({ ok: false, reason: 'conflict' }) })
    const { res } = await run(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })]).catch(e => ({ res: e }))
    expect(res.ok).toBe(false)
    expect(res.undo).toBe(null)
    expect(res.failed[0].reason).toMatch(/save was not confirmed \(conflict\), so it is not done/)
    expect(res.failed[0].reason).toMatch(/could not be reversed/)               // honest: it may be on screen
  })
  it('a lost write (the read-back does not show it) → "did not land", no Undo', async () => {
    const h = host([L()], { lostWrite: true })
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.undo).toBe(null)
    expect(res.failed[0].reason).toMatch(/did not land/)
  })
  it('no read-back at all → "could not read the saved chart back", never success', async () => {
    const h = host([L()])
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    h.persist = async () => { h.opts.noReadBack = true; return { ok: true } }      // ACK, then the chart is gone
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.undo).toBe(null)
    expect(res.failed[0].reason).toMatch(/could not read the saved chart back, so I am not reporting it as done/)
  })
})

describe('M2 persistence — Indicators review (§14.9 limit 3)', () => {
  it('a host with NO persist path → never a success receipt, no Undo (not-saved)', async () => {
    const h = host([L()])
    delete h.persist
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.undo).toBe(null)
    expect(res.failed[0].reason).toMatch(/save was not confirmed \(not-saved\), so it is not done/)
  })
  it('stored copy missing after the commit (only rendered settings) → unconfirmed, never a fallback to the rendered state', async () => {
    const h = host([L()])
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    const read = h.charts.read
    h.persist = async () => { h.charts.read = (ref) => { const r = read(ref); return r && { ...r, stored: null } }; return { ok: true } }
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.undo).toBe(null)
    expect(res.failed[0].reason).toMatch(/could not read the saved chart back, so I am not reporting it as done/)
  })
})

// ── Undo tokens ──────────────────────────────────────────────────────────────────────
describe('M2 Undo tokens — opaque, session-scoped, chart-bound', () => {
  it('the token is held exactly as returned and never persisted', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    const token = res.undo.items[0].undoData
    expect(token).toMatchObject({ contract: 'uct.indicators.mutation/1', kind: 'undo', op: 'remove', chartId: 'L' })
    expect(JSON.stringify(Object.values(localStorage))).not.toMatch(/uct\.indicators\.mutation/)
    expect(JSON.stringify(Object.values(sessionStorage))).not.toMatch(/uct\.indicators\.mutation/)
  })
  it('a token for one chart is refused on another; a tampered token is refused; nothing written', async () => {
    const h = host([L(), R()])
    const { res } = await run(h, [op('indicator.remove', 'L', { instance: 'inst:rsi:1' })])
    const token = res.undo.items[0].undoData
    const kind = (await import('./capabilities/indicatorEdits')).indicatorEditsKind
    const n = h.writes.length
    await expect(kind.commit(h, 'ixe:R', { undo: token })).rejects.toThrow(/not valid for this chart/)
    await expect(kind.commit(h, 'ixe:L', { undo: { ...token, contract: 'forged' } })).rejects.toThrow(/not valid/)
    await expect(kind.commit(h, 'ixe:L', { undo: { ...token, record: { ...token.record, paths: [{ path: ['indicatorInstances'], before: [], after: ['x'] }] } } })).rejects.toThrow(/no longer be undone exactly/)
    expect(h.writes.length).toBe(n)
  })
  it('an Undo is offered only for a confirmed change, and is gone after it is used', async () => {
    const h = host([L()])
    const { res } = await run(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    const again = await undoEntry(h, res.undo)                     // the same entry again: the state no longer holds `after`
    expect(again.ok).toBe(false)
  })
})

// ── safety, routing, budget ──────────────────────────────────────────────────────────
describe('M2 safety, routing and budget', () => {
  it('Main Trading open → every M2 change is refused by the protected-layout guard; indicator.list still answers', async () => {
    const h = host([L()])
    h.layouts = { snapshot: () => ({ entries: [{ id: '1', name: 'Main Trading' }], active: { scope: 'user', id: '1' } }) }
    const p = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])
    expect(protectionRefusal(h, p, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' })])).toMatch(/protected layout/)
    expect(getCapability('indicator.list').answer(collectTargets(h, ['indicators']).get('ind:L').snap, { filter: null }).table.rows.length).toBeGreaterThan(0)
  })
  it('one indicator change per request, nothing else beside it', async () => {
    const h = host([L(), R()])
    expect((await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' }), { action: 'chart.setType', target: 'L', args: { type: 'bars' } }])).ok).toBe(false)
    expect((await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' }), op('indicator.hide', 'R', { instance: 'inst:rsi:1' })])).ok).toBe(false)
    const two = await plan(h, [op('indicator.hide', 'L', { instance: 'inst:rsi:1' }), op('indicator.show', 'L', { instance: 'inst:macd:1' })])
    expect(two.ok).toBe(false)
    expect(two.refusals[0].reason).toMatch(/One indicator change at a time/)
  })
  it('routing: indicator intent reaches the indicators group; colour/marker/compare commands stay chart operations', () => {
    const g = (m) => selectGroups(m).priority.filter(x => x !== 'agent')
    for (const m of ['Add RSI to this chart', 'Hide MACD', 'Show RSI', 'Remove this indicator', 'hide the 9 EMA']) expect(g(m), m).toContain('indicators')
    for (const m of ['make the grid blue', 'turn on earnings markers', 'compare AAPL to SPY', 'colour the candles green']) expect(g(m), m).not.toContain('indicators')
  })
  it('budget: the indicators group is 6 actions and every routed request stays ≤ 55', () => {
    const FULL = manifestFor({ ...CTX, manageIndicators: true })
    expect(FULL.filter(c => groupOfAction(c.name) === 'indicators')).toHaveLength(6)
    const opts = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
    for (const m of ['Add RSI to this chart and put NVDA on a new chart and add it to my watchlist', 'hide MACD, draw a line at 200, alert me when it crosses 150, switch to weekly', 'remove this indicator then save the layout']) {
      expect(routeManifest(FULL, m, opts).manifest.length, m).toBeLessThanOrEqual(55)
    }
  })
  it('"Undo that indicator removal" (and kin) is the ordinary Undo of the newest change; other text is not', async () => {
    const { fastParse } = await import('./fastPath')
    for (const m of ['Undo that indicator removal.', 'undo the last hide', 'undo removing that', 'revert that change', 'undo']) expect(fastParse(m)?.kind, m).toBe('undo')
    for (const m of ['undo my watchlist from yesterday', 'remove the undo button']) expect(fastParse(m)?.kind, m).not.toBe('undo')
  })
  it('⛔ the Agent file never writes indicator state itself (no writer import, no array/flag edits)', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/agent/capabilities/indicatorEdits.js'), 'utf8')
    expect(src).not.toMatch(/from ['"][^'"]*instanceControls['"]/)
    expect(src).not.toMatch(/indicatorInstances\s*[=:]|\.hidden\s*=|\.push\(.*instanceId/)
    expect(src).toMatch(/from '..\/..\/components\/chart\/builder\/agentMutations'/)
  })
})
