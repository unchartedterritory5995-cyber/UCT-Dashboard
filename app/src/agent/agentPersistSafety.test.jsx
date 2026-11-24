// ⛔ INV2 SAFETY (2026-11-23): a failed save never leaves a change on screen under a "not done" receipt.
// CLASS-GENERATED: every capability whose target is `indicatorEdits` (read from the registry: a new one fails "every capability
// has a case" until it is given one) × every failure answer of the board's persist (conflict, not-saved, a throw, a slow
// conflict) × apply and Undo, on the board and on a Multi Chart grid cell (scopeHostToGrid). The real planner, runtime, Undo
// and Indicators mutation interface; a host whose `screen` is what the tab holds and whose `server` changes only when a
// persist is accepted. Assertions read screen, server, the receipt's words and Undo availability.
// The ONLY two allowed outcomes: (a) screen == before ∧ "not done, put back"; (b) screen changed ∧ "on this screen but NOT
// saved" ∧ no Undo. Never "nothing was left changed" with the screen changed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, allCapabilityNames, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { scopeHostToGrid, buildWorkspaceHost, BOARD_SAVE_KEYS, GRID_SAVE_KEYS } from './host'
import { emitWorkspaceConflict, hasWorkspaceConflict, __resetWorkspaceConflictsForTests } from '../lib/workspaceConflict'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { captureIndicatorTemplate } from '../components/chart/builder/indicatorTemplates'
import { instancesOf } from '../components/chart/builder/agentSeams'
import * as R from '../components/chart/engine/nativeRegistry'

registerBuiltins()
const CTX = { surface: 'charts', createIndicator: true }
const KINDS = ['indicatorEdits', 'indicatorTemplates']
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
const J = (v) => JSON.stringify(v ?? null)
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
const NO_AVERAGES = { overlays: [0, 1, 2, 3].map(() => ({ removed: true })) }
const RSI14 = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, group: null }
const SMA50 = { instanceId: 'inst:sma:50', defId: 'movingAverage', inputs: { source: 'close', period: 50, maType: 'sma' }, group: null }
const swing = () => captureIndicatorTemplate(load({ ...NO_AVERAGES, indicatorInstances: [{ instanceId: 'inst:macd:a', defId: 'macd', inputs: { fastPeriod: 8 } }] }), R, { name: 'Swing Setup' }).template

// The board: `screen` is what this tab holds (ChartsWorkspace layoutRef), `server` what the last ACCEPTED persist wrote.
// `answers` are the persist's next answers (then `sticky`, else ok). `grid: true` serves the same charts as Multi Chart cells
// through scopeHostToGrid (the grid's own persist), exactly as the workspace host does while the grid is on screen.
function board({ grid = false } = {}) {
  const screen = { c1: { ...NO_AVERAGES, indicatorInstances: [RSI14, SMA50] }, c2: { ...NO_AVERAGES } }
  let server = clone(screen)
  const META = { c1: ['Left chart (QQQ)', 'left', 'QQQ'], c2: ['Right chart (SPY)', 'right', 'SPY'] }
  const read = (ref) => (ref in screen ? { ref, label: META[ref][0], position: META[ref][1], symbol: META[ref][2], tf: 'D', stored: screen[ref], cs: load(screen[ref]), linkedCount: 0 } : null)
  const b = { screen, get server() { return server }, answers: [], sticky: null, persistCalls: 0, commits: 0, refuseCommitAfter: Infinity, duringPersist: null }
  const persist = async () => {
    b.persistCalls++
    const a = b.answers.length ? b.answers.shift() : (b.sticky || { ok: true })
    if (b.duringPersist) { const f = b.duringPersist; b.duringPersist = null; f(b) }
    if (a.slowMs) await new Promise(r => setTimeout(r, a.slowMs))
    if (a.throws) throw new Error('network')
    if (a.ok) server = clone(screen)
    return { ok: a.ok, conflict: !!a.conflict, reason: a.reason ?? null }
  }
  const charts = {
    list: () => Object.keys(screen).map(read), read,
    commit: (ref, p) => { b.commits++; if (b.commits > b.refuseCommitAfter) return false; if ('settings' in p) screen[ref] = clone(p.settings); return true },
    canManageIndicators: () => true, canCreateIndicator: () => true,
    grid: () => (grid ? { persist, cells: () => [] } : null),
  }
  const base = {
    charts, widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
    prefs: { read: () => ({ indicator_templates: JSON.stringify([swing()]) }), merge: async () => ({ ok: true }) },
    // the board's own conflict gate, as buildWorkspaceHost gives it (the grid's comes from scopeHostToGrid)
    saveBlocked: () => hasWorkspaceConflict(BOARD_SAVE_KEYS),
    ...(grid ? {} : { persist }),
  }
  b.host = grid ? scopeHostToGrid(base, { readCells: async () => ({ ok: true, cells: [] }) }) : base
  return b
}

async function plan(b, ops) {
  buildContext(b.host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(b.host, KINDS), ops, env, CTX), env }
}
async function go(b, ops) {
  const { p, env } = await plan(b, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return commitPlan(b.host, p, { env, ctx: CTX })
}
const op = (action, args, chart = 'c1') => ({ action, target: `ixe:${chart}`, args })

// ⭐ ONE case per indicatorEdits capability: `setup` (saved first, confirmed), then the change under test. The registry is the
// source of the list — a capability without a case fails the coverage test below.
const CASES = {
  'indicator.add': { ops: [op('indicator.add', { defId: 'macd', inputs: null })] },
  'indicator.remove': { ops: [op('indicator.remove', { instance: 'rsi' })] },
  'indicator.update': { ops: [op('indicator.update', { instance: 'rsi', inputs: [{ key: 'period', value: 21 }] })] },
  'indicator.hide': { ops: [op('indicator.hide', { instance: 'rsi' })] },
  'indicator.show': { setup: [op('indicator.hide', { instance: 'rsi' })], ops: [op('indicator.show', { instance: 'rsi' })] },
  'indicatorStyle.set': { ops: [op('indicatorStyle.set', { instance: 'rsi', property: 'color', value: 'orange', output: null })] },
  'indicatorStyle.placeIn': { ops: [op('indicatorStyle.placeIn', { instance: '#50', place: 'pane' })] },
  'indicatorStyle.setCalcTimeframe': { ops: [op('indicatorStyle.setCalcTimeframe', { instance: 'rsi', timeframe: 'W' })] },
  'pane.move': { ops: [op('pane.move', { pane: 'rsi', to: 'top', relativeTo: null })] },
  'pane.resize': { ops: [op('pane.resize', { pane: 'rsi', size: 'bigger' })] },
  'indicatorCopy.duplicate': { ops: [op('indicatorCopy.duplicate', { instance: 'rsi' })] },
  'indicatorCopy.copyTo': { ops: [op('indicatorCopy.copyTo', { from: 'c1', instances: [] }, 'c2')] },
  'indicatorTemplate.apply': { ops: [op('indicatorTemplate.apply', { template: 'Swing Setup' }, 'c2')] },
}
const FAILURES = {
  conflict: { ok: false, conflict: true, reason: 'conflict' },
  'not-saved': { ok: false, reason: 'not-saved' },
  throw: { throws: true },
  slow: { ok: false, conflict: true, reason: 'conflict', slowMs: 40 },
}
const chartOf = (c) => c.ops[0].target.replace(/^ixe:/, '')
const PUT_BACK = /so I put the chart back\. Nothing was changed\./
const PUT_BACK_UNDO = /I couldn’t undo that on .*so I put the chart back — your change is still in place/
const NOT_SAVED = /is on this screen but NOT saved/

beforeEach(() => { vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1'); setOwnedDefinitionSource(() => []); _resetProposedPlans(); __resetWorkspaceConflictsForTests() })
afterEach(() => { vi.unstubAllEnvs(); __resetWorkspaceConflictsForTests() })

const names = allCapabilityNames().filter(n => getCapability(n)?.target === 'indicatorEdits')

describe('INV2 class coverage', () => {
  it('every indicatorEdits capability has an invariant case (a new one must be added here)', () => {
    expect(names.length).toBeGreaterThanOrEqual(13)
    expect(names.filter(n => !CASES[n])).toEqual([])
  })
})

for (const scope of ['board', 'grid']) {
  describe(`INV2 invariant — ${scope}`, () => {
    for (const name of names) {
      const c = CASES[name]
      if (!c) continue
      const ref = chartOf(c)
      for (const [fname, answer] of Object.entries(FAILURES)) {
        it(`${name} × ${fname} × apply → screen as before, server as before, "not done, put back", no Undo`, async () => {
          const b = board({ grid: scope === 'grid' })
          for (const s of c.setup || []) expect((await go(b, [s])).ok).toBe(true)
          _resetProposedPlans()
          const before = J(b.screen[ref])
          const calls = b.persistCalls
          b.answers = [answer]
          const res = await go(b, c.ops)
          expect(res.ok).toBe(false)
          expect(res.undo).toBe(null)
          expect(b.persistCalls).toBe(calls + 1)
          expect(J(b.screen[ref])).toBe(before)                         // the screen: put back
          expect(J(b.server[ref])).toBe(before)                         // the saved copy: never changed
          expect(res.failed[0].say).toMatch(PUT_BACK)
          expect(res.failed[0].reason).not.toMatch(/could not be reversed/)
          expect(res.failed[0].onScreen).toBeFalsy()
          expect(res.compensated).toBe(true)
        })
        it(`${name} × ${fname} × undo → screen as after the change, server too, "couldn't undo, put back", Undo kept`, async () => {
          const b = board({ grid: scope === 'grid' })
          for (const s of c.setup || []) expect((await go(b, [s])).ok).toBe(true)
          _resetProposedPlans()
          const first = await go(b, c.ops)
          expect(first.ok, JSON.stringify(first.failed)).toBe(true)
          expect(first.undo).toBeTruthy()
          const after = J(b.screen[ref])
          expect(J(b.server[ref])).toBe(after)
          b.answers = [answer]
          const u = await undoEntry(b.host, first.undo)
          expect(u.ok).toBe(false)
          expect(u.spent).toBeFalsy()
          expect(J(b.screen[ref])).toBe(after)                          // the Undo's write was put back
          expect(J(b.server[ref])).toBe(after)
          expect(u.reason).toMatch(PUT_BACK_UNDO)
          expect(u.reason).not.toMatch(/could not be reversed|NOT saved/)
          // …and the same Undo still works once a save is accepted again
          const again = await undoEntry(b.host, first.undo)
          expect(again.ok, again.reason).toBe(true)
        })
      }
      it(`${name} × slow × the member edits the chart while the save is out → left as it is, "on this screen but NOT saved", no Undo`, async () => {
        const b = board({ grid: scope === 'grid' })
        for (const s of c.setup || []) expect((await go(b, [s])).ok).toBe(true)
        _resetProposedPlans()
        const before = J(b.screen[ref])
        b.answers = [FAILURES.slow]
        b.duringPersist = (bb) => { bb.screen[ref] = { ...bb.screen[ref], memberEdit: 1 } }
        const res = await go(b, c.ops)
        expect(res.ok).toBe(false)
        expect(res.undo).toBe(null)
        expect(b.screen[ref].memberEdit).toBe(1)                        // Guard 1: the member's edit is never clobbered
        expect(J(b.screen[ref])).not.toBe(before)
        expect(J(b.server[ref])).toBe(before)
        expect(res.failed[0].say).toMatch(NOT_SAVED)
        expect(res.failed[0].onScreen).toBe(true)
        expect(res.failed[0].reason).not.toMatch(/nothing was left changed/)
        expect(res.compensated).toBe(false)
      })
      it(`${name} × conflict × the chart refuses the put-back → "on this screen but NOT saved", never "put back"`, async () => {
        const b = board({ grid: scope === 'grid' })
        for (const s of c.setup || []) expect((await go(b, [s])).ok).toBe(true)
        _resetProposedPlans()
        const before = J(b.screen[ref])
        b.answers = [FAILURES.conflict]
        b.refuseCommitAfter = b.commits + 1                              // the change commits; the restore does not (Guard 2)
        const res = await go(b, c.ops)
        expect(res.ok).toBe(false)
        expect(res.undo).toBe(null)
        expect(J(b.screen[ref])).not.toBe(before)
        expect(res.failed[0].say).toMatch(NOT_SAVED)
        expect(res.failed[0].say).not.toMatch(/put the chart back/)
        expect(res.failed[0].reason).not.toMatch(/nothing was left changed/)
      })
      it(`${name} × sticky conflict (saveBlocked) → refused before the screen is touched, "reload"`, async () => {
        const b = board({ grid: scope === 'grid' })
        for (const s of c.setup || []) expect((await go(b, [s])).ok).toBe(true)
        _resetProposedPlans()
        const before = J(b.screen[ref])
        const commits = b.commits
        const calls = b.persistCalls
        emitWorkspaceConflict({ key: scope === 'grid' ? GRID_SAVE_KEYS[0] : BOARD_SAVE_KEYS[0], code: 'workspace_conflict' })
        const res = await go(b, c.ops)
        expect(res.ok).toBe(false)
        expect(b.commits).toBe(commits)                                  // never touched the screen
        expect(b.persistCalls).toBe(calls)
        expect(J(b.screen[ref])).toBe(before)
        expect(res.failed[0].say).toMatch(/can’t be saved until you reload this page\. Nothing was changed\./)
      })
    }
  })
}

describe('INV2 host.saveBlocked — the existing conflict state, read only', () => {
  it('the board host is blocked by a refused save of any key its persist checks; the grid only by its own key', () => {
    const host = buildWorkspaceHost({ chartApiById: { current: new Map() }, getWidgets: () => [], selectedChart: () => null, widgetLabel: (t) => t })
    const grid = scopeHostToGrid(host)
    expect(host.saveBlocked()).toBe(false)
    expect(grid.saveBlocked()).toBe(false)
    emitWorkspaceConflict({ key: 'chart_settings', code: 'workspace_conflict' })
    expect(host.saveBlocked()).toBe(true)
    expect(grid.saveBlocked()).toBe(false)
    emitWorkspaceConflict({ key: 'multichart_state', code: 'workspace_conflict' })
    expect(grid.saveBlocked()).toBe(true)
  })
})

describe('INV2 reproductions (R1, R3, R4)', () => {
  const rsiId = (b) => instancesOf(load(b.screen.c1), R).find(r => r.defId === 'rsi').instanceId
  it('R1: "make the rsi pane bigger" with a 409 → put back, said so', async () => {
    const b = board()
    expect(rsiId(b)).toBe('inst:rsi:1')
    b.sticky = FAILURES.conflict
    const res = await go(b, [op('pane.resize', { pane: 'rsi', size: 'bigger' })])
    expect(res.ok).toBe(false)
    expect(b.screen.c1.paneSizes ?? null).toBe(null)
    expect(b.screen.c1.preset ?? null).toBe(null)
    expect(res.failed[0].say).toMatch(/I didn’t change Left chart \(QQQ\): the save didn’t go through \(your workspace was changed in another window or device\), so I put the chart back\. Nothing was changed\./)
  })
  it('R3: a later step fails (one 409) → the earlier saved step’s Undo still works', async () => {
    const b = board()
    const first = await go(b, [op('pane.resize', { pane: 'rsi', size: 40 })])
    expect(first.ok).toBe(true)
    const afterA = J(b.screen.c1)
    b.answers = [FAILURES.conflict]
    const second = await go(b, [op('pane.move', { pane: 'rsi', to: 'top', relativeTo: null })])
    expect(second.ok).toBe(false)
    expect(J(b.screen.c1)).toBe(afterA)                                // B put back: no residue
    const u = await undoEntry(b.host, first.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(b.screen.c1.paneSizes?.['inst:rsi:1'] ?? null).toBe(null)
    expect(J(b.server.c1)).toBe(J(b.screen.c1))
  })
  it('R4: not-saved once, then an ordinary later save → the change reported "not done" is never saved', async () => {
    const b = board()
    b.answers = [FAILURES['not-saved']]
    const res = await go(b, [op('pane.resize', { pane: 'rsi', size: 'bigger' })])
    expect(res.ok).toBe(false)
    await b.host.persist()                                              // the board's next ordinary autosave
    expect(b.server.c1.paneSizes ?? null).toBe(null)
    expect(b.screen.c1.paneSizes ?? null).toBe(null)
  })
})
